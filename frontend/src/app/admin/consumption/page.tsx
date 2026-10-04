'use client';

import type {
  AdminReconciliationReview,
  AdminReconciliationReviewsView,
  PartnerReportView,
} from '@gptmaker/contracts';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

const credits = (value: number) => value.toLocaleString('pt-BR');
const brl = (cents: number | null) =>
  cents === null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Número com sinal (+/−). */
const signed = (value: number) => (value > 0 ? `+${credits(value)}` : credits(value));
const dayLabel = (day: string) => day.split('-').reverse().join('/');

function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-900">{value}</dd>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Relatório mensal: consumo no GPTMaker x cobrado dos clientes x receita (14.4/15.7). */
function PartnerReport({ onReviews }: { onReviews: () => void }) {
  const { api } = useAdmin();
  const [month, setMonth] = useState(currentMonth);
  const [loaded, setLoaded] = useState<PartnerReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<PartnerReportView>(`/admin/reconciliation/partner-report?${new URLSearchParams({ month })}`)
      .then((r) => !cancelled && setLoaded(r))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [api, month]);

  // Relatório de outro mês (troca em andamento) não aparece.
  const report = loaded?.month === month ? loaded : null;
  const totals = report?.totals;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Relatório do partner</h2>
          <p className="text-xs text-zinc-500">
            Consumo real no GPTMaker (fatura pós-paga) contra o que foi cobrado dos portais.
          </p>
        </div>
        <input
          type="month"
          value={month}
          max={currentMonth()}
          onChange={(e) => {
            if (!e.target.value) return;
            setError(null);
            setMonth(e.target.value);
          }}
          className={`${inputClass} w-auto`}
          aria-label="Mês"
        />
      </div>

      {error && (
        <Alert tone="error" className="m-5">
          {error}
        </Alert>
      )}
      {!report && !error && <Loading />}

      {report && totals && (
        <div className="space-y-5 p-5">
          <div className="space-y-2">
            {report.daysReconciled < report.daysInPeriod && (
              <Alert tone="warning">
                Consumo coletado em {report.daysReconciled} de {report.daysInPeriod} dia(s)
                encerrados. Os dias que faltam entram na próxima reconciliação (diária, 03:20).
              </Alert>
            )}
            {report.pendingReviews > 0 && (
              <Alert tone="warning">
                {report.pendingReviews} ajuste(s) do mês aguardando revisão: o cobrado ainda não
                reflete o consumo real.{' '}
                <button type="button" onClick={onReviews} className="font-medium underline">
                  Revisar
                </button>
              </Alert>
            )}
            {report.platformError && (
              <Alert tone="warning">
                Planos da plataforma indisponíveis: receita de assinaturas não estimada.
              </Alert>
            )}
          </div>

          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Metric
              label="Consumo GPTMaker"
              value={credits(totals.consumed)}
              hint={totals.unlinked ? `${credits(totals.unlinked)} sem portal` : 'créditos'}
            />
            <Metric
              label="Cobrado dos portais"
              value={credits(totals.charged)}
              hint={`débitos ${credits(totals.debited)}, ajustes ${signed(-totals.adjusted)}`}
            />
            <Metric
              label="Saldo em créditos"
              value={signed(totals.charged - totals.consumed)}
              hint="cobrado − consumido"
            />
            <Metric
              label="Receita"
              value={brl(totals.revenue.total)}
              hint={
                totals.revenue.refunds
                  ? `${brl(totals.revenue.refunds)} reembolsado`
                  : 'assinaturas + pacotes'
              }
            />
            <Metric
              label="Custo GPTMaker"
              value={brl(totals.costCents)}
              hint={
                report.creditCostCents === null
                  ? 'defina GPTMAKER_CREDIT_COST_CENTS'
                  : `${brl(report.creditCostCents)} por crédito`
              }
            />
            <Metric label="Margem" value={brl(totals.marginCents)} hint="receita − custo" />
          </dl>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Portal</th>
                  <th className="px-3 py-2 text-right font-medium">Consumo</th>
                  <th className="px-3 py-2 text-right font-medium">Débitos</th>
                  <th className="px-3 py-2 text-right font-medium">Ajustes</th>
                  <th className="px-3 py-2 text-right font-medium">Cobrado</th>
                  <th className="px-3 py-2 text-right font-medium">Receita</th>
                  <th className="py-2 pl-3 text-right font-medium">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {report.tenants.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-zinc-500">
                      Sem movimento no mês.
                    </td>
                  </tr>
                )}
                {report.tenants.map((t) => (
                  <Fragment key={t.tenant.id}>
                    <tr>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          onClick={() => setOpen(open === t.tenant.id ? null : t.tenant.id)}
                          className="text-left font-medium text-zinc-900 hover:underline"
                          aria-expanded={open === t.tenant.id}
                        >
                          {open === t.tenant.id ? '▾' : '▸'} {t.tenant.domain}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{credits(t.consumed)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{credits(t.debited)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{signed(-t.adjusted)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{credits(t.charged)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(t.revenue.total)}</td>
                      <td
                        className={`py-2 pl-3 text-right tabular-nums ${
                          (t.marginCents ?? 0) < 0 ? 'text-red-700' : ''
                        }`}
                      >
                        {brl(t.marginCents)}
                      </td>
                    </tr>
                    {open === t.tenant.id && (
                      <>
                        {t.agents.map((a) => (
                          <tr key={a.agentId} className="bg-zinc-50 text-zinc-600">
                            <td className="py-1.5 pr-3 pl-5">
                              {a.name}
                              {a.removed && <span className="text-xs"> (removido)</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {credits(a.consumed)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {credits(a.debited)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {signed(-a.adjusted)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {credits(a.charged)}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        ))}
                        <tr className="bg-zinc-50 text-xs text-zinc-500">
                          <td colSpan={7} className="py-1.5 pl-5">
                            Receita: assinaturas {brl(t.revenue.subscriptions)}, pacotes{' '}
                            {brl(t.revenue.packages)}
                            {t.revenue.refunds > 0 && <>, reembolsos {brl(t.revenue.refunds)}</>}
                            {' · '}
                            <Link
                              href={`/admin/tenants/${t.tenant.id}`}
                              className="text-brand-700 hover:underline"
                            >
                              abrir portal
                            </Link>
                          </td>
                        </tr>
                      </>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {report.unlinked.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Consumo sem portal ({credits(totals.unlinked)} créditos)
              </h3>
              <p className="text-xs text-zinc-500">
                Agentes do workspace sem dono no app: custo que nenhum cliente paga. Vincule ou
                remova em{' '}
                <Link href="/admin/workspace" className="text-brand-700 hover:underline">
                  Workspace
                </Link>
                .
              </p>
              <ul className="mt-2 divide-y divide-zinc-100 text-sm">
                {report.unlinked.map((u) => (
                  <li key={u.gptmakerAgentId} className="flex justify-between gap-3 py-1.5">
                    <span>
                      {u.name ?? 'Sem nome'}{' '}
                      <code className="text-xs text-zinc-500">{u.gptmakerAgentId}</code>
                    </span>
                    <span className="tabular-nums">{credits(u.consumed)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-zinc-500">
            Dias pelo fuso {report.timeZone}. Assinaturas estimadas pelo preço do plano (os eventos
            da plataforma não trazem o valor cobrado); pacotes e reembolsos pelo valor cobrado.
            Ajustes: o que a reconciliação somou (+) ou devolveu (−) na cobrança.
          </p>
        </div>
      )}
    </Card>
  );
}

const STATUS: Record<
  AdminReconciliationReview['status'],
  { label: string; tone: 'amber' | 'green' | 'zinc' }
> = {
  REVIEW: { label: 'Aguardando', tone: 'amber' },
  APPROVED: { label: 'Aprovado', tone: 'green' },
  DISMISSED: { label: 'Descartado', tone: 'zinc' },
};

/** O que a aprovação faz com o saldo do cliente, em palavras. */
function effect(r: AdminReconciliationReview): string {
  if (r.pending === 0) return 'nada a lançar';
  return r.pending > 0
    ? `devolve ${credits(r.pending)} créditos ao cliente`
    : `cobra ${credits(-r.pending)} créditos do cliente`;
}

/** Ajustes da reconciliação acima do limite, à espera de um operador (14.2). */
function Reviews({
  view,
  onDecided,
}: {
  view: AdminReconciliationReviewsView;
  onDecided: (view: AdminReconciliationReviewsView, text: string) => void;
}) {
  const { api } = useAdmin();
  const isAdmin = useOperator().role === 'ADMIN';
  const [confirm, setConfirm] = useState<{
    review: AdminReconciliationReview;
    decision: 'approve' | 'dismiss';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide() {
    if (!confirm) return;
    const { review, decision } = confirm;
    setBusy(true);
    setError(null);
    try {
      const next = await api<AdminReconciliationReviewsView>(
        `/admin/reconciliation/reviews/${review.agentId}/${review.day}`,
        { method: 'POST', body: JSON.stringify({ decision }) },
      );
      setConfirm(null);
      onDecided(
        next,
        decision === 'approve'
          ? `Ajuste de ${review.agentName} em ${dayLabel(review.day)} lançado.`
          : `Ajuste de ${review.agentName} em ${dayLabel(review.day)} descartado.`,
      );
    } catch (e) {
      setError(message(e, 'Não foi possível concluir.'));
    } finally {
      setBusy(false);
    }
  }

  const row = (r: AdminReconciliationReview, actions: boolean) => (
    <li
      key={`${r.agentId}:${r.day}`}
      className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-900">
          {r.agentName} · {dayLabel(r.day)}{' '}
          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
        </p>
        <p className="text-xs text-zinc-500">
          <Link href={`/admin/tenants/${r.tenant.id}`} className="hover:underline">
            {r.tenant.domain}
          </Link>{' '}
          · GPTMaker {credits(r.real)} · debitado {credits(r.debited)}
          {r.adjusted !== 0 && (
            <>
              {' '}
              · já {r.adjusted > 0 ? 'devolvidos' : 'cobrados'} {credits(Math.abs(r.adjusted))}
            </>
          )}
          {actions ? <> · aprovar {effect(r)}</> : null}
          {r.reviewedBy && (
            <>
              {' '}
              · por {r.reviewedBy}
              {r.reviewedAt && <> em {new Date(r.reviewedAt).toLocaleString('pt-BR')}</>}
            </>
          )}
        </p>
      </div>
      {actions && isAdmin && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setConfirm({ review: r, decision: 'approve' })}
            className={buttonClass('ghost', 'sm')}
          >
            Aprovar
          </button>
          <button
            type="button"
            onClick={() => setConfirm({ review: r, decision: 'dismiss' })}
            className={buttonClass('ghost', 'sm')}
          >
            Descartar
          </button>
        </div>
      )}
    </li>
  );

  return (
    <Card>
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">
          Ajustes em revisão ({view.open.length})
        </h2>
        <p className="text-xs text-zinc-500">
          Diferença entre consumo real e debitado acima de {credits(view.reviewThreshold)} créditos
          num dia: não é lançada sozinha (protege contra fuso errado ou falha do GPTMaker). Aprovar
          lança a diferença no saldo do cliente; descartar mantém como está.
        </p>
      </div>
      {view.open.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-500">Nada aguardando revisão.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">{view.open.map((r) => row(r, true))}</ul>
      )}
      {view.recent.length > 0 && (
        <>
          <h3 className="border-t border-zinc-100 px-5 pt-3 text-xs font-semibold text-zinc-500">
            Decididos recentemente
          </h3>
          <ul className="divide-y divide-zinc-100">{view.recent.map((r) => row(r, false))}</ul>
        </>
      )}

      {confirm && (
        <Modal
          title={confirm.decision === 'approve' ? 'Aprovar ajuste' : 'Descartar ajuste'}
          description={
            confirm.decision === 'approve'
              ? `${confirm.review.agentName} em ${dayLabel(confirm.review.day)}: ${effect(confirm.review)} (${confirm.review.tenant.domain}).`
              : `Nada é lançado para ${confirm.review.agentName} em ${dayLabel(confirm.review.day)}. Se o consumo do dia mudar, ele volta para revisão.`
          }
          onRequestClose={() => !busy && setConfirm(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={busy}
                className={buttonClass('secondary')}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void decide()}
                disabled={busy}
                className={buttonClass()}
              >
                {busy && <Spinner className="size-4" />}
                {confirm.decision === 'approve' ? 'Aprovar e lançar' : 'Descartar'}
              </button>
            </div>
          }
        >
          {error && <Alert tone="error">{error}</Alert>}
        </Modal>
      )}
    </Card>
  );
}

/** Consumo: relatório do partner e revisão dos ajustes da reconciliação. */
export default function AdminConsumptionPage() {
  const { api } = useAdmin();
  const [reviews, setReviews] = useState<AdminReconciliationReviewsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reportKey, setReportKey] = useState(0);

  const loadReviews = useCallback(
    () => api<AdminReconciliationReviewsView>('/admin/reconciliation/reviews'),
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    loadReviews()
      .then((v) => !cancelled && setReviews(v))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [loadReviews]);

  return (
    <>
      <PageHeader
        title="Consumo"
        description="Quanto o GPTMaker vai cobrar do partner e quanto foi cobrado dos portais."
      />
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      <div className="space-y-6">
        <PartnerReport
          key={reportKey}
          onReviews={() => document.getElementById('revisoes')?.scrollIntoView()}
        />
        <div id="revisoes">
          {reviews ? (
            <Reviews
              view={reviews}
              onDecided={(next, text) => {
                setReviews(next);
                setNotice(text);
                setReportKey((k) => k + 1);
              }}
            />
          ) : (
            !error && <Loading />
          )}
        </div>
      </div>
    </>
  );
}
