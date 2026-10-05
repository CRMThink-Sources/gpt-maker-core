import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import {
  notificationLog,
  notificationRecipient,
  portalAdmin,
} from '../../shared/database/schema/index';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient, BitrixError } from '../bitrix';
import { type Tenant, TenantService } from '../tenancy';

export type NotificationType = (typeof notificationLog.$inferSelect)['type'];
type LogRow = typeof notificationLog.$inferSelect;

/** Depois disso o aviso fica `FAILED`, com alerta. */
const MAX_ATTEMPTS = 10;
const BATCH = 50;

/** 1 min, 2, 4... até 1 h. */
function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** (attempts - 1), 3_600_000);
}

export interface DispatchOutcome {
  status: LogRow['status'];
  sentTo: string[];
}

/**
 * Avisos do app no Bitrix24 (spec credit-billing, "Destinatários de avisos"; design D9): um
 * `notification_log` por (tenant, tipo, chave), que faz o "uma vez por ciclo/evento" e serve de
 * fila. O envio é `im.notify.system.add`, um por destinatário: os escolhidos pelo administrador
 * que estão ativos no portal; sem nenhum, os administradores (vistos nas sessões do app e o dono
 * do token da instalação, quem instalou o app). Falha transitória ⇒ nova tentativa com espera;
 * `sent_to` evita notificar duas vezes quem já recebeu.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly bitrix: BitrixClient,
    private readonly tenants: TenantService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  /**
   * Enfileira o aviso; `false` se já existia para a mesma chave (não repete). O envio sai no
   * próximo despacho (até 30 s). Nunca lança: aviso não pode derrubar quem o dispara.
   */
  async notify(input: {
    tenantId: string;
    type: NotificationType;
    dedupeKey: string;
    message: string;
  }): Promise<boolean> {
    try {
      const rows = await this.db
        .insert(notificationLog)
        .values(input)
        .onConflictDoNothing({
          target: [notificationLog.tenantId, notificationLog.type, notificationLog.dedupeKey],
        })
        .returning({ id: notificationLog.id });
      return rows.length > 0;
    } catch (error) {
      this.logger.error(
        { alert: true, err: error, tenantId: input.tenantId, type: input.type },
        'aviso não registrado',
      );
      return false;
    }
  }

  /** Aviso de teste da tela de destinatários: enviado na hora. */
  async sendTest(tenantId: string, requestedBy: string): Promise<DispatchOutcome> {
    const [row] = await this.db
      .insert(notificationLog)
      .values({
        tenantId,
        type: 'TEST',
        dedupeKey: randomUUID(),
        message:
          '[B]ThinkFlow AI[/B]: este é um aviso de teste. É assim que você vai receber os alertas de créditos e de pagamento do app.',
      })
      .returning();
    this.logger.log({ tenantId, requestedBy }, 'aviso de teste solicitado');
    return this.dispatch(row!);
  }

  async recipients(tenantId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: notificationRecipient.bitrixUserId })
      .from(notificationRecipient)
      .where(eq(notificationRecipient.tenantId, tenantId))
      .orderBy(asc(notificationRecipient.createdAt));
    return rows.map((row) => row.id);
  }

  /** Substitui a lista inteira (a tela envia o conjunto escolhido). */
  async setRecipients(tenantId: string, bitrixUserIds: string[], by: string): Promise<string[]> {
    const ids = [...new Set(bitrixUserIds)];
    await this.db.transaction(async (tx) => {
      await tx.delete(notificationRecipient).where(eq(notificationRecipient.tenantId, tenantId));
      if (ids.length) {
        await tx
          .insert(notificationRecipient)
          .values(ids.map((bitrixUserId) => ({ tenantId, bitrixUserId, createdBy: by })));
      }
    });
    return ids;
  }

  @Cron('*/30 * * * * *', { name: 'notification-dispatch' })
  async run(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        await this.lock.runExclusive('job:notification-dispatch', 25_000, () =>
          this.dispatchPending(),
        );
      } catch (error) {
        this.logger.error({ err: error }, 'despacho de avisos falhou');
      }
    });
  }

  async dispatchPending(now = new Date()): Promise<number> {
    const due = await this.db
      .select()
      .from(notificationLog)
      .where(and(eq(notificationLog.status, 'PENDING'), lte(notificationLog.nextAttemptAt, now)))
      .orderBy(asc(notificationLog.nextAttemptAt))
      .limit(BATCH);
    for (const row of due) await this.dispatch(row, now);
    return due.length;
  }

  private async dispatch(row: LogRow, now = new Date()): Promise<DispatchOutcome> {
    const tenant = await this.tenants.findById(row.tenantId);
    if (!tenant || tenant.status === 'UNINSTALLED') {
      return this.finish(row, 'FAILED', row.sentTo, 'app desinstalado');
    }
    const installationId = Number(tenant.installationId);
    const sentTo = [...row.sentTo];
    try {
      const targets = await this.targets(tenant);
      if (targets.length === 0) {
        this.logger.error(
          { alert: true, tenantId: tenant.id, type: row.type },
          'aviso sem destinatários',
        );
        return this.finish(row, 'FAILED', sentTo, 'nenhum destinatário ativo');
      }
      for (const userId of targets) {
        if (sentTo.includes(userId)) continue;
        try {
          await this.bitrix.call(installationId, 'im.notify.system.add', {
            USER_ID: userId,
            MESSAGE: row.message,
            TAG: `GPTMAKER|${row.type}|${row.dedupeKey}`.slice(0, 255),
          });
          sentTo.push(userId);
        } catch (error) {
          // Recusa para um usuário (ex.: sem acesso ao app) não impede os demais.
          if (error instanceof BitrixError && error.kind === 'API_ERROR') {
            this.logger.warn(
              { err: error, tenantId: tenant.id, userId },
              'aviso recusado para o usuário',
            );
            continue;
          }
          throw error;
        }
      }
      return this.finish(
        row,
        sentTo.length ? 'SENT' : 'FAILED',
        sentTo,
        sentTo.length ? null : 'recusado para todos',
        now,
      );
    } catch (error) {
      const transient = error instanceof BitrixError ? error.isTransient : true;
      const attempts = row.attempts + 1;
      if (!transient || attempts >= MAX_ATTEMPTS) {
        this.logger.error(
          { alert: true, err: error, tenantId: tenant.id, type: row.type, attempts },
          'aviso não enviado',
        );
        return this.finish(row, 'FAILED', sentTo, String((error as Error)?.message ?? error));
      }
      await this.db
        .update(notificationLog)
        .set({
          attempts,
          sentTo,
          lastError: String((error as Error)?.message ?? error).slice(0, 2000),
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
        })
        .where(eq(notificationLog.id, row.id));
      return { status: 'PENDING', sentTo };
    }
  }

  /** Destinatários ativos no portal; sem nenhum, os administradores ativos. */
  private async targets(tenant: Tenant): Promise<string[]> {
    const installationId = Number(tenant.installationId);
    const chosen = await this.active(installationId, await this.recipients(tenant.id));
    if (chosen.length) return chosen;

    const seen = await this.db
      .select({ id: portalAdmin.bitrixUserId })
      .from(portalAdmin)
      .where(eq(portalAdmin.tenantId, tenant.id));
    const admins = new Set(seen.map((row) => row.id));
    // Dono do token da instalação: quem instalou o app (sempre administrador).
    const installer = await this.bitrix.call<{ ID?: string }>(installationId, 'user.current');
    if (installer.result?.ID) admins.add(String(installer.result.ID));
    return this.active(installationId, [...admins]);
  }

  /** Mantém só os usuários ativos no portal (`user.get`, escopo `user_brief`). */
  private async active(installationId: number, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const response = await this.bitrix.call<Array<{ ID: string; ACTIVE?: boolean }>>(
      installationId,
      'user.get',
      { FILTER: { ID: ids, ACTIVE: true } },
    );
    const active = new Set((response.result ?? []).map((user) => String(user.ID)));
    return ids.filter((id) => active.has(id));
  }

  private async finish(
    row: LogRow,
    status: 'SENT' | 'FAILED',
    sentTo: string[],
    error: string | null,
    now = new Date(),
  ): Promise<DispatchOutcome> {
    await this.db
      .update(notificationLog)
      .set({
        status,
        sentTo,
        attempts: sql`${notificationLog.attempts} + 1`,
        lastError: error?.slice(0, 2000) ?? null,
        sentAt: status === 'SENT' ? now : null,
      })
      .where(eq(notificationLog.id, row.id));
    return { status, sentTo };
  }
}
