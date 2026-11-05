import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  creditLedger,
  reconciliationAdjustment,
  usageDailyReal,
  usageDailyUnlinked,
  workspaceSyncFinding,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { LedgerService } from '../billing';
import { GptMakerClient, GptMakerError } from '../gptmaker';

type Status = (typeof reconciliationAdjustment.$inferSelect)['status'];

/** Agente e dia cuja coleta falhou: o job de hora em hora tenta de novo. */
const PENDING_KEY = 'reconciliation:pending';
/** Idem para agentes sem vínculo (`<id no GPTMaker>|<dia>`). */
const PENDING_UNLINKED_KEY = 'reconciliation:pending-unlinked';
/** Pendência mais velha que isso é abandonada (com aviso): o job não retenta para sempre. */
export const MAX_PENDING_DAYS = 14;

/**
 * Agente que não existe mais no GPTMaker: removido lá, o `credits-spent` responde 400 (corpo
 * vazio, visto em staging) e não vai mudar com nova tentativa.
 */
export function agentGone(error: unknown): boolean {
  return error instanceof GptMakerError && (error.kind === 'NOT_FOUND' || error.status === 400);
}

/** Primeira falha (ms) além do prazo de retentativa. */
export function pendingExpired(firstFailedAt: number, now: number = Date.now()): boolean {
  return now - firstFailedAt > MAX_PENDING_DAYS * 86_400_000;
}

type AgentRow = {
  id: string;
  tenantId: string;
  gptmakerAgentId: string;
  /** Removido no app: um 400 do GPTMaker para ele é definitivo. */
  deletedAt?: Date | null;
};

/** Decisões do operador: valem enquanto o consumo e o débito do dia não mudarem. */
const REVIEWED: ReadonlySet<Status> = new Set(['APPROVED', 'DISMISSED']);
const DAY_MS = 86_400_000;

export interface AdjustmentDecision {
  /** Total que deve estar ajustado para o agente e o dia (positivo devolve, negativo cobra). */
  desired: number;
  status: Status;
}

/**
 * Ajuste devido para um agente e dia (spec usage-reconciliation; 1 crédito GPTMaker = 1 crédito do
 * cliente). `debited - real` positivo devolve créditos; negativo cobra. Dentro da tolerância, nada;
 * se o que falta lançar passa do limite de revisão, não lança sozinho e mantém o já ajustado.
 */
export function decideAdjustment(input: {
  real: number;
  debited: number;
  adjusted: number;
  tolerance: number;
  reviewThreshold: number;
}): AdjustmentDecision {
  const diff = input.debited - input.real;
  if (Math.abs(diff) <= input.tolerance) return { desired: 0, status: 'WITHIN_TOLERANCE' };
  // O limite vale para o que falta lançar: um dia já aprovado não volta à revisão por pouco.
  if (Math.abs(diff - input.adjusted) > input.reviewThreshold) {
    return { desired: input.adjusted, status: 'REVIEW' };
  }
  return { desired: diff, status: 'APPLIED' };
}

