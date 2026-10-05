import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lte, or } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  agentEvent,
  tenant,
  trigger,
  triggerAction,
  triggerExecution,
} from '../../shared/database/schema/index';
import { ActionError } from './actions/action-error';
import { type ExecutableAction, TriggerActionExecutor } from './actions/action-executor';
import { buildTemplateContext } from './template-context';

/** Esperas entre as tentativas de uma ação: 1 min, 5 min, 15 min, 1 h (5 tentativas no total). */
export const TRIGGER_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
export const TRIGGER_MAX_ATTEMPTS = TRIGGER_RETRY_DELAYS_MS.length + 1;
/** Reserva da linha enquanto a ação roda: depois disso, a varredura pode pegar de novo. */
const LEASE_MS = 2 * 60_000;
/** Execuções vencidas por rodada da varredura. */
const SWEEP_BATCH = 100;

export type RunOutcome = 'success' | 'retry' | 'failed' | 'skipped';

/**
 * Execução dos gatilhos (spec agent-triggers: execução assíncrona e auditável). `evaluate` cria
 * uma `trigger_execution` por ação dos gatilhos ativos do evento (única por evento e ação) e roda
 * as pendentes, na ordem do gatilho. Falha transitória ⇒ nova tentativa com espera crescente,
 * pela varredura (`runDue`); esgotada ou definitiva ⇒ `FAILED` com o erro.
 */
@Injectable()
export class TriggerRunner {
  private readonly logger = new Logger(TriggerRunner.name);

  constructor(
    private readonly executor: TriggerActionExecutor,
    @Inject(DB) private readonly db: Database,
  ) {}

