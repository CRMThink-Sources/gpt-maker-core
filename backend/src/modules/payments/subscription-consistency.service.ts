import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CurrentSubscription, PlatformEvent } from '@crmthink-sources/platform-sdk';
import { APP_CODE } from '@gptmaker/contracts';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { subscriptionState, tenant } from '../../shared/database/schema/index';
import {
  isPlatformUnavailable,
  PlatformApiClient,
  PlatformError,
} from '../../shared/platform/platform-api.client';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { PlatformEventStore } from './platform-event.store';
import { SubscriptionEventsService } from './subscription-events.service';

type Projection = typeof subscriptionState.$inferSelect;

/** Sem assinatura na plataforma: só encerra a local passado este prazo do fim do período. */
const END_GRACE_MS = 24 * 3_600_000;
const BATCH = 100;

/** Evento que faltou, reconstruído da consulta à plataforma. */
export interface Correction {
  type:
    | 'subscription.trial_started'
    | 'subscription.activated'
    | 'subscription.renewed'
    | 'subscription.past_due'
    | 'subscription.recovered'
    | 'subscription.ended';
  reason: string;
  subscription: {
    id: number;
    status: CurrentSubscription['status'];
    modality?: CurrentSubscription['modality'];
    planId?: number;
    periodStart?: string;
    periodEnd?: string;
    version?: number;
  };
  data: Record<string, unknown>;
}

/** Alerta sem correção automática (ex.: plataforma sem assinatura antes do fim do período). */
export interface Divergence {
  alert: string;
}

/**
 * Compara a projeção local com a assinatura vigente na plataforma (`null` = `NO_SUBSCRIPTION`) e
 * diz qual evento faltou. Compras perdidas (`purchase.paid`) não aparecem na consulta e não são
 * reconstruídas aqui.
 */
export function reconcile(
  local: Projection | undefined,
  remote: CurrentSubscription | null,
  now: Date,
): Correction | Divergence | null {
  if (!remote) {
    if (!local || !isOpen(local.status)) return null;
    const deadline = local.periodEnd?.getTime();
    if (deadline === undefined || deadline + END_GRACE_MS > now.getTime()) {
      return { alert: 'plataforma sem assinatura vigente antes do fim do período local' };
    }
    const trial = local.status === 'trialing';
    return {
      type: 'subscription.ended',
      reason: 'assinatura encerrada na plataforma',
      subscription: {
        id: Number(local.subscriptionId),
        status: trial ? 'trial_expired' : 'cancelled',
      },
      data: { reason: trial ? 'trial_expired' : 'cancelled' },
    };
  }

  const subscription = {
    id: remote.subscriptionId,
    status: remote.status,
    modality: remote.modality,
    planId: remote.plan.id,
    periodStart: remote.periodStart,
    periodEnd: remote.periodEnd,
    version: remote.version,
  };

  if (!local || local.subscriptionId !== String(remote.subscriptionId)) {
    if (remote.status === 'trialing') {
      return {
        type: 'subscription.trial_started',
        reason: 'trial sem evento recebido',
        subscription,
        data: { trialEndsAt: remote.trial.endsAt ?? remote.periodEnd },
      };
    }
    if (remote.status === 'active' || remote.status === 'past_due') {
      return {
        type: 'subscription.activated',
        reason: 'assinatura sem evento de ativação recebido',
        subscription,
        data: {},
      };
    }
    return null;
  }

  if (remote.version <= local.version) return null;
  const paid = remote.status === 'active' || remote.status === 'past_due';
  if (paid && local.periodStart && Date.parse(remote.periodStart) > local.periodStart.getTime()) {
    return {
      type: 'subscription.renewed',
      reason: 'renovação sem evento recebido',
      subscription,
      data: {},
    };
  }
  if (remote.status === 'past_due' && local.status !== 'past_due') {
    return {
      type: 'subscription.past_due',
      reason: 'inadimplência sem evento recebido',
      subscription,
      data: {},
    };
  }
  if (remote.status === 'active' && local.status === 'past_due') {
    return {
      type: 'subscription.recovered',
      reason: 'pagamento regularizado sem evento recebido',
      subscription,
      data: {},
    };
  }
  return null;
}

