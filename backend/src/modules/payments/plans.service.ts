import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Plan } from '@crmthink-sources/platform-sdk';
import type {
  BillingPortalView,
  ChangePlanView,
  CheckoutSessionView,
  PlanOfferView,
  PlansView,
  PurchaseStatusView,
} from '@gptmaker/contracts';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import {
  creditLedger,
  planEntitlement,
  subscriptionState,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import {
  isPlatformUnavailable,
  PlatformApiClient,
  PlatformError,
} from '../../shared/platform/platform-api.client';
import { REDIS } from '../../shared/redis/redis.module';
import { TenantService } from '../tenancy';

/** Preço e intervalo vêm da plataforma; cache curto (design D9). */
const PLANS_CACHE_KEY = 'payments:plans';
const PLANS_CACHE_SECONDS = 5 * 60;

/**
 * Planos à venda e contratação pelo Stripe Embedded Checkout (spec payments-integration). Só
 * entram planos com direitos ativos em `plan_entitlement` (spec 13.2: plano sem direitos fica
 * oculto); o plano de trial nunca é vendido. Ativação e créditos chegam só pelos eventos
 * (`subscription.activated`, `purchase.paid`), nunca pelo retorno do checkout.
 */
@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly platform: PlatformApiClient,
    private readonly tenants: TenantService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async offers(): Promise<PlansView> {
    const [plans, entitlements] = await Promise.all([
      this.platformPlans(),
      this.db.select().from(planEntitlement).where(eq(planEntitlement.active, true)),
    ]);
    const byPlan = new Map(entitlements.map((row) => [row.planSpaId, row]));
    const view: PlansView = { subscriptions: [], packages: [] };
    for (const plan of plans) {
      const rights = byPlan.get(String(plan.id));
      if (plan.trial || !rights || rights.planType !== plan.type) continue;
      const credits =
        plan.type === 'subscription' ? rights.creditsPerCycle : rights.creditsPerPackage;
      if (!credits || credits <= 0) continue;
      const offer: PlanOfferView = {
        id: plan.id,
        name: plan.name,
        amount: plan.amount,
        interval: plan.type === 'subscription' ? plan.interval : null,
        credits,
      };
      (plan.type === 'subscription' ? view.subscriptions : view.packages).push(offer);
    }
    view.subscriptions.sort((a, b) => a.amount - b.amount);
    view.packages.sort((a, b) => a.amount - b.amount);
    return view;
  }

  async checkout(
    tenantId: string,
    installationId: number,
    planId: number,
  ): Promise<CheckoutSessionView> {
    const offers = await this.offers();
    const isPackage = offers.packages.some((offer) => offer.id === planId);
    if (!isPackage && !offers.subscriptions.some((offer) => offer.id === planId)) {
      throw new DomainError('PLAN_NOT_AVAILABLE', 'Plano indisponível.', HttpStatus.NOT_FOUND);
    }

    const [projection] = await this.db
      .select({ status: subscriptionState.status })
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, tenantId));
    const status = projection?.status;
    if (isPackage && status !== 'active') {
      // Spec credit-billing "Pacote durante o trial": a plataforma aceitaria em trial.
      throw new DomainError(
        'PACKAGE_REQUIRES_PLAN',
        'Pacotes de créditos exigem um plano ativo.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!isPackage && (status === 'active' || status === 'past_due')) {
      throw subscriptionExists();
    }

    const intent = isPackage ? 'purchase' : 'subscribe';
    try {
      const session = await this.platform.createCheckoutSession({ installationId, planId, intent });
      return { clientSecret: session.clientSecret, intent, purchaseId: session.purchaseId ?? null };
    } catch (error) {
      throw this.toDomainError(error, { installationId, planId });
    }
  }

  /**
   * Troca de plano (spec payments-integration, "Troca de plano e portal do cliente"; 12.6): só
   * assinatura paga com cartão; a manual muda no SPA pelo comercial. Upgrade vale na hora
   * (cobrança proporcional pela plataforma); downgrade na renovação. Créditos e modelos seguem o
   * evento `subscription.plan_changed`.
   */
  async changePlan(tenantId: string, planId: number): Promise<ChangePlanView> {
    const [projection] = await this.db
      .select()
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, tenantId));
    if (!projection || (projection.status !== 'active' && projection.status !== 'past_due')) {
      throw new DomainError(
        'NO_GATEWAY_SUBSCRIPTION',
        'Só é possível trocar de plano com uma assinatura paga ativa. Contrate um plano primeiro.',
        HttpStatus.CONFLICT,
      );
    }
    if (projection.modality === 'manual') throw manualSubscription();
    if (String(planId) === projection.planId && !projection.nextPlanId) {
      throw new DomainError('SAME_PLAN', 'Este já é o seu plano.', HttpStatus.CONFLICT);
    }
    const offers = await this.offers();
    if (!offers.subscriptions.some((offer) => offer.id === planId)) {
      throw new DomainError('PLAN_NOT_AVAILABLE', 'Plano indisponível.', HttpStatus.NOT_FOUND);
    }
    try {
      const result = await this.platform.changePlan(Number(projection.subscriptionId), planId);
      this.logger.log(
        { tenantId, from: projection.planId, to: planId, effective: result.effective },
        'troca de plano solicitada',
      );
      return result.effective === 'next_period'
        ? { effective: 'next_period', effectiveAt: result.effectiveAt }
        : { effective: 'immediate', effectiveAt: null };
    } catch (error) {
      throw this.toDomainError(error, { tenantId, planId });
    }
  }

  async purchaseStatus(tenantId: string, purchaseId: number): Promise<PurchaseStatusView> {
    const [row] = await this.db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenantId),
          eq(creditLedger.refType, 'purchase'),
          eq(creditLedger.refId, String(purchaseId)),
        ),
      )
      .limit(1);
    return { credited: row !== undefined };
  }

  /** O portal abre em nova janela; ao sair, volta para o portal Bitrix24 do cliente. */
  async billingPortal(tenantId: string, installationId: number): Promise<BillingPortalView> {
    const tenant = await this.tenants.findById(tenantId);
    const returnUrl = `https://${tenant!.domain}/`;
    try {
      return await this.platform.createBillingPortalSession({ installationId, returnUrl });
    } catch (error) {
      throw this.toDomainError(error, { installationId });
    }
  }

  private async platformPlans(): Promise<Plan[]> {
    const cached = await this.redis.get(PLANS_CACHE_KEY);
    if (cached) return JSON.parse(cached) as Plan[];
    try {
      const plans = await this.platform.listPlans();
      await this.redis.set(PLANS_CACHE_KEY, JSON.stringify(plans), 'EX', PLANS_CACHE_SECONDS);
      return plans;
    } catch (error) {
      throw this.toDomainError(error, {});
    }
  }

  private toDomainError(error: unknown, context: Record<string, unknown>): unknown {
    if (isPlatformUnavailable(error)) return paymentsUnavailable();
    if (!(error instanceof PlatformError)) return error;
    switch (error.code) {
      case 'SUBSCRIPTION_ALREADY_EXISTS':
        // A projeção local não conhece a assinatura paga: evento perdido ou atrasado (12.10).
        this.logger.warn(context, 'checkout recusado: assinatura que a projeção não tem');
        return subscriptionExists();
      case 'NO_ACTIVE_SUBSCRIPTION':
        return new DomainError(
          'PACKAGE_REQUIRES_PLAN',
          'Pacotes de créditos exigem um plano ativo.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      case 'SAME_PLAN':
        return new DomainError('SAME_PLAN', 'Este já é o seu plano.', HttpStatus.CONFLICT);
      case 'MANUAL_SUBSCRIPTION':
        return manualSubscription();
      case 'NO_GATEWAY_SUBSCRIPTION':
        return new DomainError(
          'NO_GATEWAY_SUBSCRIPTION',
          'Esta assinatura não é paga com cartão pelo app. Fale com a CRMThink para alterar o pagamento.',
          HttpStatus.CONFLICT,
        );
      case 'PLAN_NOT_FOUND':
      case 'PLAN_INACTIVE':
      case 'PLAN_NOT_PURCHASABLE':
      case 'PLAN_TYPE_MISMATCH':
        // Cadastro do plano divergente entre o app e a plataforma (SPA 1138, preço Stripe).
        this.logger.error({ alert: true, ...context, code: error.code }, 'plano não vendável');
        return new DomainError(
          'PLAN_NOT_AVAILABLE',
          'Plano indisponível.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      case 'PAYMENTS_UNAVAILABLE':
      case 'GATEWAY_ERROR':
        this.logger.error(
          { alert: true, ...context, code: error.code },
          'pagamentos indisponíveis',
        );
        return paymentsUnavailable();
      default:
        return error;
    }
  }
}

function subscriptionExists(): DomainError {
  return new DomainError(
    'SUBSCRIPTION_ALREADY_EXISTS',
    'Este portal já tem um plano ativo. Para mudar, use a troca de plano.',
    HttpStatus.CONFLICT,
  );
}

function manualSubscription(): DomainError {
  return new DomainError(
    'MANUAL_SUBSCRIPTION',
    'Sua assinatura foi contratada com a CRMThink. Para trocar de plano, fale com o time comercial.',
    HttpStatus.CONFLICT,
  );
}

function paymentsUnavailable(): DomainError {
  return new DomainError(
    'PAYMENTS_UNAVAILABLE',
    'Os pagamentos estão indisponíveis no momento. Tente de novo em instantes.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
