import { Inject, Injectable } from '@nestjs/common';
import type { PlatformEvent } from '@crmthink-sources/platform-sdk';
import { and, eq, inArray, like, lt, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { paymentEvent } from '../../shared/database/schema/index';

export type StoredEvent = typeof paymentEvent.$inferSelect;

/** Depois disso o evento fica `FAILED` para análise manual (alerta), sem novas tentativas. */
export const MAX_EVENT_ATTEMPTS = 20;

/** `payment_event`: registro durável de tudo que chega em `/platform/events` (design D9). */
@Injectable()
export class PlatformEventStore {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Grava o evento; `false` se o `eventId` já existia (reentrega). */
  async record(event: PlatformEvent, tenantId: string | undefined): Promise<boolean> {
    const rows = await this.db
      .insert(paymentEvent)
      .values({
        eventId: event.eventId,
        type: event.type,
        installationId: String(event.installationId),
        tenantId,
        payload: event,
      })
      .onConflictDoNothing({ target: paymentEvent.eventId })
      .returning({ eventId: paymentEvent.eventId });
    return rows.length > 0;
  }

  /**
   * Processa o evento com a linha travada (`FOR UPDATE SKIP LOCKED`): entregas simultâneas do
   * mesmo evento (fila + varredura) não aplicam o efeito duas vezes. `false` se já processado ou
   * em processamento por outro consumidor.
   */
  async process(eventId: string, apply: (event: PlatformEvent) => Promise<void>): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(paymentEvent)
        .where(eq(paymentEvent.eventId, eventId))
        .for('update', { skipLocked: true });
      if (!row || row.status === 'PROCESSED' || row.status === 'OBSOLETE') return false;
      await apply(row.payload as PlatformEvent);
      await tx
        .update(paymentEvent)
        .set({ status: 'PROCESSED', processedAt: new Date(), error: null })
        .where(eq(paymentEvent.eventId, eventId));
      return true;
    });
  }

  async markFailed(eventId: string, error: unknown): Promise<number> {
    const [row] = await this.db
      .update(paymentEvent)
      .set({
        status: 'FAILED',
        attempts: sql`${paymentEvent.attempts} + 1`,
        error: String((error as Error)?.message ?? error).slice(0, 2000),
      })
      .where(eq(paymentEvent.eventId, eventId))
      .returning({ attempts: paymentEvent.attempts });
    return row?.attempts ?? 0;
  }

  /** Eventos pendentes de um prefixo de tipo (ex.: `installation.`) recebidos antes de `before`. */
  pending(
    typePrefix: string,
    before: Date,
    limit = 100,
  ): Promise<Pick<StoredEvent, 'eventId' | 'type'>[]> {
    return this.db
      .select({ eventId: paymentEvent.eventId, type: paymentEvent.type })
      .from(paymentEvent)
      .where(
        and(
          inArray(paymentEvent.status, ['RECEIVED', 'FAILED']),
          like(paymentEvent.type, `${typePrefix}%`),
          lt(paymentEvent.receivedAt, before),
          lt(paymentEvent.attempts, MAX_EVENT_ATTEMPTS),
        ),
      )
      .orderBy(paymentEvent.receivedAt)
      .limit(limit);
  }
}
