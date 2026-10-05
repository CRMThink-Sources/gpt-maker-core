'use client';

import type { IntentionExecutionView, IntentionView } from '@gptmaker/contracts';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { ACTION_TYPES, formatDateTime } from '@/lib/triggers';
import { useAppSession } from '../../../session-provider';

const STATUS: Record<
  IntentionExecutionView['status'],
  { label: string; tone: 'green' | 'amber' | 'zinc' }
> = {
  SUCCESS: { label: 'Concluída', tone: 'green' },
  FAILED: { label: 'Com falha', tone: 'amber' },
  REJECTED: { label: 'Recusada', tone: 'zinc' },
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
  const [items, setItems] = useState<IntentionExecutionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<IntentionExecutionView[]>(`/app/agents/${agentId}/intentions/${intention.id}/executions`)
      .then((data) => !cancelled && setItems(data))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar o histórico.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api, agentId, intention.id]);

  return (
    <Modal
      title={`Histórico: ${intention.name}`}
      description="Últimas vezes que o agente usou esta intenção."
      onRequestClose={onClose}
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass('secondary')}>
            Fechar
          </button>
        </div>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {!items && !error && <Loading />}
      {items && items.length === 0 && (
        <p className="text-sm text-zinc-500">O agente ainda não usou esta intenção.</p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {items.map((item) => (
            <li key={item.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-zinc-500">
                  {formatDateTime(item.createdAt)}
                </span>
                <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                {item.dialogId && (
                  <span className="text-xs text-zinc-500">diálogo {item.dialogId}</span>
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
                    {ACTION_TYPES[result.type as keyof typeof ACTION_TYPES]?.label ?? result.type}
                    {': '}
                    {result.ok
                      ? Object.entries(result.result ?? {})
                          .map(([key, value]) => `${key} ${String(value)}`)
                          .join(', ') || 'ok'
                      : result.error}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-zinc-500">Ao agente: {item.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
