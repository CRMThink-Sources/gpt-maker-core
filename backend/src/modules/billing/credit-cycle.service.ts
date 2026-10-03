import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import {
  creditDeduction,
  creditLedger,
  planEntitlement,
  tenantBalance,
} from '../../shared/database/schema/index';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { LedgerService } from './ledger.service';

/** Créditos do trial (spec credit-billing: créditos do trial). */
export const TRIAL_CREDITS = 500;
/** Trials vencidos por rodada do job de expiração. */
const TRIAL_EXPIRY_BATCH = 200;

const SYSTEM = 'system:cycle';

/**
 * Créditos por ciclo de vida da assinatura (spec credit-billing, design D8/D9), sobre o ledger e
 * sempre idempotente pela origem: trial pela assinatura, ciclo por (assinatura, período), compra
 * pelo id dela, encerramento pela assinatura. Reentrega ou repetição não lança nada de novo.
 */
@Injectable()
export class CreditCycleService {
  private readonly logger = new Logger(CreditCycleService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly ledger: LedgerService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  /** `trial_started`: 500 créditos em `TRIAL`, que expiram no fim do trial (11.11). */
  async startTrial(input: {
    tenantId: string;
    subscriptionId: string;
    trialEndsAt: Date;
  }): Promise<void> {
    await this.ledger.credit({
      tenantId: input.tenantId,
      key: `trial:${input.subscriptionId}`,
      wallet: 'TRIAL',
      type: 'GRANT',
      amount: TRIAL_CREDITS,
      subscriptionId: input.subscriptionId,
      refType: 'subscription',
      refId: input.subscriptionId,
      createdBy: SYSTEM,
    });
    await this.ledger.setDates(input.tenantId, { trialEndsAt: input.trialEndsAt });
  }

  /**
   * `activated`/`renewed`: virada de ciclo (11.2), sem tocar em `TRIAL`. `EXPIRE` do saldo
   * positivo de `PLAN` e `EXTRA`, `GRANT` dos créditos do plano (saldo negativo de `PLAN` é
   * abatido pela soma) e abatimento das deduções de estorno pendentes até o valor do `GRANT`.
   */
  async startCycle(input: {
    tenantId: string;
    subscriptionId: string;
    planId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<{ granted: number; deducted: number }> {
    const period = `${input.subscriptionId}:${input.periodStart.toISOString()}`;
    const common = {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      periodStart: input.periodStart,
      refType: 'subscription_period',
      refId: period,
      createdBy: SYSTEM,
    };
    // Ciclo já aberto (o mesmo período chegou de novo com outro `eventId`, ou pela correção do
    // job de consistência): não repete. A chave do `EXPIRE` sozinha não basta, porque expirar
    // saldo zero não grava lançamento e a repetição expiraria os créditos recém-concedidos.
    const [opened] = await this.db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, input.tenantId),
          eq(creditLedger.refType, 'subscription_period'),
          eq(creditLedger.refId, period),
        ),
      )
      .limit(1);
    if (opened) {
      await this.ledger.setDates(input.tenantId, { expiresAt: input.periodEnd });
      return { granted: 0, deducted: 0 };
    }

    await this.ledger.expire({
      ...common,
      key: `cycle:${period}:expire`,
      wallets: ['PLAN', 'EXTRA'],
    });

    const [entitlement] = await this.db
      .select({ credits: planEntitlement.creditsPerCycle })
      .from(planEntitlement)
      .where(eq(planEntitlement.planSpaId, input.planId));
    const credits = entitlement?.credits ?? 0;
    if (!entitlement) {
      this.logger.error(
        { alert: true, planId: input.planId, tenantId: input.tenantId },
        'plano sem direitos cadastrados; ciclo sem créditos (cadastre em plan_entitlement)',
      );
    }
    if (credits > 0) {
      await this.ledger.credit({
        ...common,
        key: `cycle:${period}:grant`,
        wallet: 'PLAN',
        type: 'GRANT',
        amount: credits,
      });
    }
    const deducted = credits > 0 ? await this.applyDeductions(input.tenantId, period, credits) : 0;
    await this.ledger.setDates(input.tenantId, { expiresAt: input.periodEnd });
    return { granted: credits, deducted };
  }

