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
import { createdAt, timestamptz, updatedAt } from '../columns';

/** Catálogo de modelos de IA (spec ai-model-catalog). `code` = valor de `prefferModel` no GPTMaker. */
export const aiModel = pgTable(
  'ai_model',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    creditsPerResponse: integer('credits_per_response').notNull(),
    active: boolean('active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Código único entre modelos não removidos; um removido pode ser recadastrado.
    uniqueIndex('ai_model_code_uq')
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    // No máximo um modelo padrão.
    uniqueIndex('ai_model_default_uq')
      .on(t.isDefault)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
    check('ai_model_credits_positive', sql`${t.creditsPerResponse} > 0`),
  ],
);

export const aiModelCostHistory = pgTable(
  'ai_model_cost_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => aiModel.id),
    previousCost: integer('previous_cost').notNull(),
    newCost: integer('new_cost').notNull(),
    changedBy: text('changed_by').notNull(),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
  },
  (t) => [index('ai_model_cost_history_model_idx').on(t.modelId, t.changedAt)],
);

export const planType = pgEnum('plan_type', ['subscription', 'one_time']);

/**
 * Direitos do GPTMaker por plano do SPA 1138. Preço e intervalo vêm do crmthink-platform;
 * plano sem registro aqui não é exibido ao tenant (spec credit-billing).
 */
export const planEntitlement = pgTable(
  'plan_entitlement',
  {
    planSpaId: text('plan_spa_id').primaryKey(),
    planType: planType('plan_type').notNull(),
    /** Créditos concedidos a cada ciclo (planos `subscription`). */
    creditsPerCycle: integer('credits_per_cycle'),
    /** Créditos do pacote (planos `one_time`, produto "Créditos GPTMaker"). */
    creditsPerPackage: integer('credits_per_package'),
    maxTrainings: integer('max_trainings'),
    maxDocumentStorageMb: integer('max_document_storage_mb'),
    active: boolean('active').notNull().default(true),
    updatedBy: text('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'plan_entitlement_credits_by_type',
      sql`(${t.planType} = 'subscription' and ${t.creditsPerCycle} is not null and ${t.creditsPerCycle} >= 0)
        or (${t.planType} = 'one_time' and ${t.creditsPerPackage} is not null and ${t.creditsPerPackage} > 0)`,
    ),
  ],
);

export const planAllowedModel = pgTable(
  'plan_allowed_model',
  {
    planSpaId: text('plan_spa_id')
      .notNull()
      .references(() => planEntitlement.planSpaId, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => aiModel.id),
  },
  (t) => [primaryKey({ columns: [t.planSpaId, t.modelId] })],
);
