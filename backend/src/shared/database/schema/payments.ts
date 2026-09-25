import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, timestamptz, updatedAt } from '../columns';
import { tenant } from './tenancy';

export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'trial_expired',
]);

export const subscriptionModality = pgEnum('subscription_modality', ['stripe', 'manual']);

/** Projeção local da assinatura do tenant, alimentada pelos eventos do crmthink-platform (design D9). */
export const subscriptionState = pgTable('subscription_state', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenant.id),
  subscriptionId: text('subscription_id').notNull(),
  status: subscriptionStatus('status').notNull(),
  modality: subscriptionModality('modality').notNull(),
  planId: text('plan_id'),
  /** Plano que passa a valer na próxima renovação (downgrade agendado). */
  nextPlanId: text('next_plan_id'),
  periodStart: timestamptz('period_start'),
  periodEnd: timestamptz('period_end'),
  /** Última `subscription.version` aplicada; eventos com versão menor são ignorados. */
  version: integer('version').notNull(),
  graceUntil: timestamptz('grace_until'),
  cancelAt: timestamptz('cancel_at'),
  updatedAt: updatedAt(),
});

export const paymentEventStatus = pgEnum('payment_event_status', [
  'RECEIVED',
  'PROCESSED',
  'OBSOLETE',
  'FAILED',
]);

/** Eventos recebidos em `/platform/events`; `event_id` deduplica reentregas. */
export const paymentEvent = pgTable(
  'payment_event',
  {
    eventId: text('event_id').primaryKey(),
    type: text('type').notNull(),
    installationId: text('installation_id').notNull(),
    tenantId: uuid('tenant_id').references(() => tenant.id),
    payload: jsonb('payload').notNull(),
    status: paymentEventStatus('status').notNull().default('RECEIVED'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    processedAt: timestamptz('processed_at'),
  },
  (t) => [
    index('payment_event_tenant_idx').on(t.tenantId, t.receivedAt),
    index('payment_event_pending_idx')
      .on(t.receivedAt)
      .where(sql`${t.status} in ('RECEIVED', 'FAILED')`),
  ],
);

export const outboxStatus = pgEnum('outbox_status', ['PENDING', 'DONE', 'FAILED']);

/** Chamadas de saída não críticas ao crmthink-platform (itens de assinatura por agente), com retentativa. */
export const paymentsOutbox = pgTable(
  'payments_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    operation: text('operation').notNull(),
    /** Referência do agregado (ex.: id do agente); operações do mesmo agregado são aplicadas em ordem. */
    aggregateRef: text('aggregate_ref').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: createdAt(),
    processedAt: timestamptz('processed_at'),
  },
  (t) => [
    index('payments_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'PENDING'`),
    index('payments_outbox_aggregate_idx').on(t.aggregateRef, t.createdAt),
  ],
);
