'use client';

import type { AgentView, TrialStatusView } from '@gptmaker/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BotIcon, PlusIcon, SparkIcon } from '@/components/icons';
import {
  Alert,
  Avatar,
  Badge,
  buttonClass,
  Card,
  EmptyState,
  Loading,
  PageHeader,
} from '@/components/ui';
import { agentStatus, agentTypeLabel, credits, errorMessage, inactiveBySystem } from '@/lib/agents';
import { useErrorMessage, useT } from '@/i18n';
import { CreateAgentWizard } from './agents/create-agent-wizard';
import { useAppSession } from './session-provider';

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
    </Card>
  );
}

/** Lista de agentes do tenant com as ações de inativar, reativar e remover. */
export default function AgentsPage() {
  const { session, api } = useAppSession();
  const t = useT('home');
  const tAgent = useT('agentDetail');
  const errorText = useErrorMessage('home');
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const router = useRouter();
  // `?novo=1` (link direto ou /app/agents/new) abre a criação.
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(searchParams.get('novo') === '1');

  const closeWizard = () => {
    setCreating(false);
    if (searchParams.get('novo')) router.replace('/app');
  };

  const fetchAgents = useCallback(
    async () => (await api<{ agents: AgentView[] }>('/app/agents')).agents,
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAgents()
      .then((list) => !cancelled && setAgents(list))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e, t('errors.load'), errorText)));
    return () => {
      cancelled = true;
    };
    // Trocar o idioma não deve refazer a consulta; só o texto de erro usa `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAgents]);

  // Oferta do teste grátis (spec payments-integration); falha aqui só esconde o aviso.
  const [trialAvailable, setTrialAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<TrialStatusView>('/app/trial')
      .then((s) => !cancelled && setTrialAvailable(s.state === 'available'))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      setAgents(await fetchAgents());
    } catch (e) {
      setError(errorMessage(e, t('errors.action'), errorText));
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  const toggle = (agent: AgentView) =>
    run(agent.id, () =>
      api(`/app/agents/${agent.id}/${agent.status === 'ACTIVE' ? 'inactivate' : 'activate'}`, {
        method: 'POST',
      }),
    );

  const remove = (agent: AgentView) =>
    run(agent.id, () => api(`/app/agents/${agent.id}`, { method: 'DELETE' }));

  const newAgent = session.canManage && (
    <button type="button" onClick={() => setCreating(true)} className={buttonClass('primary')}>
      <PlusIcon className="size-4" />
      {t('newAgent')}
    </button>
  );

  const active = agents?.filter((agent) => agent.status === 'ACTIVE').length ?? 0;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={newAgent} />

      {trialAvailable && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <SparkIcon className="mt-0.5 size-5 shrink-0 text-brand-600" />
            <p className="text-sm text-zinc-700">
              <span className="font-medium text-zinc-900">{t('trial.title')}</span>{' '}
              {t('trial.text')}
            </p>
          </div>
          <Link href="/app/plan" className={buttonClass('secondary', 'sm')}>
            {t('trial.action')}
          </Link>
        </Card>
      )}

      {!session.canManage && (
        <Alert tone="warning" className="mb-6">
          {t('readOnly')}
        </Alert>
      )}

      {error && (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      )}

      {agents === null ? (
        !error && <Loading />
      ) : (
        <>
          {agents.length > 0 && (
            <div className="mb-6 grid grid-cols-3 gap-4">
              <Stat label={t('stats.agents')} value={agents.length} />
              <Stat label={t('stats.active')} value={active} hint={t('stats.activeHint')} />
              <Stat label={t('stats.inactive')} value={agents.length - active} />
            </div>
          )}

          <Card>
            {agents.length === 0 ? (
              <EmptyState
                icon={<BotIcon className="size-6" />}
                title={t('empty.title')}
                description={
                  session.canManage ? t('empty.descriptionManage') : t('empty.descriptionReadOnly')
                }
                action={newAgent}
              />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {agents.map((agent) => {
                  const busy = busyId === agent.id;
                  const status = agentStatus(agent, tAgent);
                  return (
                    <li
                      key={agent.id}
                      className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-zinc-50/60"
                    >
                      <Avatar name={agent.name} src={agent.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/app/agents/${agent.id}`}
                            className="truncate text-sm font-semibold text-zinc-900 hover:text-brand-700"
                          >
                            {agent.name}
                          </Link>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {agentTypeLabel(agent.type, tAgent)} · {agent.model.displayName} ·{' '}
                          {credits(agent.model.creditsPerResponse, tAgent)}
                        </p>
                        {agent.status === 'OUT_OF_SYNC' && (
                          <p className="mt-1 text-xs text-amber-800">{t('outOfSync')}</p>
                        )}
                      </div>

                      {session.canManage &&
                        (confirmingId === agent.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-600">{t('removeConfirm')}</span>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              disabled={busy}
                              className={buttonClass('secondary', 'sm')}
                            >
                              {t('cancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(agent)}
                              disabled={busy}
                              className={buttonClass('danger', 'sm')}
                            >
                              {busy ? t('removing') : t('remove')}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            {agent.status !== 'OUT_OF_SYNC' && !inactiveBySystem(agent) && (
                              <button
                                type="button"
                                onClick={() => toggle(agent)}
                                disabled={busyId !== null}
                                className={buttonClass('ghost', 'sm')}
                              >
                                {busy
                                  ? t('wait')
                                  : agent.status === 'ACTIVE'
                                    ? t('deactivate')
                                    : t('reactivate')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setConfirmingId(agent.id)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost-danger', 'sm')}
                            >
                              {t('remove')}
                            </button>
                            <Link
                              href={`/app/agents/${agent.id}`}
                              className={buttonClass('secondary', 'sm')}
                            >
                              {t('edit')}
                            </Link>
                          </div>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      {creating && session.canManage && (
        <CreateAgentWizard
          onClose={closeWizard}
          onCreated={(agent) => router.push(`/app/agents/${agent.id}/function?created=1`)}
        />
      )}
    </>
  );
}
