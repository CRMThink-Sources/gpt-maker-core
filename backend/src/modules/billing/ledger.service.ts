import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { creditLedger, tenantBalance } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { REDIS } from '../../shared/redis/redis.module';
import { balanceCacheKey } from './balance.reader';

export type Wallet = 'TRIAL' | 'PLAN' | 'EXTRA';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type LedgerType = (typeof creditLedger.$inferInsert)['type'];

/** Ordem de consumo (design D8): o que expira antes sai primeiro. */
export const DEBIT_ORDER: readonly Wallet[] = ['TRIAL', 'PLAN', 'EXTRA'];

const COLUMN = {
  TRIAL: 'trialBalance',
  PLAN: 'planBalance',
  EXTRA: 'extraBalance',
} as const satisfies Record<Wallet, keyof typeof tenantBalance.$inferSelect>;

export interface BalanceView {
  trial: number;
  plan: number;
  extra: number;
  total: number;
  trialEndsAt: Date | null;
  /** Fim do ciclo corrente: expiração de `PLAN` e `EXTRA`. */
  expiresAt: Date | null;
}

/** Dados comuns de uma operação; `key` identifica a operação inteira (idempotência). */
export interface OperationInput {
  tenantId: string;
  /** Ex.: `msg:<id>`, `grant:<assinatura>:<período>`, `purchase:<id>`. */
  key: string;
  createdBy: string;
  refType?: string;
  refId?: string;
  reason?: string;
  agentId?: string;
  modelCode?: string;
  unitCost?: number;
  subscriptionId?: string;
  periodStart?: Date;
}

export interface OperationResult {
  /** `false`: a operação já tinha sido lançada (reentrega); nada mudou. */
  applied: boolean;
  entries: Array<{ wallet: Wallet; type: LedgerType; amount: number }>;
  balance: BalanceView;
}

interface Entry {
  wallet: Wallet;
  type: LedgerType;
  amount: number;
}

