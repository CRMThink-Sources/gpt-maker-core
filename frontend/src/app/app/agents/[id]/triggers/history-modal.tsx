'use client';

import type { TriggerExecutionView, TriggerView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Loading } from '@/components/ui';
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { actionType, agentEvent, apiFailure, executionStatus, resultSummary } from '@/lib/triggers';
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
  const t = useT('triggers');
  const format = useFormat();
  const errorMessage = useErrorMessage('triggers');
  const formatDateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
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
      setError(apiFailure(e, errorMessage, t('history.loadFailed')));
    }
  }, [fetchExecutions, t, errorMessage]);

  useEffect(() => {
    let cancelled = false;
    fetchExecutions()
      .then((rows) => !cancelled && setExecutions(rows))
      .catch(
        (e: unknown) =>
          !cancelled && setError(apiFailure(e, errorMessage, t('history.loadFailed'))),
      );
    return () => {
      cancelled = true;
    };
  }, [fetchExecutions, t, errorMessage]);

  return (
    <Modal
      title={t('history.title', { name: trigger.name })}
      description={t('history.description')}
      onRequestClose={onClose}
      footer={
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => void load()} className={buttonClass('secondary')}>
            {t('history.refresh')}
          </button>
          <button type="button" onClick={onClose} className={buttonClass('primary')}>
            {t('history.close')}
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
          {t('history.empty', { event: agentEvent(t, trigger.event).label })}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {executions.map((execution) => {
            const status = executionStatus(t, execution.status);
            const summary = resultSummary(t, execution);
            return (
              <li key={execution.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900">
                    {actionType(t, execution.actionType).label}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="ml-auto text-xs text-zinc-500">
                    {formatDateTime(execution.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {[
                    agentEvent(t, execution.event).label,
                    execution.dialogId && t('history.dialog', { id: execution.dialogId }),
                    t('history.attempts', { count: execution.attempts }),
                    summary,
                    execution.nextAttemptAt &&
                      t('history.nextAttempt', { date: formatDateTime(execution.nextAttemptAt) }),
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