  async evaluate(agentEventId: string, now = new Date()): Promise<RunOutcome[]> {
    const [event] = await this.db
      .select({
        agentId: agentEvent.agentId,
        tenantId: agentEvent.tenantId,
        event: agentEvent.event,
      })
      .from(agentEvent)
      .where(eq(agentEvent.id, agentEventId));
    if (!event) {
      this.logger.warn({ agentEventId }, 'evento do agente não encontrado');
      return [];
    }

    const actions = await this.db
      .select({ triggerId: trigger.id, actionId: triggerAction.id })
      .from(trigger)
      .innerJoin(triggerAction, eq(triggerAction.triggerId, trigger.id))
      .where(
        and(
          eq(trigger.agentId, event.agentId),
          eq(trigger.event, event.event),
          eq(trigger.active, true),
          isNull(trigger.deletedAt),
          isNull(triggerAction.deletedAt),
        ),
      );
    if (actions.length) {
      await this.db
        .insert(triggerExecution)
        .values(
          actions.map((row) => ({
            tenantId: event.tenantId,
            triggerId: row.triggerId,
            actionId: row.actionId,
            agentEventId,
            nextAttemptAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    // Inclui as que já existiam (reentrega do evento): só as pendentes rodam.
    const pending = await this.db
      .select({ id: triggerExecution.id })
      .from(triggerExecution)
      .innerJoin(trigger, eq(trigger.id, triggerExecution.triggerId))
      .innerJoin(triggerAction, eq(triggerAction.id, triggerExecution.actionId))
      .where(
        and(
          eq(triggerExecution.agentEventId, agentEventId),
          eq(triggerExecution.status, 'PENDING'),
        ),
      )
      .orderBy(asc(trigger.createdAt), asc(trigger.id), asc(triggerAction.position));
    const outcomes: RunOutcome[] = [];
    for (const row of pending) outcomes.push(await this.run(row.id, now));
    return outcomes;
  }

  /** Varredura: retentativas vencidas e reservas abandonadas (processo que caiu no meio). */
  async runDue(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: triggerExecution.id })
      .from(triggerExecution)
      .where(and(eq(triggerExecution.status, 'PENDING'), lte(triggerExecution.nextAttemptAt, now)))
      .orderBy(asc(triggerExecution.nextAttemptAt))
      .limit(SWEEP_BATCH);
    for (const row of due) await this.run(row.id, now);
    return due.length;
  }

  /** Uma tentativa de uma execução, se ela estiver pendente e vencida (reserva atômica). */
  async run(executionId: string, now = new Date()): Promise<RunOutcome> {
    const [claimed] = await this.db
      .update(triggerExecution)
      .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
      .where(
        and(
          eq(triggerExecution.id, executionId),
          eq(triggerExecution.status, 'PENDING'),
          or(isNull(triggerExecution.nextAttemptAt), lte(triggerExecution.nextAttemptAt, now)),
        ),
      )
      .returning({ attempts: triggerExecution.attempts });
    if (!claimed) return 'skipped';

    const [row] = await this.db
      .select({
        action: {
          id: triggerAction.id,
          type: triggerAction.type,
          config: triggerAction.config,
          secret: triggerAction.secret,
          deletedAt: triggerAction.deletedAt,
        },
        trigger: { active: trigger.active, deletedAt: trigger.deletedAt },
        event: {
          id: agentEvent.id,
          event: agentEvent.event,
          dialogId: agentEvent.dialogId,
          payload: agentEvent.payload,
          receivedAt: agentEvent.receivedAt,
        },
        agent: { id: agent.id, name: agent.name },
        tenant: { installationId: tenant.installationId, status: tenant.status },
      })
      .from(triggerExecution)
      .innerJoin(triggerAction, eq(triggerAction.id, triggerExecution.actionId))
      .innerJoin(trigger, eq(trigger.id, triggerExecution.triggerId))
      .innerJoin(agentEvent, eq(agentEvent.id, triggerExecution.agentEventId))
      .innerJoin(agent, eq(agent.id, agentEvent.agentId))
      .innerJoin(tenant, eq(tenant.id, triggerExecution.tenantId))
      .where(eq(triggerExecution.id, executionId));
    if (!row) return 'skipped';

    const attempts = claimed.attempts + 1;
    if (!row.trigger.active || row.trigger.deletedAt || row.action.deletedAt) {
      return this.fail(executionId, claimed.attempts, 'gatilho desativado ou removido', now);
    }
    if (row.tenant.status === 'UNINSTALLED' || row.tenant.status === 'SUSPENDED') {
      return this.fail(executionId, claimed.attempts, `portal ${row.tenant.status}`, now);
    }

    try {
      if (row.tenant.status === 'AUTH_ERROR') {
        throw new ActionError('portal sem credencial válida (AUTH_ERROR)', { transient: true });
      }
      const result = await this.executor.execute(
        {
          id: row.action.id,
          type: row.action.type,
          config: row.action.config,
          secret: row.action.secret,
        } as ExecutableAction,
        {
          installationId: Number(row.tenant.installationId),
          agentEventId: row.event.id,
          dialogId: row.event.dialogId,
          template: buildTemplateContext(row.event, row.agent),
        },
      );
      await this.db
        .update(triggerExecution)
        .set({
          status: 'SUCCESS',
          attempts,
          result,
          error: null,
          finishedAt: now,
          nextAttemptAt: null,
        })
        .where(eq(triggerExecution.id, executionId));
      return 'success';
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const transient = !(error instanceof ActionError) || error.transient;
      if (transient && attempts < TRIGGER_MAX_ATTEMPTS) {
        const delay = TRIGGER_RETRY_DELAYS_MS[attempts - 1]!;
        await this.db
          .update(triggerExecution)
          .set({ attempts, error: message, nextAttemptAt: new Date(now.getTime() + delay) })
          .where(eq(triggerExecution.id, executionId));
        this.logger.warn(
          { executionId, attempts, delayMs: delay, err: error },
          'ação do gatilho reagendada',
        );
        return 'retry';
      }
      return this.fail(executionId, attempts, message, now);
    }
  }

  private async fail(
    executionId: string,
    attempts: number,
    error: string,
    now: Date,
  ): Promise<RunOutcome> {
    await this.db
      .update(triggerExecution)
      .set({ status: 'FAILED', attempts, error, finishedAt: now, nextAttemptAt: null })
      .where(eq(triggerExecution.id, executionId));
    this.logger.warn({ executionId, attempts, error }, 'ação do gatilho falhou');
    return 'failed';
  }
}

/** Execuções de um gatilho, mais recentes primeiro (histórico, spec agent-triggers). */
export function executionsOf(db: Database, triggerId: string, limit: number) {
  return db
    .select({
      id: triggerExecution.id,
      actionId: triggerExecution.actionId,
      actionType: triggerAction.type,
      event: agentEvent.event,
      dialogId: agentEvent.dialogId,
      status: triggerExecution.status,
      attempts: triggerExecution.attempts,
      error: triggerExecution.error,
      result: triggerExecution.result,
      createdAt: triggerExecution.createdAt,
      finishedAt: triggerExecution.finishedAt,
      nextAttemptAt: triggerExecution.nextAttemptAt,
    })
    .from(triggerExecution)
    .innerJoin(triggerAction, eq(triggerAction.id, triggerExecution.actionId))
    .innerJoin(agentEvent, eq(agentEvent.id, triggerExecution.agentEventId))
    .where(eq(triggerExecution.triggerId, triggerId))
    .orderBy(desc(triggerExecution.createdAt), asc(triggerAction.position))
    .limit(limit);
}
