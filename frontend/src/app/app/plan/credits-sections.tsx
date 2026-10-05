'use client';

import {
  type AgentView,
  CREDITS_TIMEZONE,
  type CreditEntriesView,
  type CreditEntryView,
  type CreditSummaryView,
  type CreditUsageView,
  USAGE_MAX_DAYS,
} from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, buttonClass, Card, Loading, Spinner, type Tone } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { inputClass } from '../agents/agent-fields';
import { useAppSession } from '../session-provider';

const DAY_MS = 86_400_000;

/** Número com separador de milhar (pt-BR). */
function credits(value: number): string {
  return value.toLocaleString('pt-BR');
}

/** AAAA-MM-DD do instante no fuso do extrato. */
function isoDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CREDITS_TIMEZONE }).format(date);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: CREDITS_TIMEZONE });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: CREDITS_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** `2026-10-03` ⇒ `03/10/2026`, sem passar por fuso (já é o dia do extrato). */
function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
    </div>
  );
}

function BalanceCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: number;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={`p-4 ${highlight ? 'border-brand-200 bg-brand-50/40' : ''}`}>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">{credits(value)}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
}

const STATUS_LABELS: Record<NonNullable<CreditSummaryView['subscription']>['status'], string> = {
  trialing: 'Teste grátis',
  active: 'Plano ativo',
  past_due: 'Pagamento pendente',
  cancelled: 'Assinatura encerrada',
  trial_expired: 'Teste encerrado',
};

