import {
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
import { createdAt, timestamptz } from '../columns';
import { tenant } from './tenancy';

export const notificationType = pgEnum('notification_type', [
  'CREDIT_80',
  'CREDIT_ZERO',
  'PAYMENT_FAILED',
  'PERIOD_ENDING',
  'MODEL_DOWNGRADED',
  'TEST',
]);

export const notificationStatus = pgEnum('notification_status', ['PENDING', 'SENT', 'FAILED']);

/** Usuários do portal escolhidos pelo administrador para receber os avisos do app (11.9). */
export const notificationRecipient = pgTable(
  'notification_recipient',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    bitrixUserId: text('bitrix_user_id').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.bitrixUserId] })],
);

/**
 * Administradores do portal vistos nas sessões do app (claim `isAdmin` do JWT). O Bitrix24 não
 * lista administradores pela API; com o usuário que instalou o app (dono do token), são o destino
 * dos avisos quando não há destinatários configurados.
 */
export const portalAdmin = pgTable(
  'portal_admin',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    bitrixUserId: text('bitrix_user_id').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.bitrixUserId] })],
);

/**
 * Avisos do app: um por (tenant, tipo, chave de deduplicação), que garante o "uma vez por ciclo"
 * e por evento. O próprio registro é a fila de envio: `PENDING` até ir a todos os destinatários,
 * com retentativa; `sent_to` evita reenviar a quem já recebeu.
 */
export const notificationLog = pgTable(
  'notification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    type: notificationType('type').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    message: text('message').notNull(),
    status: notificationStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    /** Ids do Bitrix que já receberam (`im.notify.system.add` não é idempotente). */
    sentTo: jsonb('sent_to').$type<string[]>().notNull().default([]),
    lastError: text('last_error'),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    createdAt: createdAt(),
    sentAt: timestamptz('sent_at'),
  },
  (t) => [
    uniqueIndex('notification_log_dedupe_uq').on(t.tenantId, t.type, t.dedupeKey),
    index('notification_log_pending_idx').on(t.status, t.nextAttemptAt),
    index('notification_log_tenant_idx').on(t.tenantId, t.createdAt),
  ],
);
