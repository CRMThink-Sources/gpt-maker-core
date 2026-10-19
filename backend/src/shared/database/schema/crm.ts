import { boolean, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, encryptedText, timestamptz, updatedAt } from '../columns';
import { agent } from './agents';
import { tenant } from './tenancy';

export const crmEntity = pgEnum('crm_entity', ['lead', 'deal', 'contact', 'company']);

/**
 * Escolhas do cliente sobre um campo do CRM (spec crm-semantic-layer, design S1): se o agente
 * pode ler e o que o campo significa. Os metadados vêm do portal; sem linha, vale o padrão.
 */
export const crmFieldSetting = pgTable(
  'crm_field_setting',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    entity: crmEntity('entity').notNull(),
    fieldCode: text('field_code').notNull(),
    exposed: boolean('exposed').notNull(),
    description: text('description').notNull().default(''),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.entity, t.fieldCode] })],
);

export const crmAccessStatus = pgEnum('crm_access_status', [
  'DISABLED',
  'CONNECTING',
  'CONNECTED',
  'ERROR',
]);

/**
 * Acesso do agente ao CRM (spec agent-crm-tools, design S3): credencial exclusiva (hash para
 * autenticar, cifrada para reenviar ao GPTMaker) e o que foi criado no agente do GPTMaker.
 */
export const agentCrmAccess = pgTable(
  'agent_crm_access',
  {
    agentId: uuid('agent_id')
      .primaryKey()
      .references(() => agent.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    status: crmAccessStatus('status').notNull().default('DISABLED'),
    tokenHash: text('token_hash'),
    tokenEncrypted: encryptedText('token_encrypted'),
    gptmakerIntentionId: text('gptmaker_intention_id'),
    gptmakerMcpId: text('gptmaker_mcp_id'),
    /** Motivo resumido da última falha ao conectar (sem dados do cliente). */
    lastError: text('last_error'),
    lastCallAt: timestamptz('last_call_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('agent_crm_access_token_hash_uq').on(t.tokenHash)],
);