/** Saldos por carteira, validade e consumo do ciclo (spec credit-billing, "Consulta de saldo"). */
export function BalanceSection({ summary }: { summary: CreditSummaryView }) {
  const showTrial = summary.trial.balance > 0 || summary.trial.endsAt !== null;
  const facts: string[] = [];
  if (summary.expiresAt) {
    facts.push(`Créditos do plano e adicionais valem até ${formatDate(summary.expiresAt)}`);
  }
  if (summary.renewsAt) facts.push(`Renova em ${formatDate(summary.renewsAt)}`);
  if (summary.cancelAt) facts.push(`Assinatura encerra em ${formatDate(summary.cancelAt)}`);
  if (summary.cycleStart) {
    facts.push(
      `${credits(summary.consumedInCycle)} créditos consumidos desde ${formatDate(summary.cycleStart)}`,
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-zinc-900">Saldo</h2>
        {summary.subscription && (
          <Badge tone={summary.subscription.status === 'past_due' ? 'amber' : 'zinc'}>
            {STATUS_LABELS[summary.subscription.status]}
          </Badge>
        )}
      </div>
      <div
        className={`grid gap-3 sm:grid-cols-2 ${showTrial ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}
      >
        <BalanceCard label="Total disponível" value={summary.total} highlight />
        {showTrial && (
          <BalanceCard
            label="Teste grátis"
            value={summary.trial.balance}
            hint={summary.trial.endsAt ? `Até ${formatDate(summary.trial.endsAt)}` : undefined}
          />
        )}
        <BalanceCard label="Plano" value={summary.plan.balance} />
        <BalanceCard label="Adicional" value={summary.extra.balance} />
      </div>
      {facts.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-600">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      {summary.total <= 0 && (
        <Alert tone="warning" className="mt-3">
          Sem créditos: as novas mensagens são transferidas para os atendentes até que haja saldo.
        </Alert>
      )}
    </section>
  );
}

/**
 * Consumo por dia e agente (spec credit-billing, "Extrato por agente"). Período padrão: do
 * início do ciclo (ou dos últimos 30 dias) até hoje.
 */
export function UsageSection({ cycleStart }: { cycleStart: string | null }) {
  const { api } = useAppSession();
  const today = isoDay(new Date());
  const [from, setFrom] = useState(() =>
    isoDay(
      cycleStart && Date.now() - Date.parse(cycleStart) < USAGE_MAX_DAYS * DAY_MS
        ? new Date(cycleStart)
        : new Date(Date.now() - 29 * DAY_MS),
    ),
  );
  const [to, setTo] = useState(today);
  const [agentId, setAgentId] = useState('');
  const [agents, setAgents] = useState<AgentView[]>([]);
  // Resultado guardado com a consulta que o gerou: enquanto difere da atual, está carregando.
  const [result, setResult] = useState<{
    query: string;
    usage?: CreditUsageView;
    error?: string;
  } | null>(null);
  const query = new URLSearchParams(agentId ? { from, to, agentId } : { from, to }).toString();
  const loading = result?.query !== query;
  const usage = result?.usage ?? null;
  const error = result?.error ?? null;

  useEffect(() => {
    api<{ agents: AgentView[] }>('/app/agents')
      .then(({ agents }) => setAgents(agents))
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api<CreditUsageView>(`/app/credits/usage?${query}`)
      .then((view) => !cancelled && setResult({ query, usage: view }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setResult({ query, error: errorMessage(e, 'Não foi possível carregar o consumo.') }),
      );
    return () => {
      cancelled = true;
    };
  }, [api, query]);

  return (
    <section>
      <SectionTitle
        title="Consumo por dia"
        description={`Créditos e respostas por agente. Períodos de até ${USAGE_MAX_DAYS} dias.`}
      />
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="font-medium text-zinc-800">De</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-zinc-800">Até</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="min-w-48 flex-1 text-sm sm:flex-none">
            <span className="font-medium text-zinc-800">Agente</span>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className={inputClass}
            >
              <option value="">Todos</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          {loading && <Spinner className="mb-2 size-4" />}
        </div>

        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}

        {usage && usage.rows.length === 0 && !error && (
          <p className="mt-4 text-sm text-zinc-500">Nenhum consumo no período.</p>
        )}

        {usage && usage.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-md text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Dia</th>
                  <th className="py-2 pr-4 font-medium">Agente</th>
                  <th className="py-2 pr-4 text-right font-medium">Respostas</th>
                  <th className="py-2 text-right font-medium">Créditos</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map((row) => (
                  <tr
                    key={`${row.day}:${row.agentId ?? '-'}`}
                    className="border-b border-zinc-100 last:border-0"
                  >
                    <td className="py-2 pr-4 text-zinc-700">{formatDay(row.day)}</td>
                    <td className="py-2 pr-4 text-zinc-900">{row.agentName ?? 'Sem agente'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-700">
                      {credits(row.responses)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-900">
                      {credits(row.credits)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 font-medium text-zinc-900">
                  <td className="py-2 pr-4" colSpan={2}>
                    Total
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {credits(usage.totals.responses)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{credits(usage.totals.credits)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

const ENTRY_LABELS: Record<CreditEntryView['type'], { label: string; tone: Tone }> = {
  GRANT: { label: 'Crédito concedido', tone: 'green' },
  TOPUP: { label: 'Créditos adicionais', tone: 'green' },
  ADJUSTMENT: { label: 'Ajuste', tone: 'zinc' },
  EXPIRE: { label: 'Expiração', tone: 'zinc' },
  REFUND: { label: 'Estorno', tone: 'amber' },
};

const WALLET_LABELS: Record<CreditEntryView['wallet'], string> = {
  TRIAL: 'teste grátis',
  PLAN: 'plano',
  EXTRA: 'adicional',
};

/** Movimentações do ledger, menos os débitos por resposta (que estão no consumo por dia). */
export function EntriesSection() {
  const { api } = useAppSession();
  const [entries, setEntries] = useState<CreditEntryView[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    (before?: string) =>
      api<CreditEntriesView>(
        `/app/credits/entries${before ? `?${new URLSearchParams({ before })}` : ''}`,
      ),
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPage()
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setNextBefore(page.nextBefore);
      })
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar as movimentações.')),
      );
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBefore);
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível carregar as movimentações.'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section>
      <SectionTitle
        title="Movimentações"
        description="Créditos recebidos, expirações e ajustes. O consumo das respostas está acima."
      />
      <Card>
        {error && (
          <Alert tone="error" className="m-4">
            {error}
          </Alert>
        )}
        {!entries && !error && <Loading />}
        {entries && entries.length === 0 && (
          <p className="p-4 text-sm text-zinc-500">Nenhuma movimentação ainda.</p>
        )}
        {entries && entries.length > 0 && (
          <ul className="divide-y divide-zinc-100">
            {entries.map((entry) => {
              const meta = ENTRY_LABELS[entry.type];
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="text-xs text-zinc-500">
                        {WALLET_LABELS[entry.wallet]} · {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                    {entry.reason && (
                      <p className="mt-1 truncate text-xs text-zinc-500">{entry.reason}</p>
                    )}
                  </div>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      entry.amount > 0 ? 'text-emerald-700' : 'text-zinc-700'
                    }`}
                  >
                    {entry.amount > 0 ? '+' : '−'}
                    {credits(Math.abs(entry.amount))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {nextBefore && (
          <div className="border-t border-zinc-100 p-3 text-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className={buttonClass('ghost', 'sm')}
            >
              {loadingMore && <Spinner className="size-4" />}
              Carregar mais
            </button>
          </div>
        )}
      </Card>
    </section>
  );
}