  /** `ended`: expira o saldo positivo das três carteiras (trial, plano e adicional). */
  async endSubscription(input: { tenantId: string; subscriptionId: string }): Promise<void> {
    await this.ledger.expire({
      tenantId: input.tenantId,
      key: `ended:${input.subscriptionId}`,
      wallets: ['TRIAL', 'PLAN', 'EXTRA'],
      subscriptionId: input.subscriptionId,
      refType: 'subscription',
      refId: input.subscriptionId,
      createdBy: SYSTEM,
    });
    await this.ledger.setDates(input.tenantId, { expiresAt: null, trialEndsAt: null });
  }

  /** `purchase.paid`: `TOPUP` em `EXTRA` com os créditos do pacote × quantidade. */
  async creditPurchase(input: {
    tenantId: string;
    purchaseId: string;
    planId: string;
    quantity: number;
  }): Promise<number> {
    const [entitlement] = await this.db
      .select({ credits: planEntitlement.creditsPerPackage })
      .from(planEntitlement)
      .where(eq(planEntitlement.planSpaId, input.planId));
    const credits = (entitlement?.credits ?? 0) * Math.max(input.quantity, 1);
    if (credits <= 0) {
      // Pago e sem créditos: precisa de ação manual (cadastrar o pacote e conceder).
      throw new Error(`pacote ${input.planId} sem créditos cadastrados em plan_entitlement`);
    }
    await this.ledger.credit({
      tenantId: input.tenantId,
      key: `purchase:${input.purchaseId}`,
      wallet: 'EXTRA',
      type: 'TOPUP',
      amount: credits,
      refType: 'purchase',
      refId: input.purchaseId,
      createdBy: SYSTEM,
    });
    return credits;
  }

  /** Trials vencidos com saldo: `EXPIRE` de `TRIAL`, com plano ativo ou não (11.11). */
  async expireTrials(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ tenantId: tenantBalance.tenantId, trialEndsAt: tenantBalance.trialEndsAt })
      .from(tenantBalance)
      .where(and(lte(tenantBalance.trialEndsAt, now), gt(tenantBalance.trialBalance, 0)))
      .limit(TRIAL_EXPIRY_BATCH);
    for (const row of due) {
      await this.ledger.expire({
        tenantId: row.tenantId,
        key: `trial-expire:${row.tenantId}:${row.trialEndsAt!.toISOString()}`,
        wallets: ['TRIAL'],
        refType: 'trial',
        createdBy: SYSTEM,
      });
    }
    return due.length;
  }

  @Cron('*/15 * * * *', { name: 'trial-expiry' })
  async runTrialExpiry(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive('job:trial-expiry', 14 * 60_000, () =>
          this.expireTrials(),
        );
        if (outcome.ran && outcome.result) {
          this.logger.log({ count: outcome.result }, 'créditos de trial vencidos expirados');
        }
      } catch (error) {
        this.logger.error({ err: error }, 'expiração dos trials falhou');
      }
    });
  }

  /**
   * Deduções de estorno pendentes, mais antigas primeiro, até o valor do `GRANT` do ciclo
   * (spec: aplicação da dedução no novo ciclo). O restante de cada dedução é recalculado pelo
   * ledger (valor menos os ajustes já lançados para ela), então repetir é seguro.
   */
  private async applyDeductions(tenantId: string, period: string, budget: number): Promise<number> {
    const pending = await this.db
      .select()
      .from(creditDeduction)
      .where(and(eq(creditDeduction.tenantId, tenantId), gt(creditDeduction.remaining, 0)))
      .orderBy(asc(creditDeduction.createdAt));
    let used = 0;
    for (const deduction of pending) {
      const left = budget - used;
      if (left <= 0) break;
      const amount = Math.min(deduction.remaining, left);
      await this.ledger.adjust({
        tenantId,
        key: `cycle:${period}:deduction:${deduction.id}`,
        amount: -amount,
        refType: 'credit_deduction',
        refId: deduction.id,
        reason: `estorno da cobrança ${deduction.refChargeId}`,
        createdBy: SYSTEM,
      });
      used += amount;
      await this.db
        .update(creditDeduction)
        .set({
          remaining: sql`greatest(${creditDeduction.amount} + coalesce((
            select sum(${creditLedger.amount}) from ${creditLedger}
            where ${creditLedger.refType} = 'credit_deduction' and ${creditLedger.refId} = ${deduction.id}
          ), 0), 0)`,
        })
        .where(eq(creditDeduction.id, deduction.id));
    }
    return used;
  }
}
