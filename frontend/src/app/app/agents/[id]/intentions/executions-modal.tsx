'use client';

import type { IntentionExecutionView, IntentionView } from '@gptmaker/contracts';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Loading } from '@/components/ui';
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { actionType, apiFailure } from '@/lib/triggers';
import { useAppSession } from '../../../session-provider';

const STATUS_TONE: Record<IntentionExecutionView['status'], 'green' | 'amber' | 'zinc'> = {
  SUCCESS: 'green',
  FAILED: 'amber',
  REJECTED: 'zinc',
};

/** Últimas vezes que o agente usou uma intenção com ações no Bitrix. */
export function ExecutionsModal({
  agentId,
  intention,
  onClose,
}: {
  agentId: string;
  intention: IntentionView;
  onClose: () => void;
}) {
  const { api } = useAppSession();
  const t = useT('intentions');
  const tt = useT('triggers');
  const format = useFormat();
  const errorMessage = useErrorMessage('intentions');
  const [items, setItems] = useState<IntentionExecutionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<IntentionExecutionView[]>(`/app/agents/${agentId}/intentions/${intention.id}/executions`)
      .then((data) => !cancelled && setItems(data))
      .catch(
        (e: unknown) =>
          !cancelled && setError(apiFailure(e, errorMessage, t('executions.loadFailed'))),
      );
    return () => {
      cancelled = true;
    };
  }, [api, agentId, intention.id, t, errorMessage]);

  return (
    <Modal
      title={t('executions.title', { name: intention.name })}
      description={t('executions.description')}
      onRequestClose={onClose}
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass('secondary')}>
            {t('executions.close')}
          </button>
        </div>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {!items && !error && <Loading />}
      {items && items.length === 0 && (
        <p className="text-sm text-zinc-500">{t('executions.empty')}</p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {items.map((item) => (
            <li key={item.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-zinc-500">
                  {format.dateTime(new Date(item.createdAt), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
                <Badge tone={STATUS_TONE[item.status]}>
                  {t(`executions.status.${item.status}`)}
                </Badge>
                {item.dialogId && (
                  <span className="text-xs text-zinc-500">
                    {t('executions.dialog', { id: item.dialogId })}
                  </span>
                )}
                <span className="ml-auto text-xs text-zinc-400">{item.durationMs} ms</span>
              </div>
              {Object.keys(item.fields).length > 0 && (
                <p className="mt-1 text-xs text-zinc-600">
                  {Object.entries(item.fields)
                    .map(([name, value]) => `${name}: ${value || '—'}`)
                    .join(' · ')}
                </p>
              )}
              <ul className="mt-1 space-y-0.5 text-xs">
                {item.results.map((result, index) => (
                  <li key={index} className={result.ok ? 'text-zinc-600' : 'text-amber-800'}>
                    {tt.has(`actions.${result.type}.label`)
                      ? actionType(tt, result.type as Parameters<typeof actionType>[1]).label
                      : result.type}
                    {': '}
                    {result.ok
                      ? Object.entries(result.result ?? {})
                          .map(([key, value]) => `${key} ${String(value)}`)
                          .join(', ') || t('executions.ok')
                      : result.error}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-zinc-500">
                {t('executions.toAgent', { message: item.message })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
