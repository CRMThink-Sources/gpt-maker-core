import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, encryptedText, timestamptz, updatedAt } from '../columns';
import { agent } from './agents';
import { tenant } from './tenancy';

export const gptmakerEvent = pgEnum('gptmaker_event', [
  'onNewMessage',
  'onLackKnowLedge',
  'onTransfer',
  'onFirstInteraction',
  'onStartInteraction',
  'onFinishInteraction',
  'onCreateEvent',
  'onCancelEvent',
]);

/** Webhook recebido do GPTMaker, gravado antes de avaliar os gatilhos (design D12). */
export const agentEvent = pgTable(
  'agent_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    event: gptmakerEvent('event').notNull(),
    dialogId: text('dialog_id'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
  },
  (t) => [index('agent_event_agent_idx').on(t.agentId, t.receivedAt)],
);

export const trigger = pgTable(
  'trigger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    name: text('name').notNull(),
    event: gptmakerEvent('event').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    index('trigger_agent_event_idx')
      .on(t.agentId, t.event)
      .where(sql`${t.active} and ${t.deletedAt} is null`),
    index('trigger_tenant_idx').on(t.tenantId),
  ],
);

export const triggerActionType = pgEnum('trigger_action_type', [
  'CREATE_LEAD',
  'UPSERT_DEAL',
  'TIMELINE_COMMENT',
  'CREATE_TASK',
  'START_BIZPROC',
  'OUTBOUND_WEBHOOK',
]);

export const triggerAction = pgTable(
  'trigger_action',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    triggerId: uuid('trigger_id')
      .notNull()
      .references(() => trigger.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: triggerActionType('type').notNull(),
    /** Configuração da ação e templates de mapeamento de campos (`{{contact.name}}`). */
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    /** Segredo HMAC do webhook de saída, cifrado em repouso. */
    secret: encryptedText('secret'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Removida do gatilho na edição; fica para o histórico (`trigger_execution`). */
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    uniqueIndex('trigger_action_position_uq')
      .on(t.triggerId, t.position)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const triggerExecutionStatus = pgEnum('trigger_execution_status', [
  'PENDING',
  'SUCCESS',
  'FAILED',
]);

export const triggerExecution = pgTable(
  'trigger_execution',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    triggerId: uuid('trigger_id')
      .notNull()
      .references(() => trigger.id),
    actionId: uuid('action_id')
      .notNull()
      .references(() => triggerAction.id),
    agentEventId: uuid('agent_event_id')
      .notNull()
      .references(() => agentEvent.id),
    status: triggerExecutionStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    result: jsonb('result'),
    createdAt: createdAt(),
    finishedAt: timestamptz('finished_at'),
    /**
     * `PENDING`: quando pode rodar (retentativa com espera crescente). Também serve de reserva:
     * quem vai executar empurra a data para frente, e outro processo não pega a mesma linha.
     */
    nextAttemptAt: timestamptz('next_attempt_at'),
  },
  (t) => [
    // Uma execução por ação e evento: reentrega do evento não duplica a ação.
    uniqueIndex('trigger_execution_event_action_uq').on(t.agentEventId, t.actionId),
    index('trigger_execution_trigger_idx').on(t.triggerId, t.createdAt),
    index('trigger_execution_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);
