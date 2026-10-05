'use client';

import type { IntentionView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { BoltIcon, GlobeIcon, PlusIcon } from '@/components/icons';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { ACTION_TYPES } from '@/lib/triggers';
import { useAppSession } from '../../../session-provider';
import { useAgent } from '../agent-context';
import { ExecutionsModal } from './executions-modal';
import { formOf, IntentionEditor } from './intention-editor';

/** Aba Intenções: APIs que o agente chama durante a conversa (spec agent-intentions). */
export default function AgentIntentionsPage() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const [intentions, setIntentions] = useState<IntentionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<IntentionView | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [history, setHistory] = useState<IntentionView | null>(null);

  const canManage = session.canManage && agent.status !== 'OUT_OF_SYNC';
  const base = `/app/agents/${agent.id}/intentions`;

  const reload = useCallback(async () => {
    try {
      setIntentions(await api<IntentionView[]>(base));
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível carregar as intenções.'));
    }
  }, [api, base]);

  useEffect(() => {
    let cancelled = false;
    api<IntentionView[]>(base)
      .then((data) => !cancelled && setIntentions(data))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar as intenções.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api, base]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível concluir. Tente de novo.'));
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  const add = canManage && (
    <button type="button" onClick={() => setEditing('new')} className={buttonClass('primary')}>
      <PlusIcon className="size-4" />
      Nova intenção
    </button>
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Intenções</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Deixe o agente agir durante a conversa: registrar lead, negócio ou tarefa no Bitrix24,
            ou consultar seus sistemas (status de pedido, segunda via, agendamento).
          </p>
        </div>
        {add}
      </div>

      {error && (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      )}

      {intentions === null ? (
        !error && <Loading />
      ) : (
        <Card>
          {intentions.length === 0 ? (
            <EmptyState
              icon={<GlobeIcon className="size-6" />}
              title="Nenhuma intenção ainda"
              description="Exemplo: quando o cliente perguntar pelo pedido, o agente pede o número, consulta a sua API e responde com o status e a previsão de entrega."
              action={add}
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {intentions.map((intention) => {
                const busy = busyId === intention.id;
                return (
                  <li key={intention.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                      {intention.kind === 'BITRIX' ? (
                        <BoltIcon className="size-5" />
                      ) : (
                        <GlobeIcon className="size-5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-zinc-900">
                          {intention.name}
                        </p>
                        <Badge tone={intention.active ? 'green' : 'zinc'}>
                          {intention.active ? 'Ativa' : 'Desativada'}
                        </Badge>
                        {!intention.synced && <Badge tone="amber">Sincronizando</Badge>}
                      </div>
                      {intention.kind === 'BITRIX' ? (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          <span className="font-medium">Bitrix24:</span>{' '}
                          {intention.actions
                            .map((action) => ACTION_TYPES[action.type].label)
                            .join(', ')}
                        </p>
                      ) : (
                        <p className="mt-0.5 truncate text-xs text-zinc-500" title={intention.url}>
                          <span className="font-medium">{intention.httpMethod}</span>{' '}
                          {intention.url}
                        </p>
                      )}
                      {intention.fields.length > 0 && (
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Coleta: {intention.fields.map((field) => field.name).join(', ')}
                        </p>
                      )}
                    </div>

                    {confirmingId === intention.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-600">Remover?</span>
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
                          onClick={() =>
                            run(intention.id, () =>
                              api(`${base}/${intention.id}`, { method: 'DELETE' }),
                            )
                          }
                          disabled={busy}
                          className={buttonClass('danger', 'sm')}
                        >
                          {busy ? 'Removendo…' : 'Remover'}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        {intention.kind === 'BITRIX' && (
                          <button
                            type="button"
                            onClick={() => setHistory(intention)}
                            className={buttonClass('ghost', 'sm')}
                          >
                            Histórico
                          </button>
                        )}
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                run(intention.id, () =>
                                  api(`${base}/${intention.id}`, {
                                    method: 'PUT',
                                    body: JSON.stringify({
                                      ...formOf(intention),
                                      active: !intention.active,
                                    }),
                                  }),
                                )
                              }
                              disabled={busyId !== null}
                              className={buttonClass('secondary', 'sm')}
                            >
                              {busy ? 'Salvando…' : intention.active ? 'Desativar' : 'Ativar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(intention)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost', 'sm')}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(intention.id)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost-danger', 'sm')}
                            >
                              Remover
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {editing && (
        <IntentionEditor
          agentId={agent.id}
          intention={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
      {history && (
        <ExecutionsModal agentId={agent.id} intention={history} onClose={() => setHistory(null)} />
      )}
    </>
  );
}