function isOpen(status: Projection['status']): boolean {
  return status === 'trialing' || status === 'active' || status === 'past_due';
}

export interface ConsistencyReport {
  checked: number;
  corrected: number;
  alerts: number;
}

/**
 * Job de consistência (spec payments-integration, "Consistência da projeção local"; tarefa 12.10):
 * a cada 6 h compara a projeção de cada tenant instalado com `GET /v1/installations/{id}/subscription`.
 * Divergência ⇒ o evento que faltou é gravado em `payment_event` (registro da correção, com
 * `data.correction`) e aplicado pelo mesmo `SubscriptionEventsService`: efeitos idempotentes pelas
 * mesmas chaves do ledger, então um evento real que chegue depois não duplica nada.
 */
@Injectable()
export class SubscriptionConsistencyService {
  private readonly logger = new Logger(SubscriptionConsistencyService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly platform: PlatformApiClient,
    private readonly store: PlatformEventStore,
    private readonly subscriptions: SubscriptionEventsService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @Cron('17 */6 * * *', { name: 'subscription-consistency' })
  async run(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive(
          'job:subscription-consistency',
          5 * 3_600_000,
          () => this.checkAll(),
        );
        if (outcome.ran) this.logger.log(outcome.result, 'consistência das assinaturas');
      } catch (error) {
        this.logger.error({ err: error }, 'job de consistência das assinaturas falhou');
      }
    });
  }

  async checkAll(now = new Date()): Promise<ConsistencyReport> {
    const report: ConsistencyReport = { checked: 0, corrected: 0, alerts: 0 };
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows = await this.db
        .select()
        .from(tenant)
        .where(and(ne(tenant.status, 'UNINSTALLED'), gt(tenant.id, after)))
        .orderBy(asc(tenant.id))
        .limit(BATCH);
      for (const row of rows) {
        try {
          const outcome = await this.check(row, now);
          report.checked++;
          if (outcome === 'corrected') report.corrected++;
          if (outcome === 'alert') report.alerts++;
        } catch (error) {
          // Plataforma fora: o resto da rodada falharia igual; tenta de novo na próxima.
          if (isPlatformUnavailable(error)) throw error;
          this.logger.error({ err: error, tenantId: row.id }, 'consistência do tenant falhou');
        }
      }
      if (rows.length < BATCH) return report;
      after = rows[rows.length - 1]!.id;
    }
  }

  async check(
    row: typeof tenant.$inferSelect,
    now = new Date(),
  ): Promise<'ok' | 'corrected' | 'alert'> {
    const installationId = Number(row.installationId);
    const [local] = await this.db
      .select()
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, row.id));
    const remote = await this.platform.getSubscription(installationId).catch((error: unknown) => {
      if (error instanceof PlatformError && error.code === 'NO_SUBSCRIPTION') return null;
      throw error;
    });

    const result = reconcile(local, remote, now);
    if (!result) return 'ok';
    if ('alert' in result) {
      this.logger.warn(
        { alert: true, tenantId: row.id, installationId, local: local?.subscriptionId },
        result.alert,
      );
      return 'alert';
    }

    const event = {
      eventId: randomUUID(),
      type: result.type,
      appCode: APP_CODE,
      installationId,
      memberId: row.memberId,
      occurredAt: now.toISOString(),
      subscription: result.subscription,
      data: { ...result.data, correction: { source: 'consistency', reason: result.reason } },
    } as unknown as PlatformEvent;
    await this.store.record(event, row.id);
    await this.store.process(event.eventId, (stored) =>
      this.subscriptions.handle(stored).then(() => undefined),
    );
    this.logger.warn(
      {
        alert: true,
        tenantId: row.id,
        installationId,
        eventId: event.eventId,
        type: result.type,
        subscriptionId: result.subscription.id,
      },
      `projeção corrigida: ${result.reason}`,
    );
    return 'corrected';
  }
}
