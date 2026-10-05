'use client';

import type { TriggerView, TriggerWriteResult } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { BoltIcon, PlusIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { ACTION_TYPES, AGENT_EVENTS } from '@/lib/triggers';
import { useAppSession } from '../../../session-provider';
import { useAgent } from '../agent-context';
import { HistoryModal } from './history-modal';
import { TriggerEditor } from './trigger-editor';

/** Aba Gatilhos: o que acontece no Bitrix24 quando o agente atende. */
export default function AgentTriggersPage() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const [triggers, setTriggers] = useState<TriggerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TriggerView | 'new' | null>(null);
  const [history, setHistory] = useState<TriggerView | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const canManage = session.canManage && agent.status !== 'OUT_OF_SYNC';
  const base = `/app/agents/${agent.id}/triggers`;

  const reload = useCallback(async () => {
    try {
      setTriggers((await api<{ triggers: TriggerView[] }>(base)).triggers);
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível carregar os gatilhos.'));
    }
  }, [api, base]);

  useEffect(() => {
    let cancelled = false;
    api<{ triggers: TriggerView[] }>(base)
      .then((data) => !cancelled && setTriggers(data.triggers))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar os gatilhos.')),
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

  function saved(result: TriggerWriteResult) {
    setEditing(null);
    if (Object.keys(result.newSecrets).length) setSecrets(result.newSecrets);
    void reload();
  }

  const add = canManage && (
    <button type="button" onClick={() => setEditing('new')} className={buttonClass('primary')}>
      <PlusIcon className="size-4" />
      Novo gatilho
    </button>
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Gatilhos</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Ações automáticas no Bitrix24 quando algo acontece no atendimento do agente: criar lead,
            mover negócio, registrar comentário, abrir tarefa.
          </p>
        </div>
        {add}
      </div>

      {error && (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      )}

      {triggers === null ? (
        !error && <Loading />
      ) : (
        <Card>
          {triggers.length === 0 ? (
            <EmptyState
              icon={<BoltIcon className="size-6" />}
              title="Nenhum gatilho ainda"
              description="Exemplo: ao fim de cada atendimento, criar um lead com o nome do cliente e um comentário com o resumo."
              action={add}
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {triggers.map((trigger) => {
                const busy = busyId === trigger.id;
                return (
                  <li key={trigger.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                      <BoltIcon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-zinc-900">{trigger.name}</p>
                        <Badge tone={trigger.active ? 'green' : 'zinc'}>
                          {trigger.active ? 'Ativo' : 'Desativado'}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {AGENT_EVENTS[trigger.event].label} →{' '}
                        {trigger.actions
                          .map((action) => ACTION_TYPES[action.type].label)
                          .join(', ')}
                      </p>
                    </div>

                    {confirmingId === trigger.id ? (
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
                            run(trigger.id, () =>
                              api(`${base}/${trigger.id}`, { method: 'DELETE' }),
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
                        <button
                          type="button"
                          onClick={() => setHistory(trigger)}
                          className={buttonClass('ghost', 'sm')}
                        >
                          Histórico
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                run(trigger.id, () =>
                                  api(`${base}/${trigger.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ active: !trigger.active }),
                                  }),
                                )
                              }
                              disabled={busyId !== null}
                              className={buttonClass('secondary', 'sm')}
                            >
                              {busy ? 'Salvando…' : trigger.active ? 'Desativar' : 'Ativar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(trigger)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost', 'sm')}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(trigger.id)}
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
        <TriggerEditor
          agentId={agent.id}
          trigger={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {history && (
        <HistoryModal agentId={agent.id} trigger={history} onClose={() => setHistory(null)} />
      )}
      {secrets && <SecretsModal secrets={secrets} onClose={() => setSecrets(null)} />}
    </>
  );
}

/** Segredo do webhook de saída: aparece uma vez só, logo depois de salvar. */
function SecretsModal({
  secrets,
  onClose,
}: {
  secrets: Record<string, string>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <Modal
      title="Segredo do webhook de saída"
      description="Guarde agora: ele não aparece de novo."
      onRequestClose={onClose}
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass('primary')}>
            Já guardei
          </button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-zinc-600">
        Use o segredo no sistema que recebe as chamadas para conferir a assinatura do cabeçalho{' '}
        <code className="rounded bg-zinc-100 px-1 text-xs">X-GPTMaker-Signature</code>:{' '}
        <code className="rounded bg-zinc-100 px-1 text-xs">t=&lt;unix&gt;,v1=&lt;hex&gt;</code>,
        onde <code className="text-xs">v1</code> é o HMAC-SHA256 de{' '}
        <code className="text-xs">&quot;t.corpo&quot;</code>.
      </p>
      {Object.entries(secrets).map(([id, secret]) => (
        <div key={id} className="mb-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs">
            {secret}
          </code>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            onClick={async () => {
              await navigator.clipboard.writeText(secret);
              setCopied(id);
            }}
          >
            {copied === id ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      ))}
    </Modal>
  );
}
