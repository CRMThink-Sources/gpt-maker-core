'use client';

import type { AgentView } from '@gptmaker/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { agentStatus, credits, errorMessage, inactiveBySystem } from '@/lib/agents';
import { StatusBadge } from './agents/status-badge';
import { useAppSession } from './session-provider';

/** Lista de agentes do tenant com as ações de inativar, reativar e remover. */
export default function ClientAppHome() {
  const { session, api } = useAppSession();
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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

  return (
    <section className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Agentes de IA</h1>
        {session.canManage && (
          <Link
            href="/app/agents/new"
            className="rounded bg-violet-700 px-3 py-2 text-sm text-white"
          >
            Novo agente
          </Link>
        )}
      </div>

      {!session.canManage && (
        <p className="mt-2 text-sm text-zinc-600">
          Você pode consultar os agentes. Para alterá-los, peça acesso a um administrador do portal.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}

      {agents === null ? (
        !error && <p className="mt-6 text-sm text-zinc-500">Carregando…</p>
      ) : agents.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-zinc-300 p-6 text-sm text-zinc-600">
          Nenhum agente criado ainda.
          {session.canManage && ' Crie o primeiro para começar a atender pelos canais abertos.'}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-zinc-200 rounded border border-zinc-200">
          {agents.map((agent) => {
            const busy = busyId === agent.id;
            const status = agentStatus(agent);
            return (
              <li key={agent.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/agents/${agent.id}`}
                      className="truncate font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                    >
                      {agent.name}
                    </Link>
                    <StatusBadge {...status} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {agent.model.displayName} · {credits(agent.model.creditsPerResponse)}
                  </p>
                  {agent.status === 'OUT_OF_SYNC' && (
                    <p className="mt-1 text-xs text-amber-800">
                      O agente não foi encontrado no GPTMaker. Fale com o suporte.
                    </p>
                  )}
                </div>

                {session.canManage &&
                  (confirmingId === agent.id ? (
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-700">Remover “{agent.name}”?</span>
                      <button
                        type="button"
                        onClick={() => remove(agent)}
                        disabled={busy}
                        className="rounded bg-red-700 px-2 py-1 text-white disabled:opacity-50"
                      >
                        {busy ? 'Removendo…' : 'Remover'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={busy}
                        className="text-zinc-600 underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Link href={`/app/agents/${agent.id}`} className="text-violet-700 underline">
                        Editar
                      </Link>
                      {agent.status !== 'OUT_OF_SYNC' && !inactiveBySystem(agent) && (
                        <button
                          type="button"
                          onClick={() => toggle(agent)}
                          disabled={busyId !== null}
                          className="text-violet-700 underline disabled:opacity-50"
                        >
                          {busy ? 'Aguarde…' : agent.status === 'ACTIVE' ? 'Inativar' : 'Reativar'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmingId(agent.id)}
                        disabled={busyId !== null}
                        className="text-red-700 underline disabled:opacity-50"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {session.user.isAdmin && (
        <Link
          href="/app/permissions"
          className="mt-6 inline-block text-sm text-violet-700 underline"
        >
          Quem pode gerenciar os agentes
        </Link>
      )}
    </section>
  );
}
