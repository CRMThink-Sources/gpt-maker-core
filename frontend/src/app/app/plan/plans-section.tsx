'use client';

import type {
  BillingPortalView,
  ChangePlanView,
  CheckoutSessionView,
  CreditSummaryView,
  PlanOfferView,
  PlansView,
  PurchaseStatusView,
} from '@gptmaker/contracts';
import { loadStripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, buttonClass, Card, Loading, Spinner } from '@/components/ui';
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { useAppSession } from '../session-provider';

/** Consulta enquanto o evento da plataforma não chega (ativação ou pacote creditado). */
const POLL_MS = 3000;
/** Depois disso, a tela para de esperar e avisa que os créditos chegam em instantes. */
const POLL_LIMIT_MS = 3 * 60_000;

type Format = ReturnType<typeof useFormat>;

function price(format: Format, cents: number): string {
  return format.number(cents / 100, { style: 'currency', currency: 'BRL' });
}

function formatDate(format: Format, iso: string): string {
  return format.dateTime(new Date(iso), { timeZone: 'America/Sao_Paulo', dateStyle: 'short' });
}

function formatDateTime(format: Format, iso: string): string {
  return format.dateTime(new Date(iso), {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

type CheckoutState =
  | { step: 'starting' }
  | { step: 'paying' }
  // A sessão vai com o estado: só a execução que montou o checkout decide o que confirmar.
  | { step: 'processing'; session: CheckoutSessionView }
  | { step: 'done' }
  | { step: 'slow' }
  | { step: 'error'; message: string };

/**
 * Stripe Embedded Checkout num modal. Concluído o pagamento, espera o evento da plataforma
 * (`subscription.activated` ou `purchase.paid`) consultando o backend: o retorno do navegador
 * nunca ativa nada (spec payments-integration).
 */
function CheckoutModal({
  offer,
  kind,
  expiresAt,
  onClose,
  onSettled,
}: {
  offer: PlanOfferView;
  kind: 'subscription' | 'package';
  expiresAt: string | null;
  onClose: () => void;
  onSettled: () => void;
}) {
  const { api, config } = useAppSession();
  const t = useT('plan');
  const format = useFormat();
  const errorText = useErrorMessage('plan');
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CheckoutState>({ step: 'starting' });

  useEffect(() => {
    let cancelled = false;
    let checkout: StripeEmbeddedCheckout | null = null;
    (async () => {
      try {
        const created = await api<CheckoutSessionView>('/app/checkout', {
          method: 'POST',
          body: JSON.stringify({ planId: offer.id }),
        });
        // Strict Mode (dev) roda o efeito duas vezes: a execução descartada para aqui.
        if (cancelled) return;
        const stripe = await loadStripe(config.stripePublishableKey!);
        if (!stripe) throw new Error('Stripe.js indisponível');
        checkout = await stripe.createEmbeddedCheckoutPage({
          clientSecret: created.clientSecret,
          onComplete: () => !cancelled && setState({ step: 'processing', session: created }),
        });
        if (cancelled) {
          checkout.destroy();
          return;
        }
        checkout.mount(container.current!);
        setState({ step: 'paying' });
      } catch (e) {
        if (!cancelled) {
          setState({
            step: 'error',
            message: errorMessage(e, t('checkout.openFailed'), errorText),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
    // Trocar o idioma não deve refazer a consulta; só o texto de erro usa `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, config.stripePublishableKey, offer.id]);

  // Pagamento concluído: espera o evento chegar ao backend.
  useEffect(() => {
    if (state.step !== 'processing') return;
    const started = Date.now();
    const created = state.session;
    const check = async (): Promise<boolean> => {
      if (created.intent === 'purchase' && created.purchaseId !== null) {
        const status = await api<PurchaseStatusView>(
          `/app/checkout/purchases/${created.purchaseId}`,
        );
        return status.credited;
      }
      const summary = await api<CreditSummaryView>('/app/credits');
      return summary.subscription?.status === 'active';
    };
    const timer = setInterval(() => {
      check()
        .then((settled) => {
          if (settled) {
            setState({ step: 'done' });
            onSettled();
          } else if (Date.now() - started > POLL_LIMIT_MS) {
            setState({ step: 'slow' });
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state, api, onSettled]);

  const finished = state.step === 'done' || state.step === 'slow' || state.step === 'error';
  return (
    <Modal
      title={
        kind === 'subscription'
          ? t('checkout.subscribeTitle', { name: offer.name })
          : t('checkout.buyTitle', { name: offer.name })
      }
      description={
        kind === 'package' && expiresAt
          ? t('checkout.extraValidUntil', { date: formatDate(format, expiresAt) })
          : undefined
      }
      onRequestClose={() => {
        if (state.step !== 'processing') onClose();
      }}
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={state.step === 'processing'}
            className={buttonClass(finished ? 'primary' : 'secondary')}
          >
            {finished ? t('checkout.close') : t('checkout.cancel')}
          </button>
        </div>
      }
    >
      {state.step === 'starting' && <Loading label={t('checkout.opening')} />}
      {state.step === 'error' && <Alert tone="error">{state.message}</Alert>}
      {state.step === 'processing' && (
        <div className="flex items-center gap-3 py-6">
          <Spinner />
          <p className="text-sm text-zinc-700">
            {kind === 'subscription'
              ? t('checkout.confirmingPlan')
              : t('checkout.confirmingCredits')}
          </p>
        </div>
      )}
      {state.step === 'done' && (
        <Alert tone="success">
          {kind === 'subscription'
            ? t('checkout.planActive', { name: offer.name })
            : t('checkout.creditsAdded', { count: offer.credits })}
        </Alert>
      )}
      {state.step === 'slow' && <Alert tone="warning">{t('checkout.slow')}</Alert>}
      {/* O Stripe monta o checkout aqui; some quando o pagamento termina. */}
      <div
        ref={container}
        className={state.step === 'paying' ? 'min-h-96' : 'hidden'}
        aria-hidden={state.step !== 'paying'}
      />
    </Modal>
  );
}

/**
 * Confirmação da troca de plano (12.6). Upgrade vale na hora, com cobrança proporcional e os
 * créditos proporcionais pelo evento; downgrade vale na renovação.
 */
function ChangePlanModal({
  current,
  target,
  onClose,
  onDone,
}: {
  current: PlanOfferView | undefined;
  target: PlanOfferView;
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const { api } = useAppSession();
  const t = useT('plan');
  const format = useFormat();
  const errorText = useErrorMessage('plan');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upgrade = !current || target.credits > current.credits;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<ChangePlanView>('/app/subscription/change-plan', {
        method: 'POST',
        body: JSON.stringify({ planId: target.id }),
      });
      onDone(
        result.effective === 'immediate'
          ? t('change.doneImmediate', { name: target.name })
          : result.effectiveAt
            ? t('change.scheduledAt', {
                name: target.name,
                date: formatDate(format, result.effectiveAt),
              })
            : t('change.scheduledRenewal', { name: target.name }),
      );
    } catch (e) {
      setError(errorMessage(e, t('change.failed'), errorText));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('change.title', { name: target.name })}
      onRequestClose={() => !busy && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={buttonClass('secondary')}
          >
            {t('change.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={buttonClass('primary')}
          >
            {busy && <Spinner className="size-4" />}
            {t('change.confirm')}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-zinc-700">
        <p>
          {t('change.from')} <strong>{current?.name ?? t('change.currentPlan')}</strong>{' '}
          {t('change.to')} <strong>{target.name}</strong> (
          {t('change.detail', {
            credits: format.number(target.credits),
            price: price(format, target.amount),
            interval: target.interval ? `/${t(`intervals.${target.interval}`)}` : '',
          })}
          ).
        </p>
        {upgrade ? (
          <p>
            {t('change.upgradeBefore')} <strong>{t('change.now')}</strong>.{' '}
            {t('change.upgradeAfter')}
          </p>
        ) : (
          <p>
            {t('change.downgradeBefore')} <strong>{t('change.nextRenewal')}</strong>.{' '}
            {t('change.downgradeAfter')}
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function OfferCard({
  offer,
  kind,
  action,
}: {
  offer: PlanOfferView;
  kind: 'subscription' | 'package';
  action?: React.ReactNode;
}) {
  const t = useT('plan');
  const format = useFormat();
  return (
    <Card className="flex flex-col p-5">
      <p className="text-sm font-semibold text-zinc-900">{offer.name}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
        {price(format, offer.amount)}
        {offer.interval && (
          <span className="text-sm font-normal text-zinc-500">
            /{t(`intervals.${offer.interval}`)}
          </span>
        )}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-zinc-600">
        <CheckIcon className="size-4 text-brand-600" />
        {kind === 'subscription' && offer.interval
          ? t('offer.creditsPerCycle', {
              count: offer.credits,
              cycle: t(`cycleCredits.${offer.interval}`),
            })
          : t('offer.credits', { count: offer.credits })}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

/**
 * Planos e pacotes à venda, plano atual e "Gerenciar pagamento" (spec payments-integration,
 * tarefa 12.11). Troca de plano fica na 12.6.
 */
export function PlansSection({
  summary,
  onChanged,
}: {
  summary: CreditSummaryView;
  onChanged: () => void;
}) {
  const { session, api, config } = useAppSession();
  const t = useT('plan');
  const format = useFormat();
  const errorText = useErrorMessage('plan');
  const [plans, setPlans] = useState<PlansView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<{
    offer: PlanOfferView;
    kind: 'subscription' | 'package';
  } | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [changing, setChanging] = useState<PlanOfferView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<PlansView>('/app/plans')
      .then((view) => !cancelled && setPlans(view))
      .catch(
        (e: unknown) => !cancelled && setError(errorMessage(e, t('section.loadFailed'), errorText)),
      );
    return () => {
      cancelled = true;
    };
    // Trocar o idioma não deve refazer a consulta; só o texto de erro usa `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const status = summary.subscription?.status;
  const paid = status === 'active' || status === 'past_due';
  const canBuy = session.canManage && config.stripePublishableKey !== null;
  const currentPlan = plans?.subscriptions.find(
    (offer) => String(offer.id) === summary.subscription?.planId,
  );
  const nextPlan = plans?.subscriptions.find(
    (offer) => String(offer.id) === summary.subscription?.nextPlanId,
  );
  const manual = summary.subscription?.modality === 'manual';

  const settle = useCallback(() => onChanged(), [onChanged]);

  async function openPortal() {
    setPortalBusy(true);
    setError(null);
    try {
      const { url } = await api<BillingPortalView>('/app/billing-portal', { method: 'POST' });
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(errorMessage(e, t('section.portalFailed'), errorText));
    } finally {
      setPortalBusy(false);
    }
  }

  function buyButton(offer: PlanOfferView, kind: 'subscription' | 'package', label: string) {
    return (
      <button
        type="button"
        disabled={!canBuy}
        onClick={() => setBuying({ offer, kind })}
        className={`${buttonClass(kind === 'subscription' ? 'primary' : 'secondary')} w-full`}
      >
        {label}
      </button>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">{t('section.title')}</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {paid
              ? t('section.current', {
                  name: currentPlan?.name ?? `#${summary.subscription!.planId}`,
                })
              : t('section.choose')}
          </p>
        </div>
        {paid && session.canManage && (
          <button
            type="button"
            onClick={() => void openPortal()}
            disabled={portalBusy}
            className={buttonClass('secondary')}
          >
            {portalBusy && <Spinner className="size-4" />}
            {t('section.managePayment')}
          </button>
        )}
      </div>

      {status === 'past_due' && (
        <Alert tone="warning" className="mb-3">
          {summary.graceUntil
            ? t('section.pastDueUntil', { date: formatDateTime(format, summary.graceUntil) })
            : t('section.pastDue')}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-3">
          {notice}
        </Alert>
      )}
      {paid && summary.subscription?.nextPlanId && (
        <Alert tone="warning" className="mb-3">
          {summary.expiresAt
            ? t('section.nextPlanAt', {
                name: nextPlan?.name ?? `#${summary.subscription.nextPlanId}`,
                date: formatDate(format, summary.expiresAt),
              })
            : t('section.nextPlanRenewal', {
                name: nextPlan?.name ?? `#${summary.subscription.nextPlanId}`,
              })}
        </Alert>
      )}
      {paid && manual && <p className="mb-3 text-sm text-zinc-500">{t('section.manual')}</p>}
      {!session.canManage && !paid && (
        <Alert tone="warning" className="mb-3">
          {t('section.adminOnly')}
        </Alert>
      )}
      {session.canManage && config.stripePublishableKey === null && (
        <Alert tone="warning" className="mb-3">
          {t('section.checkoutUnavailable')}
        </Alert>
      )}

      {!plans && !error && <Loading />}

      {plans && !paid && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.subscriptions.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              kind="subscription"
              action={buyButton(offer, 'subscription', t('section.subscribe'))}
            />
          ))}
          {plans.subscriptions.length === 0 && (
            <p className="text-sm text-zinc-500">{t('section.noPlans')}</p>
          )}
        </div>
      )}

      {plans && paid && plans.subscriptions.length > 1 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.subscriptions.map((offer) => {
            const isCurrent = String(offer.id) === summary.subscription?.planId;
            return (
              <OfferCard
                key={offer.id}
                offer={offer}
                kind="subscription"
                action={
                  isCurrent ? (
                    <p className="text-center text-sm font-medium text-brand-700">
                      {t('section.currentBadge')}
                    </p>
                  ) : session.canManage && !manual ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setChanging(offer);
                      }}
                      className={`${buttonClass('secondary')} w-full`}
                    >
                      {t('section.changeToThis')}
                    </button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}

      {plans && plans.packages.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-zinc-900">{t('section.extraTitle')}</h3>
          <p className="mt-0.5 mb-3 text-sm text-zinc-500">
            {status === 'active'
              ? summary.expiresAt
                ? t('section.extraValidUntil', { date: formatDate(format, summary.expiresAt) })
                : t('section.extraValidCycle')
              : t('section.extraRequiresPlan')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.packages.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                kind="package"
                action={
                  status === 'active' ? buyButton(offer, 'package', t('section.buy')) : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {changing && (
        <ChangePlanModal
          current={currentPlan}
          target={changing}
          onClose={() => setChanging(null)}
          onDone={(message) => {
            setChanging(null);
            setNotice(message);
            onChanged();
          }}
        />
      )}

      {buying && (
        <CheckoutModal
          offer={buying.offer}
          kind={buying.kind}
          expiresAt={summary.expiresAt}
          onClose={() => setBuying(null)}
          onSettled={settle}
        />
      )}
    </section>
  );
}
