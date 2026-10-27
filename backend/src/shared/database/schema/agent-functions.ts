import type {
  FunctionAnswers,
  FunctionBlockContent,
  FunctionMode,
  FunctionTemplateContent,
  FunctionTemplateDraft,
  PublishedFunctionState,
} from '@gptmaker/contracts';
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
import { agent, agentIntention, training } from './agents';
import { backofficeUser } from './backoffice';
import { tenant } from './tenancy';

/** Bloco compartilhado entre templates (design D3): o rascunho vira conteúdo ao publicar. */
export const agentFunctionBlock = pgTable(
  'agent_function_block',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    draft: jsonb('draft').$type<FunctionBlockContent>().notNull(),
    /** Conteúdo publicado: é o que entra nos templates na próxima versão deles. */
    content: jsonb('content').$type<FunctionBlockContent>(),
    publishedAt: timestamptz('published_at'),
    /** Exclusão lógica: o código fica reservado (o seed não recria). */
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('agent_function_block_code_uq').on(t.code)],
);

/** Template de uma função do agente (spec agent-function-templates), com o rascunho editável. */
export const agentFunctionTemplate = pgTable(
  'agent_function_template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    draft: jsonb('draft').$type<FunctionTemplateDraft>().notNull(),
    /** Número da última versão publicada; nulo enquanto não houver nenhuma. */
    latestVersion: integer('latest_version'),
    /** Inativa: fora da criação de agentes; os agentes que já a usam seguem normais (design D13). */
    active: boolean('active').notNull().default(true),
    /** Exclusão lógica: o código fica reservado (o seed não recria). */
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('agent_function_template_code_uq').on(t.code)],
);

/**
 * Portais em que a função aparece na criação de agentes (design D14). Sem linhas, vale para todos;
 * com linhas, só para estes. Fica fora das versões: muda na hora, sem publicar.
 */
export const agentFunctionTemplateTenant = pgTable(
  'agent_function_template_tenant',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => agentFunctionTemplate.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.templateId, t.tenantId] }),
    index('agent_function_template_tenant_tenant_idx').on(t.tenantId),
  ],
);

/** Versão publicada, imutável, com os blocos já expandidos. */
export const agentFunctionTemplateVersion = pgTable(
  'agent_function_template_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => agentFunctionTemplate.id),
    version: integer('version').notNull(),
    content: jsonb('content').$type<FunctionTemplateContent>().notNull(),
    /** Nulo na versão do seed. */
    publishedBy: uuid('published_by').references(() => backofficeUser.id),
    publishedAt: timestamptz('published_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agent_function_template_version_uq').on(t.templateId, t.version)],
);

export const agentFunctionMode = pgEnum('agent_function_mode', [
  'SIMPLE',
  'ADVANCED',
  'TAKEN_OVER',
]);
export const functionPublicationStatus = pgEnum('function_publication_status', [
  'IDLE',
  'PENDING',
  'FAILED',
]);

/** O que uma publicação aplica: compilado de novo pelo executor (a compilação é determinística). */
export interface FunctionPublicationTarget {
  versionId: string;
  answers: FunctionAnswers;
  mode: FunctionMode;
  additionalInstructions: string | null;
  takenOverBehavior: string | null;
}

/** Configuração da função de um agente (spec agent-function-configuration, design D4). */
export const agentFunctionConfig = pgTable(
  'agent_function_config',
  {
    agentId: uuid('agent_id')
      .primaryKey()
      .references(() => agent.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => agentFunctionTemplate.id),
    /** Versão publicada no agente; nula até a primeira publicação concluir. */
    versionId: uuid('version_id').references(() => agentFunctionTemplateVersion.id),
    answers: jsonb('answers').$type<FunctionAnswers>().notNull().default({}),
    /** Respostas salvas sem publicar. */
    draftAnswers: jsonb('draft_answers').$type<FunctionAnswers>(),
    mode: agentFunctionMode('mode').notNull().default('SIMPLE'),
    additionalInstructions: text('additional_instructions'),
    /** Comportamento editado pelo parceiro (`TAKEN_OVER`). */
    takenOverBehavior: text('taken_over_behavior'),
    /** Estado publicado no GPTMaker: base do plano da próxima publicação. */
    publishedState: jsonb('published_state').$type<PublishedFunctionState>(),
    publicationStatus: functionPublicationStatus('publication_status').notNull().default('IDLE'),
    publicationTarget: jsonb('publication_target').$type<FunctionPublicationTarget>(),
    publicationError: text('publication_error'),
    /** Um treinamento gerado sumiu do GPTMaker: a próxima publicação recria. */
    needsRepublishReason: text('needs_republish_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('agent_function_config_tenant_idx').on(t.tenantId),
    index('agent_function_config_version_idx').on(t.versionId),
  ],
);

export const managedResourceKind = pgEnum('managed_resource_kind', ['TRAINING', 'INTENTION']);

/** Treinamento ou intenção gerado pela função, pela chave estável do item ou da intenção. */
export const agentManagedResource = pgTable(
  'agent_managed_resource',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agent.id),
    kind: managedResourceKind('kind').notNull(),
    key: text('key').notNull(),
    /** Hash do conteúdo aplicado no GPTMaker. */
    hash: text('hash').notNull(),
    trainingId: uuid('training_id').references(() => training.id),
    intentionId: uuid('intention_id').references(() => agentIntention.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('agent_managed_resource_key_uq').on(t.agentId, t.kind, t.key)],
);
