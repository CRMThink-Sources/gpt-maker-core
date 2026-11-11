import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CALENDAR_MODES } from '@gptmaker/contracts';
import { createdAt, encryptedText, timestamptz, updatedAt } from '../columns';
import { agent } from './agents';
import { backofficeUser } from './backoffice';
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

/**
 * Orientações das ferramentas do CRM editadas no backoffice (spec agent-crm-tools). Global; só
 * guarda a edição: sem linha, vale o padrão do código (restaurar o padrão apaga a linha).
 */
export const crmToolGuidance = pgTable('crm_tool_guidance', {
  key: text('key').primaryKey(),
  text: text('text').notNull(),
  updatedBy: uuid('updated_by').references(() => backofficeUser.id),
  updatedAt: updatedAt(),
});

export const calendarMode = pgEnum('calendar_mode', CALENDAR_MODES);

/**
 * Agenda do agente no Calendário do Bitrix24 (spec agent-calendar-scheduling, design D2): de quem é
 * a agenda e as regras dos horários. Sem linha = agenda não configurada. `user_ids` guarda ids de
 * usuários do portal (não são segredo). `last_scope_error_at` marca a última chamada recusada por
 * falta do escopo `calendar`, para o painel pedir a reautorização do app.
 */
export const agentCalendarConfig = pgTable(
  'agent_calendar_config',
  {
    agentId: uuid('agent_id')
      .primaryKey()
      .references(() => agent.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    mode: calendarMode('mode').notNull(),
    userIds: integer('user_ids')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    slotMinutes: integer('slot_minutes').notNull().default(30),
    minNoticeMinutes: integer('min_notice_minutes').notNull().default(60),
    maxDaysAhead: integer('max_days_ahead').notNull().default(7),
    lastScopeErrorAt: timestamptz('last_scope_error_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('agent_calendar_config_tenant_idx').on(t.tenantId),
    check(
      'agent_calendar_config_slot_minutes_ck',
      sql`${t.slotMinutes} between 15 and 240 and ${t.slotMinutes} % 5 = 0`,
    ),
    check('agent_calendar_config_min_notice_ck', sql`${t.minNoticeMinutes} between 0 and 1440`),
    check('agent_calendar_config_max_days_ck', sql`${t.maxDaysAhead} between 1 and 30`),
    check(
      'agent_calendar_config_user_ids_ck',
      sql`(${t.mode} = 'CLIENT_OWNER' and cardinality(${t.userIds}) = 0)
        or (${t.mode} = 'FIXED_USER' and cardinality(${t.userIds}) = 1)
        or (${t.mode} = 'USER_LIST' and cardinality(${t.userIds}) between 1 and 10)`,
    ),
  ],
);
