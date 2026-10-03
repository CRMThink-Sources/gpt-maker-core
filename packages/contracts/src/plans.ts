import { z } from 'zod';

export type PlanInterval = 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

/**
 * Plano à venda no app (spec payments-integration, "Contratação com Checkout embutido"): dados do
 * crmthink-platform (`GET /v1/plans`) com os créditos de `plan_entitlement`. Planos sem direitos
 * cadastrados e o plano de trial não aparecem.
 */
export interface PlanOfferView {
  id: number;
  name: string;
  /** Centavos, como cadastrado no CRM; o valor cobrado é o do Stripe. */
  amount: number;
  /** Só em assinaturas. */
  interval: PlanInterval | null;
  /** Créditos por ciclo (assinatura) ou do pacote (avulso). */
  credits: number;
}

export interface PlansView {
  subscriptions: PlanOfferView[];
  packages: PlanOfferView[];
}

export const checkoutRequestSchema = z.object({
  planId: z.number().int().positive(),
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/** Sessão do Stripe Embedded Checkout; ativação e créditos só chegam pelos eventos. */
export interface CheckoutSessionView {
  clientSecret: string;
  intent: 'subscribe' | 'purchase';
  /** Compra avulsa: acompanhe por `GET /app/checkout/purchases/:id`. */
  purchaseId: number | null;
}

/** Troca de plano de assinatura paga com cartão (`stripe`). */
export const changePlanRequestSchema = z.object({
  planId: z.number().int().positive(),
});

export interface ChangePlanView {
  /** `immediate`: upgrade já vale (créditos proporcionais pelo evento); `next_period`: na renovação. */
  effective: 'immediate' | 'next_period';
  /** Quando o downgrade passa a valer. */
  effectiveAt: string | null;
}

export interface PurchaseStatusView {
  /** `true` quando o `purchase.paid` já creditou o pacote. */
  credited: boolean;
}

export interface BillingPortalView {
  url: string;
}
