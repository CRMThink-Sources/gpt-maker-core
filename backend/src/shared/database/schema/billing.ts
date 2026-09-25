import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, timestamptz, updatedAt } from '../columns';
import { agent } from './agents';
import { tenant } from './tenancy';

export const wallet = pgEnum('wallet', ['TRIAL', 'PLAN', 'EXTRA']);

export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'GRANT',
  'TOPUP',
  'DEBIT',
  'ADJUSTMENT',
  'EXPIRE',
  'REFUND',
]);

/**
 * Ledger append-only de créditos (design D8). `amount` é assinado: entrada positiva, saída
 * negativa. UPDATE e DELETE são bloqueados por trigger; correções são lançamentos compensatórios.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    wallet: wallet('wallet').notNull(),
    type: ledgerEntryType('type').notNull(),
    amount: integer('amount').notNull(),
    /** Agente da resposta (DEBIT) ou do ajuste de reconciliação. */
    agentId: uuid('agent_id').references(() => agent.id),
    modelCode: text('model_code'),
    unitCost: integer('unit_cost'),
    subscriptionId: text('subscription_id'),
    periodStart: timestamptz('period_start'),
    /** Origem do lançamento: `message`, `subscription_period`, `purchase`, `charge`, `reconciliation`, `backoffice`... */
    refType: text('ref_type'),
    refId: text('ref_id'),
    /** Ex.: `msg:{id}:PLAN`, `grant:{subscriptionId}:{periodStart}`, `purchase:{purchaseId}`. */
    idempotencyKey: text('idempotency_key').notNull(),
    reason: text('reason'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('credit_ledger_idempotency_key_uq').on(t.idempotencyKey),
    index('credit_ledger_tenant_idx').on(t.tenantId, t.createdAt),
    index('credit_ledger_agent_idx').on(t.agentId, t.createdAt),
    check('credit_ledger_amount_nonzero', sql`${t.amount} <> 0`),
    check(
      'credit_ledger_amount_sign',
      sql`(${t.type} in ('GRANT', 'TOPUP') and ${t.amount} > 0)
        or (${t.type} in ('DEBIT', 'EXPIRE', 'REFUND') and ${t.amount} < 0)
        or ${t.type} = 'ADJUSTMENT'`,
    ),
    check(
      'credit_ledger_debit_model',
      sql`${t.type} <> 'DEBIT' or (${t.modelCode} is not null and ${t.unitCost} is not null)`,
    ),
  ],
);

/**
 * Saldo materializado por carteira, atualizado na mesma transação do lançamento
 * (`SELECT ... FOR UPDATE`). Só `PLAN` pode ficar negativa.
 */
export const tenantBalance = pgTable(
  'tenant_balance',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenant.id),
    trialBalance: integer('trial_balance').notNull().default(0),
    trialEndsAt: timestamptz('trial_ends_at'),
    planBalance: integer('plan_balance').notNull().default(0),
    extraBalance: integer('extra_balance').notNull().default(0),
    /** Fim do ciclo corrente: expiração de `PLAN` e `EXTRA`. */
    expiresAt: timestamptz('expires_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenant_balance_trial_nonnegative', sql`${t.trialBalance} >= 0`),
    check('tenant_balance_extra_nonnegative', sql`${t.extraBalance} >= 0`),
  ],
);

/** Créditos já gastos de uma cobrança estornada, abatidos dos próximos `GRANT` do plano. */
export const creditDeduction = pgTable(
  'credit_deduction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    amount: integer('amount').notNull(),
    remaining: integer('remaining').notNull(),
    refChargeId: text('ref_charge_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('credit_deduction_ref_charge_id_uq').on(t.refChargeId),
    index('credit_deduction_pending_idx')
      .on(t.tenantId)
      .where(sql`${t.remaining} > 0`),
    check('credit_deduction_amount_positive', sql`${t.amount} > 0`),
    check('credit_deduction_remaining_range', sql`${t.remaining} between 0 and ${t.amount}`),
  ],
);
