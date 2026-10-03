'use client';

import type {
  BillingPortalView,
  ChangePlanView,
  CheckoutSessionView,
  CreditSummaryView,
  PlanInterval,
  PlanOfferView,
  PlansView,
  PurchaseStatusView,
} from '@gptmaker/contracts';
import { loadStripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, buttonClass, Card, Loading, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { useAppSession } from '../session-provider';

/** Consulta enquanto o evento da plataforma não chega (ativação ou pacote creditado). */
const POLL_MS = 3000;
/** Depois disso, a tela para de esperar e avisa que os créditos chegam em instantes. */
const POLL_LIMIT_MS = 3 * 60_000;

const INTERVALS: Record<PlanInterval, string> = {
  monthly: 'mês',
  quarterly: 'trimestre',
  semiannual: 'semestre',
  yearly: 'ano',
};

const CYCLE_CREDITS: Record<PlanInterval, string> = {
  monthly: 'por mês',
  quarterly: 'por trimestre',
  semiannual: 'por semestre',
  yearly: 'por ano',
};

function price(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
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
            message: errorMessage(e, 'Não foi possível abrir o pagamento. Tente de novo.'),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
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
      title={kind === 'subscription' ? `Contratar ${offer.name}` : `Comprar ${offer.name}`}
      description={
        kind === 'package' && expiresAt
          ? `Os créditos adicionais valem até ${formatDate(expiresAt)}, junto com os créditos do plano.`
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
            {finished ? 'Fechar' : 'Cancelar'}
          </button>
        </div>
      }
    >
      {state.step === 'starting' && <Loading label="Abrindo o pagamento…" />}
      {state.step === 'error' && <Alert tone="error">{state.message}</Alert>}
      {state.step === 'processing' && (
        <div className="flex items-center gap-3 py-6">
          <Spinner />
          <p className="text-sm text-zinc-700">
            Pagamento recebido. Confirmando {kind === 'subscription' ? 'o plano' : 'os créditos'}…
          </p>
        </div>
      )}
      {state.step === 'done' && (
        <Alert tone="success">
          {kind === 'subscription'
            ? `${offer.name} ativo. Os créditos do plano já estão no saldo.`
            : `${offer.credits.toLocaleString('pt-BR')} créditos adicionados ao saldo.`}
        </Alert>
      )}
      {state.step === 'slow' && (
        <Alert tone="warning">
          O pagamento foi concluído e a confirmação está demorando. Os créditos aparecem no saldo
          assim que ela chegar; não é preciso pagar de novo.
        </Alert>
      )}
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
          ? `Plano alterado para ${target.name}. Os créditos proporcionais aparecem no saldo em instantes.`
          : `Troca para ${target.name} agendada${
              result.effectiveAt ? ` para ${formatDate(result.effectiveAt)}` : ' para a renovação'
            }. Até lá, o plano atual continua valendo.`,
      );
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível trocar de plano. Tente de novo.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Mudar para ${target.name}`}
      onRequestClose={() => !busy && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={buttonClass('secondary')}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={buttonClass('primary')}
          >
            {busy && <Spinner className="size-4" />}
            Confirmar troca
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-zinc-700">
        <p>
          De <strong>{current?.name ?? 'plano atual'}</strong> para <strong>{target.name}</strong> (
          {target.credits.toLocaleString('pt-BR')} créditos por ciclo, {price(target.amount)}
          {target.interval ? `/${INTERVALS[target.interval]}` : ''}).
        </p>
        {upgrade ? (
          <p>
            A troca vale <strong>agora</strong>. O cartão é cobrado só pela diferença proporcional
            ao que resta do ciclo, e você recebe na hora a parte proporcional dos créditos a mais.
          </p>
        ) : (
          <p>
            A troca vale na <strong>próxima renovação</strong>. Até lá, o plano atual e os créditos
            dele continuam valendo. Se algum agente usar um modelo de IA que o novo plano não
            inclui, ele passa a usar o modelo padrão.
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
  return (
    <Card className="flex flex-col p-5">
      <p className="text-sm font-semibold text-zinc-900">{offer.name}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
        {price(offer.amount)}
        {offer.interval && (
          <span className="text-sm font-normal text-zinc-500">/{INTERVALS[offer.interval]}</span>
        )}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-zinc-600">
        <CheckIcon className="size-4 text-brand-600" />
        {offer.credits.toLocaleString('pt-BR')} créditos{' '}
        {kind === 'subscription' && offer.interval ? CYCLE_CREDITS[offer.interval] : ''}
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
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar os planos.')),
      );
    return () => {
      cancelled = true;
    };
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
      setError(errorMessage(e, 'Não foi possível abrir o portal de pagamento.'));
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
          <h2 className="text-base font-semibold text-zinc-900">Plano</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {paid
              ? `Plano atual: ${currentPlan?.name ?? `#${summary.subscription!.planId}`}.`
              : 'Escolha um plano para seus agentes continuarem atendendo.'}
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
            Gerenciar pagamento
          </button>
        )}
      </div>

      {status === 'past_due' && (
        <Alert tone="warning" className="mb-3">
          O último pagamento não foi aprovado. Atualize o cartão em “Gerenciar pagamento”
          {summary.graceUntil
            ? ` até ${formatDateTime(summary.graceUntil)}; depois disso, os agentes ficam pausados até a regularização.`
            : ' para não interromper o atendimento dos agentes.'}
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
          Troca para {nextPlan?.name ?? `o plano #${summary.subscription.nextPlanId}`} agendada
          {summary.expiresAt ? ` para ${formatDate(summary.expiresAt)}` : ' para a renovação'}. Até
          lá, o plano atual continua valendo.
        </Alert>
      )}
      {paid && manual && (
        <p className="mb-3 text-sm text-zinc-500">
          Sua assinatura foi contratada com a CRMThink: para trocar de plano, fale com o time
          comercial.
        </p>
      )}
      {!session.canManage && !paid && (
        <Alert tone="warning" className="mb-3">
          Somente o administrador do app pode contratar planos.
        </Alert>
      )}
      {session.canManage && config.stripePublishableKey === null && (
        <Alert tone="warning" className="mb-3">
          A contratação pelo app não está disponível neste ambiente. Fale com a CRMThink.
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
              action={buyButton(offer, 'subscription', 'Contratar')}
            />
          ))}
          {plans.subscriptions.length === 0 && (
            <p className="text-sm text-zinc-500">Nenhum plano disponível no momento.</p>
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
                    <p className="text-center text-sm font-medium text-brand-700">Plano atual</p>
                  ) : session.canManage && !manual ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setChanging(offer);
                      }}
                      className={`${buttonClass('secondary')} w-full`}
                    >
                      Mudar para este plano
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
          <h3 className="text-sm font-semibold text-zinc-900">Créditos adicionais</h3>
          <p className="mt-0.5 mb-3 text-sm text-zinc-500">
            {status === 'active'
              ? summary.expiresAt
                ? `Valem até ${formatDate(summary.expiresAt)}, junto com os créditos do plano.`
                : 'Valem até o fim do ciclo do plano.'
              : 'Disponíveis para quem tem um plano ativo.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.packages.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                kind="package"
                action={status === 'active' ? buyButton(offer, 'package', 'Comprar') : undefined}
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
