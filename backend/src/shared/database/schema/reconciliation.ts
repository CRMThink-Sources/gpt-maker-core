import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz, updatedAt } from '../columns';
import { agent } from './agents';
import { tenant } from './tenancy';

/** Consumo real do GPTMaker (`credits-spent`) por agente, dia e modelo (design D7). */
export const usageDailyReal = pgTable(
  'usage_daily_real',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    day: date('day', { mode: 'string' }).notNull(),
    modelCode: text('model_code').notNull(),
    credits: integer('credits').notNull(),
    collectedAt: timestamptz('collected_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.day, t.modelCode] }),
    index('usage_daily_real_tenant_day_idx').on(t.tenantId, t.day),
  ],
);

/**
 * Total já ajustado por (agente, dia): a reexecução lança só a diferença ainda não ajustada.
 * O `ADJUSTMENT` no ledger usa idempotency key com esse total.
 */
export const reconciliationAdjustment = pgTable(
  'reconciliation_adjustment',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    day: date('day', { mode: 'string' }).notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    realTotal: integer('real_total').notNull(),
    debitedTotal: integer('debited_total').notNull(),
    /** Soma dos `ADJUSTMENT` já lançados (positivo devolve créditos, negativo cobra). */
    adjustedTotal: integer('adjusted_total').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.day] })],
);

export const workspaceFindingKind = pgEnum('workspace_finding_kind', [
  'ORPHAN',
  'MISSING',
  'STATUS_MISMATCH',
]);

/** Divergências entre o workspace GPTMaker e o registro local (job workspace-sync). */
export const workspaceSyncFinding = pgTable(
  'workspace_sync_finding',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: workspaceFindingKind('kind').notNull(),
    gptmakerAgentId: text('gptmaker_agent_id').notNull(),
    agentId: uuid('agent_id').references(() => agent.id),
    details: jsonb('details'),
    detectedAt: timestamptz('detected_at').notNull().defaultNow(),
    resolvedAt: timestamptz('resolved_at'),
    resolvedBy: text('resolved_by'),
    resolution: text('resolution'),
  },
  (t) => [
    // Uma divergência aberta por agente e tipo; a próxima execução do job não duplica.
    uniqueIndex('workspace_sync_finding_open_uq')
      .on(t.kind, t.gptmakerAgentId)
      .where(sql`${t.resolvedAt} is null`),
  ],
);
