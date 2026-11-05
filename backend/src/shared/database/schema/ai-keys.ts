import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, encryptedText, timestamptz, updatedAt } from '../columns';
import { tenant } from './tenancy';

/**
 * Chave de IA do cliente para a revisão do preenchimento da função (spec agent-knowledge-review,
 * design D6): a `vibe_api_` do Vibecode do portal dele. Uma por tenant; cifrada em repouso e nunca
 * devolvida à tela, só os 4 últimos caracteres.
 */
export const tenantAiKey = pgTable('tenant_ai_key', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenant.id),
  apiKey: encryptedText('api_key').notNull(),
  last4: text('last4').notNull(),
  /** Modelo que a chave enxergou no teste de quando foi salva. */
  model: text('model').notNull(),
  /** Último teste bem-sucedido da chave (ao salvar). */
  verifiedAt: timestamptz('verified_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