/** AAAA-MM-DD de `date` no fuso `timeZone`. */
export function dayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/** Os `count` dias anteriores a hoje (no fuso), do mais antigo ao mais recente. */
export function previousDays(now: Date, timeZone: string, count: number): string[] {
  const today = dayIn(now, timeZone);
  const base = Date.parse(`${today}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(base - (count - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

export interface ReconciliationOutcome {
  agentId: string;
  day: string;
  real: number;
  debited: number;
  status: Status;
  /** Ajuste lançado nesta execução (0 se nada mudou). */
  posted: number;
}

/**
 * Reconciliação diária (tarefas 14.1 e 14.2, design D7): para cada agente e dia, grava o consumo
 * real do GPTMaker (`credits-spent`, por modelo) em `usage_daily_real`, compara com os `DEBIT` do
 * agente no dia (no fuso configurado) e lança `ADJUSTMENT` da diferença acima da tolerância. O
 * total ajustado fica em `reconciliation_adjustment`: reexecutar lança só o que falta. Roda às
 * 03:20 de Brasília para os últimos dias (consumo atrasado) e, de hora em hora, retenta os
 * agentes cuja coleta falhou.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly gptmaker: GptMakerClient,
    private readonly ledger: LedgerService,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @Cron('20 6 * * *', { name: 'reconciliation-daily' })
  async runDaily(): Promise<void> {
    await this.exclusive('diária', () =>
      this.reconcileDays(
        previousDays(
          new Date(),
          this.env.RECONCILIATION_TIMEZONE,
          this.env.RECONCILIATION_LOOKBACK_DAYS,
        ),
      ),
    );
  }

  @Cron('40 * * * *', { name: 'reconciliation-retry' })
  async runRetry(): Promise<void> {
    await this.exclusive('retentativas', () => this.retryPending());
  }

  /** Todos os agentes (não removidos ou removidos dentro do período) nos dias dados. */
  async reconcileDays(days: string[]): Promise<ReconciliationOutcome[]> {
    if (days.length === 0) return [];
    // Removido até um dia antes do primeiro dia ainda pode ter consumo nele.
    const since = new Date(`${days[0]}T00:00:00Z`);
    const rows = await this.db
      .select({
        id: agent.id,
        tenantId: agent.tenantId,
        gptmakerAgentId: agent.gptmakerAgentId,
        deletedAt: agent.deletedAt,
      })
      .from(agent)
      .where(
        and(
          ne(agent.status, 'OUT_OF_SYNC'),
          or(isNull(agent.deletedAt), gte(agent.deletedAt, since)),
        ),
      );
    const outcomes: ReconciliationOutcome[] = [];
    for (const day of days) {
      for (const row of rows) {
        const outcome = await this.safely(row, day);
        if (outcome) outcomes.push(outcome);
      }
    }
    await this.collectUnlinked(days, new Set(rows.map((row) => row.gptmakerAgentId)));
    return outcomes;
  }

  /**
   * Consumo dos agentes do workspace sem vínculo com tenant (órfãos abertos do workspace-sync):
   * só gravado, sem ledger, para o relatório do partner. Agente já coberto pela reconciliação
   * (removido no período) não entra de novo.
   */
  async collectUnlinked(days: string[], covered: ReadonlySet<string> = new Set()): Promise<void> {
    const orphans = await this.db
      .selectDistinct({ gptmakerAgentId: workspaceSyncFinding.gptmakerAgentId })
      .from(workspaceSyncFinding)
      .where(and(eq(workspaceSyncFinding.kind, 'ORPHAN'), isNull(workspaceSyncFinding.resolvedAt)));
    for (const { gptmakerAgentId } of orphans) {
      if (covered.has(gptmakerAgentId)) continue;
      for (const day of days) await this.safelyUnlinked(gptmakerAgentId, day);
    }
  }

  private async safelyUnlinked(gptmakerAgentId: string, day: string): Promise<void> {
    const entry = `${gptmakerAgentId}|${day}`;
    try {
      const byModel = await this.spentOn(gptmakerAgentId, day);
      await this.db.transaction(async (tx) => {
        await tx
          .delete(usageDailyUnlinked)
          .where(
            and(
              eq(usageDailyUnlinked.gptmakerAgentId, gptmakerAgentId),
              eq(usageDailyUnlinked.day, day),
            ),
          );
        if (byModel.size) {
          await tx.insert(usageDailyUnlinked).values(
            [...byModel].map(([modelCode, credits]) => ({
              gptmakerAgentId,
              day,
              modelCode,
              credits,
            })),
          );
        }
      });
      await this.clearPending(PENDING_UNLINKED_KEY, entry);
    } catch (error) {
      // Sem registro local não dá para saber se o 400 (genérico no GPTMaker) é agente removido:
      // só 404 ou o prazo esgotado tiram o órfão da fila.
      if (
        (error instanceof GptMakerError && error.kind === 'NOT_FOUND') ||
        (await this.pendingTooLong(PENDING_UNLINKED_KEY, entry))
      ) {
        await this.clearPending(PENDING_UNLINKED_KEY, entry);
        this.logger.warn(
          { err: error, gptmakerAgentId, day },
          'coleta de consumo de agente sem vínculo abandonada',
        );
        return;
      }
      await this.markPending(PENDING_UNLINKED_KEY, entry);
      this.logger.warn(
        { err: error, gptmakerAgentId, day },
        'coleta de consumo de agente sem vínculo falhou; pendente',
      );
    }
  }

  async retryPending(): Promise<ReconciliationOutcome[]> {
    for (const entry of await this.redis.smembers(PENDING_UNLINKED_KEY)) {
      const [gptmakerAgentId, day] = entry.split('|') as [string, string];
      await this.safelyUnlinked(gptmakerAgentId, day);
    }
    const pending = await this.redis.smembers(PENDING_KEY);
    if (pending.length === 0) return [];
    const ids = [...new Set(pending.map((entry) => entry.split('|')[0]!))];
    const rows = await this.db
      .select({
        id: agent.id,
        tenantId: agent.tenantId,
        gptmakerAgentId: agent.gptmakerAgentId,
        deletedAt: agent.deletedAt,
      })
      .from(agent)
      .where(inArray(agent.id, ids));
    const outcomes: ReconciliationOutcome[] = [];
    for (const entry of pending) {
      const [agentId, day] = entry.split('|') as [string, string];
      const row = rows.find((r) => r.id === agentId);
      if (!row) {
        await this.clearPending(PENDING_KEY, entry);
        continue;
      }
      const outcome = await this.safely(row, day);
      if (outcome) outcomes.push(outcome);
    }
    return outcomes;
  }

  /** Falha num agente vira pendência; os demais seguem. */
  /** Entra na fila guardando a primeira falha; a retentativa usa esse horário para o prazo. */
  private async markPending(key: string, entry: string): Promise<void> {
    await this.redis.sadd(key, entry);
    await this.redis.hsetnx(`${key}:since`, entry, String(Date.now()));
  }

  private async clearPending(key: string, entry: string): Promise<void> {
    await this.redis.srem(key, entry);
    await this.redis.hdel(`${key}:since`, entry);
  }

  private async pendingTooLong(key: string, entry: string): Promise<boolean> {
    const since = await this.redis.hget(`${key}:since`, entry);
    return since !== null && pendingExpired(Number(since));
  }

  private async safely(row: AgentRow, day: string): Promise<ReconciliationOutcome | null> {
    const entry = `${row.id}|${day}`;
    try {
      const outcome = await this.reconcileAgentDay(row, day);
      await this.clearPending(PENDING_KEY, entry);
      return outcome;
    } catch (error) {
      if (row.deletedAt && agentGone(error)) {
        await this.clearPending(PENDING_KEY, entry);
        this.logger.log(
          { agentId: row.id, day },
          'agente removido não existe mais no GPTMaker: consumo do dia indisponível, sem nova tentativa',
        );
        return null;
      }
      if (await this.pendingTooLong(PENDING_KEY, entry)) {
        await this.clearPending(PENDING_KEY, entry);
        this.logger.warn(
          { err: error, agentId: row.id, day },
          `reconciliação do agente abandonada após ${MAX_PENDING_DAYS} dias de tentativas`,
        );
        return null;
      }
      await this.markPending(PENDING_KEY, entry);
      this.logger.warn(
        { err: error, agentId: row.id, day },
        'reconciliação do agente falhou; pendente',
      );
      return null;
    }
  }

  async reconcileAgentDay(
    row: { id: string; tenantId: string; gptmakerAgentId: string },
    day: string,
  ): Promise<ReconciliationOutcome> {
    const byModel = await this.spentOn(row.gptmakerAgentId, day);
    const real = [...byModel.values()].reduce((sum, credits) => sum + credits, 0);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(usageDailyReal)
        .where(and(eq(usageDailyReal.agentId, row.id), eq(usageDailyReal.day, day)));
      if (byModel.size) {
        await tx.insert(usageDailyReal).values(
          [...byModel].map(([modelCode, credits]) => ({
            agentId: row.id,
            tenantId: row.tenantId,
            day,
            modelCode,
            credits,
          })),
        );
      }
    });

    const debited = await this.debitedOn(row.id, day);
    const [previous] = await this.db
      .select()
      .from(reconciliationAdjustment)
      .where(
        and(eq(reconciliationAdjustment.agentId, row.id), eq(reconciliationAdjustment.day, day)),
      );
    if (
      previous &&
      REVIEWED.has(previous.status) &&
      previous.realTotal === real &&
      previous.debitedTotal === debited
    ) {
      return { agentId: row.id, day, real, debited, status: previous.status, posted: 0 };
    }
    const adjusted = previous?.adjustedTotal ?? 0;
    const decision = decideAdjustment({
      real,
      debited,
      adjusted,
      tolerance: this.env.RECONCILIATION_TOLERANCE_CREDITS,
      reviewThreshold: this.env.RECONCILIATION_REVIEW_THRESHOLD_CREDITS,
    });

    const posted = decision.desired - adjusted;
    if (posted !== 0) {
      // A chave inclui o total anterior: 0→5, 5→3 e 3→5 são operações distintas; repetir a
      // mesma (queda entre o lançamento e a gravação abaixo) não lança de novo.
      await this.ledger.adjust({
        tenantId: row.tenantId,
        key: `recon:${row.id}:${day}:${adjusted}->${decision.desired}`,
        amount: posted,
        agentId: row.id,
        refType: 'reconciliation',
        refId: `${row.id}:${day}`,
        reason: `reconciliação de ${day}: GPTMaker ${real}, debitado ${debited}`,
        createdBy: 'system:reconciliation',
      });
    }
    const values = {
      tenantId: row.tenantId,
      realTotal: real,
      debitedTotal: debited,
      adjustedTotal: decision.desired,
      status: decision.status,
      reviewedBy: null,
      reviewedAt: null,
    };
    await this.db
      .insert(reconciliationAdjustment)
      .values({ agentId: row.id, day, ...values })
      .onConflictDoUpdate({
        target: [reconciliationAdjustment.agentId, reconciliationAdjustment.day],
        set: values,
      });

    if (decision.status === 'REVIEW') {
      this.logger.error(
        { alert: true, agentId: row.id, tenantId: row.tenantId, day, real, debited },
        'diferença de consumo acima do limite: ajuste aguardando revisão',
      );
    } else if (posted !== 0) {
      this.logger.log({ agentId: row.id, day, real, debited, posted }, 'consumo reconciliado');
    }
    return { agentId: row.id, day, real, debited, status: decision.status, posted };
  }

  /**
   * Decisão do operador sobre um ajuste em revisão (backoffice). Aprovar lança o ajuste da
   * diferença inteira (`debitado - real` dos totais revisados); descartar mantém o que já estava
   * ajustado. A decisão vale enquanto os totais do dia não mudarem.
   */
  async resolveReview(
    agentId: string,
    day: string,
    decision: 'approve' | 'dismiss',
    actor: string,
  ): Promise<typeof reconciliationAdjustment.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(reconciliationAdjustment)
      .where(
        and(
          eq(reconciliationAdjustment.agentId, agentId),
          eq(reconciliationAdjustment.day, day),
          eq(reconciliationAdjustment.status, 'REVIEW'),
        ),
      );
    if (!row) {
      throw new DomainError(
        'REVIEW_NOT_FOUND',
        'Ajuste em revisão não encontrado ou já decidido.',
        HttpStatus.NOT_FOUND,
      );
    }
    const desired = decision === 'approve' ? row.debitedTotal - row.realTotal : row.adjustedTotal;
    const posted = desired - row.adjustedTotal;
    if (posted !== 0) {
      await this.ledger.adjust({
        tenantId: row.tenantId,
        key: `recon:${agentId}:${day}:${row.adjustedTotal}->${desired}`,
        amount: posted,
        agentId,
        refType: 'reconciliation',
        refId: `${agentId}:${day}`,
        reason: `revisão aprovada de ${day}: GPTMaker ${row.realTotal}, debitado ${row.debitedTotal}`,
        createdBy: `operator:${actor}`,
      });
    }
    const [updated] = await this.db
      .update(reconciliationAdjustment)
      .set({
        adjustedTotal: desired,
        status: decision === 'approve' ? 'APPROVED' : 'DISMISSED',
        reviewedBy: actor,
        reviewedAt: new Date(),
      })
      .where(
        and(eq(reconciliationAdjustment.agentId, agentId), eq(reconciliationAdjustment.day, day)),
      )
      .returning();
    return updated!;
  }

  /** Consumo real do agente no dia, por modelo (`credits-spent`). */
  private async spentOn(gptmakerAgentId: string, day: string): Promise<Map<string, number>> {
    const [year, month, dayOfMonth] = day.split('-').map(Number) as [number, number, number];
    const spent = await this.gptmaker.getCreditsSpent(gptmakerAgentId, {
      year,
      month,
      day: dayOfMonth,
    });
    const byModel = new Map<string, number>();
    for (const item of spent.data) {
      if (item.year !== year || item.month !== month || item.day !== dayOfMonth) continue;
      byModel.set(item.model, (byModel.get(item.model) ?? 0) + item.credits);
    }
    return byModel;
  }

  /** Créditos debitados do agente no dia (no fuso da reconciliação). */
  private async debitedOn(agentId: string, day: string): Promise<number> {
    const tz = sql.raw(`'${this.env.RECONCILIATION_TIMEZONE.replace(/'/g, '')}'`);
    const [row] = await this.db
      .select({ total: sql<string | null>`-sum(${creditLedger.amount})` })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.agentId, agentId),
          eq(creditLedger.type, 'DEBIT'),
          gte(creditLedger.createdAt, sql`(${day}::date)::timestamp at time zone ${tz}`),
          lt(creditLedger.createdAt, sql`(${day}::date + 1)::timestamp at time zone ${tz}`),
        ),
      );
    return Number(row?.total ?? 0);
  }

  private async exclusive<T extends unknown[]>(label: string, fn: () => Promise<T>): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive('job:reconciliation', 50 * 60_000, fn);
        if (outcome.ran) {
          const result = outcome.result;
          const posted = result.filter((r) => (r as ReconciliationOutcome).posted !== 0).length;
          const review = result.filter(
            (r) => (r as ReconciliationOutcome).status === 'REVIEW',
          ).length;
          this.logger.log({ label, checked: result.length, posted, review }, 'reconciliação');
        }
      } catch (error) {
        this.logger.error({ err: error, label }, 'reconciliação falhou');
      }
    });
  }
}
