import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, timestamptz } from '../columns';
import { agent } from './agents';
import { tenant } from './tenancy';

export const testClientType = pgEnum('agent_test_client_type', ['contact', 'lead', 'company']);

/**
 * Conversa de teste com o agente (spec agent-test-chat, design T1/T2): contexto próprio no
 * GPTMaker (`<tenantId>:test-<id>`), nunca reutilizado; cliente do CRM simulado opcional.
 */
export const agentTestConversation = pgTable(
  'agent_test_conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    contextId: text('context_id').notNull(),
    clientType: testClientType('client_type'),
    clientId: integer('client_id'),
    /** Só para exibir no modal. */
    clientName: text('client_name'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdByName: text('created_by_name').notNull(),
    lastMessageAt: timestamptz('last_message_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('agent_test_conversation_context_uq').on(t.contextId),
    index('agent_test_conversation_agent_idx').on(t.agentId, sql`${t.lastMessageAt} desc`),
  ],
);

export const testMessageRole = pgEnum('agent_test_message_role', ['USER', 'AGENT']);
export const testMessageStatus = pgEnum('agent_test_message_status', [
  'PENDING',
  'ANSWERED',
  'FAILED',
  'DELIVERED',
]);

/** Mensagens da conversa de teste: as do testador (`USER`) e as respostas do agente (`AGENT`). */
export const agentTestMessage = pgTable(
  'agent_test_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => agentTestConversation.id, { onDelete: 'cascade' }),
    role: testMessageRole('role').notNull(),
    text: text('text').notNull(),
    status: testMessageStatus('status').notNull(),
    modelCode: text('model_code'),
    createdAt: createdAt(),
  },
  (t) => [index('agent_test_message_conversation_idx').on(t.conversationId, t.createdAt)],
);
