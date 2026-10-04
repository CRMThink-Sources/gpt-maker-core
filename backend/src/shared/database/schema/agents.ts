import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { createdAt, timestamptz, updatedAt } from '../columns';
import { aiModel } from './models';
import { tenant } from './tenancy';

export const agentType = pgEnum('agent_type', ['SUPPORT', 'SALE', 'PERSONAL']);
export const communicationType = pgEnum('communication_type', ['FORMAL', 'NORMAL', 'RELAXED']);
export const agentStatus = pgEnum('agent_status', ['ACTIVE', 'INACTIVE', 'DELETED', 'OUT_OF_SYNC']);
export const agentInactiveReason = pgEnum('agent_inactive_reason', [
  'MANUAL',
  'SUBSCRIPTION_EXPIRED',
  'TENANT_SUSPENDED',
  'UNINSTALLED',
]);

/** Registro local e dono do agente no workspace GPTMaker compartilhado (design D2). */
export const agent = pgTable(
  'agent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    gptmakerAgentId: text('gptmaker_agent_id').notNull(),
    /** Nome exibido ao cliente, sem o prefixo `[<tenantCode>]` usado no GPTMaker. */
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    behavior: text('behavior'),
    type: agentType('type').notNull(),
    communicationType: communicationType('communication_type').notNull(),
    jobName: text('job_name'),
    jobSite: text('job_site'),
    jobDescription: text('job_description'),
    modelId: uuid('model_id')
      .notNull()
      .references(() => aiModel.id),
    /** Demais settings enviadas ao GPTMaker (`PUT /agents/{id}/settings`). */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    status: agentStatus('status').notNull().default('ACTIVE'),
    inactiveReason: agentInactiveReason('inactive_reason'),
    /** Hash SHA-256 do token dos webhooks do agente (`?t=`); o token em claro nunca é guardado. */
    webhookTokenHash: text('webhook_token_hash').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    uniqueIndex('agent_gptmaker_agent_id_uq').on(t.gptmakerAgentId),
    uniqueIndex('agent_webhook_token_hash_uq').on(t.webhookTokenHash),
    // Contagem do limite de agentes não removidos por tenant.
    index('agent_tenant_idx')
      .on(t.tenantId)
      .where(sql`${t.status} <> 'DELETED'`),
    index('agent_model_idx').on(t.modelId),
  ],
);

