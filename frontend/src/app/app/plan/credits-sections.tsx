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
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { inputClass } from '../agents/agent-fields';
import { useAppSession } from '../session-provider';

const DAY_MS = 86_400_000;

type Format = ReturnType<typeof useFormat>;

/** Número com separador de milhar no idioma ativo. */
function credits(format: Format, value: number): string {
  return format.number(value);
}

/** AAAA-MM-DD do instante no fuso do extrato. */
function isoDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CREDITS_TIMEZONE }).format(date);
}

function formatDate(format: Format, iso: string): string {
  return format.dateTime(new Date(iso), { timeZone: CREDITS_TIMEZONE, dateStyle: 'short' });
}

function formatDateTime(format: Format, iso: string): string {
  return format.dateTime(new Date(iso), {
    timeZone: CREDITS_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** `2026-10-03` ⇒ `03/10/2026` (pt-BR), sem passar por fuso (já é o dia do extrato). */
function formatDay(format: Format, day: string): string {
  return format.dateTime(new Date(`${day}T12:00:00Z`), { timeZone: 'UTC', dateStyle: 'short' });
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
  const format = useFormat();
  return (
    <Card className={`p-4 ${highlight ? 'border-brand-200 bg-brand-50/40' : ''}`}>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
        {credits(format, value)}
      </p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
}

/** Saldos por carteira, validade e consumo do ciclo (spec credit-billing, "Consulta de saldo"). */
export function BalanceSection({ summary }: { summary: CreditSummaryView }) {
  const t = useT('plan');
  const format = useFormat();
  const showTrial = summary.trial.balance > 0 || summary.trial.endsAt !== null;
  const facts: string[] = [];
  if (summary.expiresAt) {
    facts.push(t('balance.validUntil', { date: formatDate(format, summary.expiresAt) }));
  }
  if (summary.renewsAt) {
    facts.push(t('balance.renewsAt', { date: formatDate(format, summary.renewsAt) }));
  }
  if (summary.cancelAt) {
    facts.push(t('balance.cancelsAt', { date: formatDate(format, summary.cancelAt) }));
  }
  if (summary.cycleStart) {
    facts.push(
      t('balance.consumed', {
        count: summary.consumedInCycle,
        date: formatDate(format, summary.cycleStart),
      }),
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-zinc-900">{t('balance.title')}</h2>
        {summary.subscription && (
          <Badge tone={summary.subscription.status === 'past_due' ? 'amber' : 'zinc'}>
            {t(`balance.status.${summary.subscription.status}`)}
          </Badge>
        )}
      </div>
      <div
        className={`grid gap-3 sm:grid-cols-2 ${showTrial ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}
      >
        <BalanceCard label={t('balance.total')} value={summary.total} highlight />
        {showTrial && (
          <BalanceCard
            label={t('balance.trial')}
            value={summary.trial.balance}
            hint={
              summary.trial.endsAt
                ? t('balance.until', { date: formatDate(format, summary.trial.endsAt) })
                : undefined
            }
          />
        )}
        <BalanceCard label={t('balance.plan')} value={summary.plan.balance} />
        <BalanceCard label={t('balance.extra')} value={summary.extra.balance} />
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
          {t('balance.noCredits')}
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
  const t = useT('plan');
  const format = useFormat();
  const errorText = useErrorMessage('plan');
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
          setResult({ query, error: errorMessage(e, t('usage.loadFailed'), errorText) }),
      );
    return () => {
      cancelled = true;
    };
    // Trocar o idioma não deve refazer a consulta; só o texto de erro usa `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, query]);

  return (
    <section>
      <SectionTitle
        title={t('usage.title')}
        description={t('usage.description', { days: USAGE_MAX_DAYS })}
      />
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="font-medium text-zinc-800">{t('usage.from')}</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-zinc-800">{t('usage.to')}</span>
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
            <span className="font-medium text-zinc-800">{t('usage.agent')}</span>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('usage.allAgents')}</option>
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
          <p className="mt-4 text-sm text-zinc-500">{t('usage.empty')}</p>
        )}

        {usage && usage.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-md text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-4 font-medium">{t('usage.day')}</th>
                  <th className="py-2 pr-4 font-medium">{t('usage.agent')}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t('usage.responses')}</th>
                  <th className="py-2 text-right font-medium">{t('usage.credits')}</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map((row) => (
                  <tr
                    key={`${row.day}:${row.agentId ?? '-'}:${row.kind}`}
                    className="border-b border-zinc-100 last:border-0"
                  >
                    <td className="py-2 pr-4 text-zinc-700">{formatDay(format, row.day)}</td>
                    <td className="py-2 pr-4 text-zinc-900">
                      {row.agentName ?? t('usage.noAgent')}
                      {row.kind === 'FUNCTION_REVIEW' && (
                        <span className="ml-2 text-xs text-zinc-500">
                          {t('usage.functionReview')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-700">
                      {row.kind === 'FUNCTION_REVIEW'
                        ? t('usage.fields', { count: row.responses })
                        : credits(format, row.responses)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-900">
                      {credits(format, row.credits)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 font-medium text-zinc-900">
                  <td className="py-2 pr-4" colSpan={2}>
                    {t('usage.total')}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {credits(format, usage.totals.responses)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {credits(format, usage.totals.credits)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

const ENTRY_TONES: Record<CreditEntryView['type'], Tone> = {
  GRANT: 'green',
  TOPUP: 'green',
  ADJUSTMENT: 'zinc',
  EXPIRE: 'zinc',
  REFUND: 'amber',
};

/** Movimentações do ledger, menos os débitos por resposta (que estão no consumo por dia). */
export function EntriesSection() {
  const { api } = useAppSession();
  const t = useT('plan');
  const format = useFormat();
  const errorText = useErrorMessage('plan');
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
        (e: unknown) => !cancelled && setError(errorMessage(e, t('entries.loadFailed'), errorText)),
      );
    return () => {
      cancelled = true;
    };
    // Trocar o idioma não deve refazer a consulta; só o texto de erro usa `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBefore);
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch (e) {
      setError(errorMessage(e, t('entries.loadFailed'), errorText));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section>
      <SectionTitle title={t('entries.title')} description={t('entries.description')} />
      <Card>
        {error && (
          <Alert tone="error" className="m-4">
            {error}
          </Alert>
        )}
        {!entries && !error && <Loading />}
        {entries && entries.length === 0 && (
          <p className="p-4 text-sm text-zinc-500">{t('entries.empty')}</p>
        )}
        {entries && entries.length > 0 && (
          <ul className="divide-y divide-zinc-100">
            {entries.map((entry) => {
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ENTRY_TONES[entry.type]}>
                        {t(`entries.types.${entry.type}`)}
                      </Badge>
                      <span className="text-xs text-zinc-500">
                        {t(`entries.wallets.${entry.wallet}`)} ·{' '}
                        {formatDateTime(format, entry.createdAt)}
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
                    {credits(format, Math.abs(entry.amount))}
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
              {t('entries.loadMore')}
            </button>
          </div>
        )}
      </Card>
    </section>
  );
}
