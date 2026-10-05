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
import { AGENT_TYPES, agentStatus, credits, errorMessage, inactiveBySystem } from '@/lib/agents';
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
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar os agentes.')),
      );
    return () => {
      cancelled = true;
    };
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
      setError(errorMessage(e, 'Não foi possível concluir. Tente de novo.'));
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
      Novo agente
    </button>
  );

  const active = agents?.filter((agent) => agent.status === 'ACTIVE').length ?? 0;

  return (
    <>
      <PageHeader
        title="Agentes"
        description="Agentes de IA que atendem seus clientes nos canais abertos do Bitrix24."
        actions={newAgent}
      />

      {trialAvailable && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <SparkIcon className="mt-0.5 size-5 shrink-0 text-brand-600" />
            <p className="text-sm text-zinc-700">
              <span className="font-medium text-zinc-900">Teste grátis por 14 dias.</span> Ganhe 500
              créditos para seus agentes começarem a atender.
            </p>
          </div>
          <Link href="/app/plan" className={buttonClass('secondary', 'sm')}>
            Ativar teste
          </Link>
        </Card>
      )}

      {!session.canManage && (
        <Alert tone="warning" className="mb-6">
          Você pode consultar os agentes. Para alterá-los, peça acesso a um administrador do portal.
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
              <Stat label="Agentes" value={agents.length} />
              <Stat label="Ativos" value={active} hint="respondendo agora" />
              <Stat label="Inativos" value={agents.length - active} />
            </div>
          )}

          <Card>
            {agents.length === 0 ? (
              <EmptyState
                icon={<BotIcon className="size-6" />}
                title="Nenhum agente ainda"
                description={
                  session.canManage
                    ? 'Crie o primeiro agente para começar a atender pelos canais abertos.'
                    : 'Quando um agente for criado, ele aparece aqui.'
                }
                action={newAgent}
              />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {agents.map((agent) => {
                  const busy = busyId === agent.id;
                  const status = agentStatus(agent);
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
                          {AGENT_TYPES[agent.type]} · {agent.model.displayName} ·{' '}
                          {credits(agent.model.creditsPerResponse)}
                        </p>
                        {agent.status === 'OUT_OF_SYNC' && (
                          <p className="mt-1 text-xs text-amber-800">
                            O agente não foi encontrado no GPTMaker. Fale com o suporte.
                          </p>
                        )}
                      </div>

                      {session.canManage &&
                        (confirmingId === agent.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-600">Remover este agente?</span>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              disabled={busy}
                              className={buttonClass('secondary', 'sm')}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(agent)}
                              disabled={busy}
                              className={buttonClass('danger', 'sm')}
                            >
                              {busy ? 'Removendo…' : 'Remover'}
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
                                  ? 'Aguarde…'
                                  : agent.status === 'ACTIVE'
                                    ? 'Inativar'
                                    : 'Reativar'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setConfirmingId(agent.id)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost-danger', 'sm')}
                            >
                              Remover
                            </button>
                            <Link
                              href={`/app/agents/${agent.id}`}
                              className={buttonClass('secondary', 'sm')}
                            >
                              Editar
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
          onCreated={(agent) => router.push(`/app/agents/${agent.id}?created=1`)}
        />
      )}
    </>
  );
}