function view(row: typeof tenantBalance.$inferSelect): BalanceView {
  return {
    trial: row.trialBalance,
    plan: row.planBalance,
    extra: row.extraBalance,
    total: row.trialBalance + row.planBalance + row.extraBalance,
    trialEndsAt: row.trialEndsAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Divide uma saída (débito ou ajuste negativo) entre as carteiras na ordem `TRIAL`, `PLAN`,
 * `EXTRA`, consumindo só saldo positivo; o que sobrar fica negativo em `PLAN` (`TRIAL` e `EXTRA`
 * nunca ficam negativas). Devolve valores positivos por carteira.
 */
export function splitOutflow(balance: BalanceView, amount: number): Array<[Wallet, number]> {
  const available: Record<Wallet, number> = {
    TRIAL: Math.max(balance.trial, 0),
    PLAN: Math.max(balance.plan, 0),
    EXTRA: Math.max(balance.extra, 0),
  };
  const parts = new Map<Wallet, number>();
  let left = amount;
  for (const wallet of DEBIT_ORDER) {
    const take = Math.min(left, available[wallet]);
    if (take > 0) parts.set(wallet, take);
    left -= take;
  }
  if (left > 0) parts.set('PLAN', (parts.get('PLAN') ?? 0) + left);
  return DEBIT_ORDER.filter((wallet) => parts.has(wallet)).map((wallet) => [
    wallet,
    parts.get(wallet)!,
  ]);
}

/**
 * Ledger de créditos (spec credit-billing, design D8): toda movimentação é um lançamento
 * append-only em `credit_ledger`, e `tenant_balance` é atualizado na mesma transação com a linha
 * travada (`FOR UPDATE`), o que põe em fila as operações do mesmo tenant. Idempotência pela
 * operação (`key`): se já existe lançamento dela, nada é lançado de novo, mesmo que o saldo tenha
 * mudado e a divisão entre carteiras saísse diferente. Depois do commit, o espelho do saldo no
 * Redis é apagado; o `BalanceReader` relê do banco.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async balance(tenantId: string): Promise<BalanceView> {
    const [row] = await this.db
      .select()
      .from(tenantBalance)
      .where(eq(tenantBalance.tenantId, tenantId));
    return row
      ? view(row)
      : { trial: 0, plan: 0, extra: 0, total: 0, trialEndsAt: null, expiresAt: null };
  }

  /** Entrada numa carteira: `GRANT` (trial, ciclo) ou `TOPUP` (pacote, concessão; sempre `EXTRA`). */
  async credit(
    input: OperationInput & { wallet: Wallet; type: 'GRANT' | 'TOPUP'; amount: number },
  ): Promise<OperationResult> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw invalidAmount();
    if (input.type === 'TOPUP' && input.wallet !== 'EXTRA') {
      throw new DomainError(
        'LEDGER_INVALID_WALLET',
        'TOPUP vai sempre para EXTRA',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.operate(input, () => [
      { wallet: input.wallet, type: input.type, amount: input.amount },
    ]);
  }

  /** Débito de uma resposta: custo em cascata `TRIAL` → `PLAN` → `EXTRA` (11.3). */
  async debit(input: OperationInput & { amount: number }): Promise<OperationResult> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw invalidAmount();
    return this.operate(input, (balance) =>
      splitOutflow(balance, input.amount).map(([wallet, amount]) => ({
        wallet,
        type: 'DEBIT' as const,
        amount: -amount,
      })),
    );
  }

  /**
   * Ajuste (reconciliação, dedução de estorno, correção): negativo segue a cascata do débito;
   * positivo vai para `PLAN` do ciclo corrente (spec: ajustes positivos em `PLAN`).
   */
  async adjust(input: OperationInput & { amount: number }): Promise<OperationResult> {
    if (!Number.isInteger(input.amount) || input.amount === 0) throw invalidAmount();
    return this.operate(input, (balance) =>
      input.amount > 0
        ? [{ wallet: 'PLAN', type: 'ADJUSTMENT', amount: input.amount }]
        : splitOutflow(balance, -input.amount).map(([wallet, amount]) => ({
            wallet,
            type: 'ADJUSTMENT' as const,
            amount: -amount,
          })),
    );
  }

  /** `EXPIRE` do saldo positivo das carteiras (fim do trial, virada de ciclo, assinatura encerrada). */
  async expire(input: OperationInput & { wallets: Wallet[] }): Promise<OperationResult> {
    return this.operate(input, (balance) =>
      input.wallets.flatMap((wallet) => {
        const current = { TRIAL: balance.trial, PLAN: balance.plan, EXTRA: balance.extra }[wallet];
        return current > 0 ? [{ wallet, type: 'EXPIRE' as const, amount: -current }] : [];
      }),
    );
  }

  /** `REFUND`: saída de uma carteira específica (estorno), limitada ao saldo positivo dela. */
  async refund(
    input: OperationInput & { wallet: Wallet; amount: number },
  ): Promise<OperationResult> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw invalidAmount();
    return this.operate(input, (balance) => {
      const current = { TRIAL: balance.trial, PLAN: balance.plan, EXTRA: balance.extra }[
        input.wallet
      ];
      const amount = Math.min(input.amount, Math.max(current, 0));
      return amount > 0 ? [{ wallet: input.wallet, type: 'REFUND' as const, amount: -amount }] : [];
    });
  }

  /** Datas da carteira: fim do trial e fim do ciclo (expiração de `PLAN` e `EXTRA`). */
  async setDates(
    tenantId: string,
    dates: { trialEndsAt?: Date | null; expiresAt?: Date | null },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockBalance(tx, tenantId);
      await tx.update(tenantBalance).set(dates).where(eq(tenantBalance.tenantId, tenantId));
    });
  }

  private async operate(
    input: OperationInput,
    plan: (balance: BalanceView) => Entry[],
  ): Promise<OperationResult> {
    const result = await this.db.transaction(async (tx) => {
      const locked = await this.lockBalance(tx, input.tenantId);
      // A linha travada põe em fila as operações do tenant: checar e lançar não disputa.
      const [existing] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        // Cada lançamento é `<operação>:<carteira>`: as três chaves possíveis, pelo índice único.
        .where(
          and(
            // Só do próprio tenant: chave igual de outro tenant falha alto no índice único.
            eq(creditLedger.tenantId, input.tenantId),
            inArray(
              creditLedger.idempotencyKey,
              DEBIT_ORDER.map((wallet) => `${input.key}:${wallet}`),
            ),
          ),
        )
        .limit(1);
      if (existing) return { applied: false, entries: [], balance: view(locked) };

      const entries = plan(view(locked)).filter((entry) => entry.amount !== 0);
      if (!entries.length) return { applied: true, entries: [], balance: view(locked) };

      await tx.insert(creditLedger).values(
        entries.map((entry) => ({
          tenantId: input.tenantId,
          wallet: entry.wallet,
          type: entry.type,
          amount: entry.amount,
          idempotencyKey: `${input.key}:${entry.wallet}`,
          createdBy: input.createdBy,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          reason: input.reason ?? null,
          agentId: input.agentId ?? null,
          modelCode: input.modelCode ?? null,
          unitCost: input.unitCost ?? null,
          subscriptionId: input.subscriptionId ?? null,
          periodStart: input.periodStart ?? null,
        })),
      );
      const delta = { trialBalance: 0, planBalance: 0, extraBalance: 0 };
      for (const entry of entries) delta[COLUMN[entry.wallet]] += entry.amount;
      const [updated] = await tx
        .update(tenantBalance)
        .set({
          trialBalance: sql`${tenantBalance.trialBalance} + ${delta.trialBalance}`,
          planBalance: sql`${tenantBalance.planBalance} + ${delta.planBalance}`,
          extraBalance: sql`${tenantBalance.extraBalance} + ${delta.extraBalance}`,
        })
        .where(eq(tenantBalance.tenantId, input.tenantId))
        .returning();
      return { applied: true, entries, balance: view(updated!) };
    });

    if (result.applied && result.entries.length) {
      try {
        await this.redis.del(balanceCacheKey(input.tenantId));
      } catch (error) {
        // O espelho tem validade curta: no pior caso, o saldo antigo vale até ela vencer.
        this.logger.warn({ err: error }, 'espelho do saldo não apagado no Redis');
      }
    }
    return result;
  }

  /** Cria a linha de saldo se faltar e a trava até o fim da transação. */
  private async lockBalance(tx: Tx, tenantId: string): Promise<typeof tenantBalance.$inferSelect> {
    await tx.insert(tenantBalance).values({ tenantId }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(tenantBalance)
      .where(eq(tenantBalance.tenantId, tenantId))
      .for('update');
    return row!;
  }
}

const invalidAmount = () =>
  new DomainError(
    'LEDGER_INVALID_AMOUNT',
    'Quantidade de créditos inválida',
    HttpStatus.BAD_REQUEST,
  );
