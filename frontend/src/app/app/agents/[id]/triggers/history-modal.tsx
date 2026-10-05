'use client';

import type { TriggerExecutionView, TriggerView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import {
  ACTION_TYPES,
  AGENT_EVENTS,
  executionStatus,
  formatDateTime,
  resultSummary,
} from '@/lib/triggers';
import { useAppSession } from '../../../session-provider';

/** Histórico de execuções de um gatilho, mais recentes primeiro. */
export function HistoryModal({
  agentId,
  trigger,
  onClose,
}: {
  agentId: string;
  trigger: TriggerView;
  onClose: () => void;
}) {
  const { api } = useAppSession();
  const [executions, setExecutions] = useState<TriggerExecutionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchExecutions = useCallback(
    async () =>
      (
        await api<{ executions: TriggerExecutionView[] }>(
          `/app/agents/${agentId}/triggers/${trigger.id}/executions?limit=100`,
        )
      ).executions,
    [api, agentId, trigger.id],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      setExecutions(await fetchExecutions());
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível carregar o histórico.'));
    }
  }, [fetchExecutions]);

  useEffect(() => {
    let cancelled = false;
    fetchExecutions()
      .then((rows) => !cancelled && setExecutions(rows))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar o histórico.')),
      );
    return () => {
      cancelled = true;
    };
  }, [fetchExecutions]);

  return (
    <Modal
      title={`Histórico · ${trigger.name}`}
      description="Últimas 100 ações executadas por este gatilho."
      onRequestClose={onClose}
      footer={
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => void load()} className={buttonClass('secondary')}>
            Atualizar
          </button>
          <button type="button" onClick={onClose} className={buttonClass('primary')}>
            Fechar
          </button>
        </div>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {executions === null ? (
        !error && <Loading />
      ) : executions.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          Nenhuma execução ainda. O gatilho roda quando o evento “
          {AGENT_EVENTS[trigger.event].label}” acontecer.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {executions.map((execution) => {
            const status = executionStatus(execution.status);
            const summary = resultSummary(execution);
            return (
              <li key={execution.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900">
                    {ACTION_TYPES[execution.actionType].label}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="ml-auto text-xs text-zinc-500">
                    {formatDateTime(execution.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {[
                    AGENT_EVENTS[execution.event].label,
                    execution.dialogId && `diálogo ${execution.dialogId}`,
                    `${execution.attempts} ${execution.attempts === 1 ? 'tentativa' : 'tentativas'}`,
                    summary,
                    execution.nextAttemptAt &&
                      `próxima tentativa ${formatDateTime(execution.nextAttemptAt)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {execution.error && (
                  <p className="mt-1 text-xs break-words text-amber-800">{execution.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