/** Chatbot Bitrix (`imbot.v2`) registrado para o agente no portal do tenant. */
export const agentBot = pgTable(
  'agent_bot',
  {
    agentId: uuid('agent_id')
      .primaryKey()
      .references(() => agent.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    botId: text('bot_id').notNull(),
    botCode: text('bot_code').notNull(),
    /** Hash do nome e da foto aplicados ao bot; diferente do agente ⇒ `imbot.v2.Bot.update`. */
    profileHash: text('profile_hash'),
    registeredAt: timestamptz('registered_at').notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('agent_bot_tenant_bot_uq').on(t.tenantId, t.botId),
    uniqueIndex('agent_bot_tenant_code_uq').on(t.tenantId, t.botCode),
  ],
);

export const trainingType = pgEnum('training_type', ['TEXT', 'WEBSITE', 'VIDEO', 'DOCUMENT']);
export const trainingStatus = pgEnum('training_status', ['PROCESSING', 'DONE', 'FAILED']);

export const training = pgTable(
  'training',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    gptmakerTrainingId: text('gptmaker_training_id'),
    type: trainingType('type').notNull(),
    /** Texto do treinamento `TEXT`. */
    content: text('content'),
    /** URL do site (`WEBSITE`) ou do vídeo (`VIDEO`). */
    url: text('url'),
    trainingSubPages: boolean('training_sub_pages'),
    trainingInterval: text('training_interval'),
    /** Chave do objeto no Spaces (SeaweedFS em dev) para `DOCUMENT`. */
    documentKey: text('document_key'),
    documentName: text('document_name'),
    documentMimetype: text('document_mimetype'),
    documentSizeBytes: integer('document_size_bytes'),
    status: trainingStatus('status').notNull().default('PROCESSING'),
    /** Hash do token do `callbackUrl` de status. */
    callbackTokenHash: text('callback_token_hash'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    uniqueIndex('training_gptmaker_training_id_uq').on(t.gptmakerTrainingId),
    index('training_agent_idx')
      .on(t.agentId)
      .where(sql`${t.deletedAt} is null`),
    index('training_tenant_idx').on(t.tenantId),
  ],
);

export const intentionHttpMethod = pgEnum('intention_http_method', ['GET', 'POST']);
export const intentionResponseMode = pgEnum('intention_response_mode', ['API', 'INSTRUCTIONS']);
/** `WEBHOOK`: API do cliente; `BITRIX`: ações no portal executadas pelo app (design D21). */
export const intentionKind = pgEnum('intention_kind', ['WEBHOOK', 'BITRIX']);

/** Campo que o agente coleta na conversa (`jsonName` é como é citado: `{{jsonName}}`). */
export interface IntentionField {
  name: string;
  jsonName: string;
  description: string;
  type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'DATE_TIME' | 'URL';
  required: boolean;
}

/**
 * Intenção do agente (spec agent-intentions, design D21): fonte da verdade da tela, espelhada no
 * GPTMaker. Valores de cabeçalho cifrados (`FieldCipher`): costumam ser chaves de API do cliente.
 */
export const agentIntention = pgTable(
  'agent_intention',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    /** `null` até a listagem do GPTMaker devolver o id (a criação não devolve). */
    gptmakerIntentionId: text('gptmaker_intention_id'),
    kind: intentionKind('kind').notNull().default('WEBHOOK'),
    name: text('name').notNull(),
    whenToUse: text('when_to_use').notNull(),
    fields: jsonb('fields').$type<IntentionField[]>().notNull().default([]),
    httpMethod: intentionHttpMethod('http_method').notNull(),
    url: text('url').notNull(),
    headers: jsonb('headers')
      .$type<Array<{ name: string; valueEncrypted: string | null }>>()
      .notNull()
      .default([]),
    params: jsonb('params').$type<Array<{ name: string; value: string }>>().notNull().default([]),
    body: text('body'),
    autoGenerateParams: boolean('auto_generate_params').notNull().default(false),
    autoGenerateBody: boolean('auto_generate_body').notNull().default(false),
    responseMode: intentionResponseMode('response_mode').notNull().default('API'),
    instructions: text('instructions'),
    active: boolean('active').notNull().default(true),
    /** Ações no portal (intenção `BITRIX`), como as dos gatilhos; textos aceitam `{{fields.x}}`. */
    actions: jsonb('actions')
      .$type<Array<{ type: string; config: Record<string, unknown> }>>()
      .notNull()
      .default([]),
    /** Token que o GPTMaker manda ao endpoint do app (intenção `BITRIX`), cifrado para ser reenviado. */
    tokenEncrypted: text('token_encrypted'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    uniqueIndex('agent_intention_gptmaker_id_uq').on(t.gptmakerIntentionId),
    // O nome identifica a intenção para o agente e para achar o id no GPTMaker.
    uniqueIndex('agent_intention_agent_name_uq')
      .on(t.agentId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('agent_intention_tenant_idx').on(t.tenantId),
  ],
);

/** Estado do diálogo da Linha Aberta: atendimento humano em curso e vínculo com o chat do GPTMaker. */
export const dialogState = pgTable(
  'dialog_state',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    dialogId: text('dialog_id').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    gptmakerChatId: text('gptmaker_chat_id'),
    humanActive: boolean('human_active').notNull().default(false),
    humanStartedAt: timestamptz('human_started_at'),
    lastMessageAt: timestamptz('last_message_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.dialogId] }),
    index('dialog_state_gptmaker_chat_idx').on(t.gptmakerChatId),
  ],
);

export const messageDirection = pgEnum('message_direction', ['IN', 'OUT']);
export const messageStatus = pgEnum('message_status', [
  'RECEIVED',
  'RESPONDED',
  'BLOCKED_NO_CREDIT',
  'SKIPPED_HUMAN',
  'SKIPPED_INACTIVE',
  'FAILED',
]);

export const messageLog = pgTable(
  'message_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    dialogId: text('dialog_id').notNull(),
    bitrixMessageId: text('bitrix_message_id').notNull(),
    direction: messageDirection('direction').notNull(),
    status: messageStatus('status').notNull(),
    modelCode: text('model_code'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('message_log_message_uq').on(t.tenantId, t.bitrixMessageId, t.direction),
    index('message_log_agent_idx').on(t.agentId, t.createdAt),
    index('message_log_dialog_idx').on(t.tenantId, t.dialogId, t.createdAt),
  ],
);

export const intentionExecutionStatus = pgEnum('intention_execution_status', [
  'SUCCESS',
  'FAILED',
  'REJECTED',
]);

/** Chamadas do GPTMaker a uma intenção  (histórico e erros por portal). */
export const intentionExecution = pgTable(
  'intention_execution',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    intentionId: uuid('intention_id')
      .notNull()
      .references(() => agentIntention.id),
    status: intentionExecutionStatus('status').notNull(),
    fields: jsonb('fields').$type<Record<string, string>>().notNull().default({}),
    dialogId: text('dialog_id'),
    /** Texto devolvido ao agente. */
    message: text('message').notNull(),
    results: jsonb('results')
      .$type<
        Array<{ type: string; ok: boolean; result?: Record<string, unknown>; error?: string }>
      >()
      .notNull()
      .default([]),
    durationMs: integer('duration_ms').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('intention_execution_intention_idx').on(t.intentionId, t.createdAt),
    index('intention_execution_tenant_idx').on(t.tenantId, t.createdAt),
  ],
);
