import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, encryptedText, timestamptz, updatedAt } from '../columns';
import { tenant } from './tenancy';

export const backofficeRole = pgEnum('backoffice_role', ['ADMIN', 'SUPPORT']);

/** Operadores do backoffice (autenticação própria, fora do Bitrix). */
export const backofficeUser = pgTable(
  'backoffice_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** Nulo quando o operador entra só por SSO. */
    passwordHash: text('password_hash'),
    totpSecret: encryptedText('totp_secret'),
    role: backofficeRole('role').notNull(),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamptz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('backoffice_user_email_uq').on(sql`lower(${t.email})`)],
);

export const auditActorType = pgEnum('audit_actor_type', ['OPERATOR', 'TENANT_USER', 'SYSTEM']);

/** Trilha de auditoria (autor, ação, antes/depois) das ações do backoffice e sensíveis do app. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: auditActorType('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    tenantId: uuid('tenant_id').references(() => tenant.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    traceId: text('trace_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_tenant_idx').on(t.tenantId, t.createdAt),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);
