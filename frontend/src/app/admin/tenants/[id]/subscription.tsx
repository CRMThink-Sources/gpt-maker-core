'use client';

import type {
  AdminPlatformEvent,
  AdminSubscriptionCheckView,
  AdminSubscriptionView,
} from '@gptmaker/contracts';
import { useEffect, useState } from 'react';
import { Alert, Badge, buttonClass, Card, Loading, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { useAdmin } from '../../admin-provider';
import { dateTime, SubscriptionBadge } from '../shared';

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

const EVENT_LABELS: Record<string, string> = {
  'subscription.trial_started': 'Teste iniciado',
  'subscription.activated': 'Assinatura ativada',
  'subscription.renewed': 'Renovada',
  'subscription.past_due': 'Pagamento recusado',
  'subscription.recovered': 'Pagamento regularizado',
  'subscription.plan_changed': 'Plano trocado',
  'subscription.cancel_scheduled': 'Cancelamento agendado',
  'subscription.period_ending': 'Período terminando',
  'subscription.ended': 'Assinatura encerrada',
  'subscription.item_changed': 'Item da assinatura alterado',
  'purchase.paid': 'Pacote pago',
  'charge.refunded': 'Cobrança reembolsada',
  'charge.disputed': 'Cobrança contestada',
  'installation.removed': 'App desinstalado',
  'installation.auth_error': 'Erro de autorização',
  'installation.auth_restored': 'Autorização restabelecida',
};

const EVENT_STATUS: Record<
  AdminPlatformEvent['status'],
  { label: string; tone: 'green' | 'zinc' | 'amber' }
> = {
  PROCESSED: { label: 'Aplicado', tone: 'green' },
  OBSOLETE: { label: 'Ignorado (versão antiga)', tone: 'zinc' },
  RECEIVED: { label: 'Na fila', tone: 'zinc' },
  FAILED: { label: 'Falhou', tone: 'amber' },
};

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Resumo do que o evento diz, a partir do conteúdo (valores em centavos). */
function summary(event: AdminPlatformEvent): string | null {
  const data = (event.payload as { data?: Record<string, unknown> } | null)?.data ?? {};
  switch (event.type) {
    case 'subscription.plan_changed':
      return `plano ${String(data.previousPlanId)} → ${String(data.planId)} (${
        data.effective === 'immediate' ? 'na hora' : 'na renovação'
      })`;
    case 'purchase.paid':
      return typeof data.amount === 'number' ? brl(data.amount) : null;
    case 'charge.refunded':
      return typeof data.amountRefunded === 'number'
        ? `${brl(data.amountRefunded)} de ${brl(Number(data.amount))}`
        : null;
    case 'subscription.cancel_scheduled':
      return typeof data.effectiveAt === 'string' ? `em ${dateTime(data.effectiveAt)}` : null;
    case 'subscription.ended':
      return typeof data.reason === 'string' ? String(data.reason) : null;
    case 'subscription.period_ending':
      return typeof data.daysLeft === 'number' ? `faltam ${data.daysLeft} dia(s)` : null;
    default:
      return null;
  }
}

function EventRow({ event }: { event: AdminPlatformEvent }) {
  const [open, setOpen] = useState(false);
  const status = EVENT_STATUS[event.status];
  const text = summary(event);
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-28 shrink-0 text-xs tabular-nums text-zinc-500">
          {dateTime(event.occurredAt ?? event.receivedAt)}
        </span>
        <span className="text-zinc-900">{EVENT_LABELS[event.type] ?? event.type}</span>
        {text && <span className="text-xs text-zinc-500">{text}</span>}
        {event.correction && <Badge tone="brand">Correção</Badge>}
        <Badge tone={status.tone}>{status.label}</Badge>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-900"
          aria-expanded={open}
        >
          {open ? 'Ocultar' : 'Conteúdo'}
        </button>
      </div>
      {event.error && <p className="mt-1 text-xs text-amber-800">{event.error}</p>}
      {open && (
        <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
          <p className="mb-1 text-zinc-500">
            <code>{event.eventId}</code> · recebido {dateTime(event.receivedAt)}
            {event.attempts > 1 && <> · {event.attempts} tentativas</>}
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}

const CHECK_TEXT: Record<AdminSubscriptionCheckView['outcome'], string> = {
  ok: 'A projeção está igual à plataforma.',
  corrected:
    'A projeção estava diferente: o evento que faltou foi aplicado (aparece como correção).',
  alert:
    'Divergência que precisa de ação manual (ex.: assinatura diferente da projetada). Veja os logs.',
};

/**
 * Assinatura do portal (15.5): projeção local, links para os itens nos SPAs do portal CRMThink e
 * eventos recebidos da plataforma. Criar ou alterar assinatura manual é no SPA.
 */
export function SubscriptionSection({
  tenantId,
  isAdmin,
  onChanged,
  className = '',
}: {
  tenantId: string;
  isAdmin: boolean;
  /** A conferência pode mudar saldo e status: o detalhe do portal recarrega. */
  onChanged: () => void;
  className?: string;
}) {
  const { api } = useAdmin();
  const [view, setView] = useState<AdminSubscriptionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<AdminSubscriptionView>(`/admin/tenants/${tenantId}/subscription`)
      .then((v) => !cancelled && setView(v))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [api, tenantId]);

  async function check() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<AdminSubscriptionCheckView>(
        `/admin/tenants/${tenantId}/subscription/check`,
        { method: 'POST' },
      );
      setView(result.view);
      setNotice({
        tone: result.outcome === 'alert' ? 'warning' : 'success',
        text: CHECK_TEXT[result.outcome],
      });
      if (result.outcome === 'corrected') onChanged();
    } catch (e) {
      setError(message(e, 'Não foi possível conferir.'));
    } finally {
      setBusy(false);
    }
  }

  const sub = view?.projection;
  const plan = (p: { id: string; name: string | null } | null) =>
    p ? (p.name ? `${p.name} (${p.id})` : `plano ${p.id}`) : '—';
  const events = view ? (all ? view.events : view.events.slice(0, 5)) : [];

  return (
    <Card className={`p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">Assinatura</h2>
        {sub && <SubscriptionBadge subscription={{ status: sub.status, planId: null }} />}
        {isAdmin && (
          <button
            type="button"
            onClick={() => void check()}
            disabled={busy || !view}
            className={`ml-auto ${buttonClass('secondary', 'sm')}`}
          >
            {busy && <Spinner className="size-4" />}
            Conferir com a plataforma
          </button>
        )}
      </div>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone={notice.tone} className="mt-3">
          {notice.text}
        </Alert>
      )}
      {!view && !error && <Loading />}

      {view && (
        <>
          {sub ? (
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <Fact label="Plano" value={plan(sub.plan)} />
              <Fact
                label="Cobrança"
                value={sub.modality === 'stripe' ? 'Cartão (Stripe)' : 'Manual (SPA)'}
              />
              <Fact
                label="Período"
                value={`${dateTime(sub.periodStart)} → ${dateTime(sub.periodEnd)}`}
              />
              {sub.graceUntil && <Fact label="Carência até" value={dateTime(sub.graceUntil)} />}
              {sub.cancelAt && <Fact label="Encerra em" value={dateTime(sub.cancelAt)} />}
              {sub.nextPlan && (
                <Fact label="Plano a partir da renovação" value={plan(sub.nextPlan)} />
              )}
              <Fact
                label="Id na plataforma"
                value={`${sub.subscriptionId} · versão ${sub.version}`}
              />
              <Fact label="Projeção atualizada" value={dateTime(sub.updatedAt)} />
            </dl>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">O portal ainda não tem assinatura.</p>
          )}
          {view.platformError && (
            <p className="mt-2 text-xs text-amber-800">
              Plataforma indisponível: nomes dos planos ausentes.
            </p>
          )}

          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {view.links.subscription && (
              <a
                href={view.links.subscription}
                target="_blank"
                rel="noreferrer"
                className="text-brand-700 hover:underline"
              >
                Abrir no SPA de Assinaturas ↗
              </a>
            )}
            <a
              href={view.links.installation}
              target="_blank"
              rel="noreferrer"
              className="text-brand-700 hover:underline"
            >
              Abrir no SPA de Instalações ↗
            </a>
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Troca de plano: pela plataforma (cartão) ou no SPA de Assinaturas (manual).
          </p>

          <div className="mt-4 border-t border-zinc-100 pt-3">
            <h3 className="text-xs font-semibold text-zinc-500">
              Eventos da plataforma ({view.events.length === 30 ? 'últimos 30' : view.events.length}
              )
            </h3>
            {view.events.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">Nenhum evento recebido.</p>
            ) : (
              <>
                <ul className="divide-y divide-zinc-100">
                  {events.map((event) => (
                    <EventRow key={event.eventId} event={event} />
                  ))}
                </ul>
                {view.events.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setAll(!all)}
                    className="mt-1 text-xs text-brand-700 hover:underline"
                  >
                    {all ? 'Mostrar menos' : `Mostrar todos (${view.events.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900">{value}</dd>
    </div>
  );
}
