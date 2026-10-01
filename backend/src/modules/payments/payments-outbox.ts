import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { paymentsOutbox } from '../../shared/database/schema/index';

export type OutboxRow = typeof paymentsOutbox.$inferSelect;

/** Executor aceito: conexão normal ou a transação que gravou a mudança local. */
type Executor = Pick<Database, 'insert' | 'update'>;

/** Operações conhecidas; cada uma leva o estado atual do agregado ao serviço (idempotente). */
export const OUTBOX_OPERATIONS = { agentItemSync: 'agent-item.sync' } as const;
export type OutboxOperation = (typeof OUTBOX_OPERATIONS)[keyof typeof OUTBOX_OPERATIONS];

/** Depois disso a linha fica `FAILED` para análise manual (alerta), sem novas tentativas. */
export const MAX_OUTBOX_ATTEMPTS = 20;
const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 3_600_000;

/** Resultado de um handler: `skipped` encerra a linha sem efeito no serviço, com o motivo. */
export type OutboxOutcome = void | { skipped: string };
export type OutboxHandler = (row: OutboxRow) => Promise<OutboxOutcome>;

/**
 * `payments_outbox` (design D9): chamadas de saída não críticas ao crmthink-platform, gravadas na
 * mesma transação da mudança local e aplicadas depois, com retentativa. As operações sincronizam
 * o estado atual do agregado, então linhas pendentes do mesmo agregado se fundem numa só.
 */
@Injectable()
export class PaymentsOutbox {
  private readonly logger = new Logger(PaymentsOutbox.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Agenda a operação para já. Linha pendente do mesmo agregado é reaproveitada; se ela estiver
   * sendo processada, o `UPDATE` espera o fim e, já concluída, uma linha nova é criada, para a
   * mudança desta transação não se perder.
   */
  async enqueue(
    tenantId: string,
    operation: OutboxOperation,
    aggregateRef: string,
    executor: Executor = this.db,
  ): Promise<void> {
    const reused = await executor
      .update(paymentsOutbox)
      .set({ nextAttemptAt: new Date() })
      .where(
        and(
          eq(paymentsOutbox.aggregateRef, aggregateRef),
          eq(paymentsOutbox.operation, operation),
          eq(paymentsOutbox.status, 'PENDING'),
        ),
      )
      .returning({ id: paymentsOutbox.id });
    if (reused.length) return;
    await executor
      .insert(paymentsOutbox)
      .values({ tenantId, operation, aggregateRef, payload: {} });
  }

  /**
   * Aplica as linhas vencidas, uma por transação com a linha travada (`FOR UPDATE SKIP LOCKED`).
   * Falha reagenda com espera exponencial; esgotadas as tentativas, `FAILED`.
   */
  async processDue(handlers: Record<string, OutboxHandler>, limit = 100): Promise<number> {
    let processed = 0;
    while (processed < limit) {
      const handled = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(paymentsOutbox)
          .where(
            and(
              eq(paymentsOutbox.status, 'PENDING'),
              lte(paymentsOutbox.nextAttemptAt, new Date()),
            ),
          )
          .orderBy(asc(paymentsOutbox.nextAttemptAt), asc(paymentsOutbox.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!row) return false;

        const attempts = row.attempts + 1;
        try {
          const handler = handlers[row.operation];
          if (!handler) throw new Error(`operação desconhecida: ${row.operation}`);
          const outcome = await handler(row);
          await tx
            .update(paymentsOutbox)
            .set({
              status: 'DONE',
              attempts,
              processedAt: new Date(),
              lastError: outcome?.skipped ?? null,
            })
            .where(eq(paymentsOutbox.id, row.id));
        } catch (error) {
          const failed = attempts >= MAX_OUTBOX_ATTEMPTS;
          const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
          await tx
            .update(paymentsOutbox)
            .set({
              status: failed ? 'FAILED' : 'PENDING',
              attempts,
              nextAttemptAt: new Date(Date.now() + delay),
              lastError: error instanceof Error ? error.message : String(error),
            })
            .where(eq(paymentsOutbox.id, row.id));
          this.logger.error(
            {
              outboxId: row.id,
              operation: row.operation,
              aggregateRef: row.aggregateRef,
              attempts,
              alert: failed,
              err: error,
            },
            'chamada ao crmthink-platform falhou',
          );
        }
        return true;
      });
      if (!handled) break;
      processed += 1;
    }
    return processed;
  }
}
