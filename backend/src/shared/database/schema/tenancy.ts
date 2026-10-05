import { pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, timestamptz, updatedAt } from '../columns';

export const tenantStatus = pgEnum('tenant_status', [
  'ACTIVE',
  'SUSPENDED',
  'AUTH_ERROR',
  'UNINSTALLED',
]);

/** Portal Bitrix24 que instalou o app. Tokens ficam só no crmthink-platform (spec bitrix-app-installation). */
export const tenant = pgTable(
  'tenant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `installationId` do crmthink-platform (id do item no SPA 1060). */
    installationId: text('installation_id').notNull(),
    memberId: text('member_id').notNull(),
    domain: text('domain').notNull(),
    /** Código curto e estável do tenant (suporte e backoffice; antes prefixava o nome dos agentes no GPTMaker). */
    tenantCode: text('tenant_code').notNull(),
    status: tenantStatus('status').notNull().default('ACTIVE'),
    suspendedReason: text('suspended_reason'),
    installedAt: timestamptz('installed_at').notNull().defaultNow(),
    uninstalledAt: timestamptz('uninstalled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tenant_installation_id_uq').on(t.installationId),
    uniqueIndex('tenant_member_id_uq').on(t.memberId),
    uniqueIndex('tenant_tenant_code_uq').on(t.tenantCode),
  ],
);

/** Usuários do portal autorizados pelo administrador a gerenciar agentes, gatilhos e treinamentos. */
export const appUserPermission = pgTable(
  'app_user_permission',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    bitrixUserId: text('bitrix_user_id').notNull(),
    grantedBy: text('granted_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('app_user_permission_tenant_user_uq').on(t.tenantId, t.bitrixUserId)],
);
