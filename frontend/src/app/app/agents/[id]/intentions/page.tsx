'use client';

import type { IntentionView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { BoltIcon, GlobeIcon, PlusIcon } from '@/components/icons';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading } from '@/components/ui';
import { useErrorMessage, useT } from '@/i18n';
import { actionType, apiFailure } from '@/lib/triggers';
import { useAppSession } from '../../../session-provider';
import { useAgent } from '../agent-context';
import { ExecutionsModal } from './executions-modal';
import { formOf, IntentionEditor } from './intention-editor';

/** Aba Intenções: APIs que o agente chama durante a conversa (spec agent-intentions). */
export default function AgentIntentionsPage() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const t = useT('intentions');
  const tt = useT('triggers');
  const errorMessage = useErrorMessage('intentions');
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
      setError(apiFailure(e, errorMessage, t('page.loadFailed')));
    }
  }, [api, base, t, errorMessage]);

  useEffect(() => {
    let cancelled = false;
    api<IntentionView[]>(base)
      .then((data) => !cancelled && setIntentions(data))
      .catch(
        (e: unknown) => !cancelled && setError(apiFailure(e, errorMessage, t('page.loadFailed'))),
      );
    return () => {
      cancelled = true;
    };
  }, [api, base, t, errorMessage]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError(apiFailure(e, errorMessage, t('page.actionFailed')));
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  const add = canManage && (
    <button type="button" onClick={() => setEditing('new')} className={buttonClass('primary')}>
      <PlusIcon className="size-4" />
      {t('page.new')}
    </button>
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">{t('page.title')}</h2>
          <p className="mt-0.5 text-sm text-zinc-500">{t('page.description')}</p>
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
              title={t('page.emptyTitle')}
              description={t('page.emptyDescription')}
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
                          {intention.active ? t('page.active') : t('page.inactive')}
                        </Badge>
                        {intention.managed && <Badge tone="brand">{t('page.fromFunction')}</Badge>}
                        {!intention.synced && <Badge tone="amber">{t('page.syncing')}</Badge>}
                      </div>
                      {intention.kind === 'BITRIX' ? (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          <span className="font-medium">Bitrix24:</span>{' '}
                          {intention.actions
                            .map((action) => actionType(tt, action.type).label)
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
                          {t('page.collects')}{' '}
                          {intention.fields.map((field) => field.name).join(', ')}
                        </p>
                      )}
                    </div>

                    {confirmingId === intention.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-600">{t('page.confirmRemove')}</span>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={busy}
                          className={buttonClass('secondary', 'sm')}
                        >
                          {t('page.cancel')}
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
                          {busy ? t('page.removing') : t('page.remove')}
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
                            {t('page.history')}
                          </button>
                        )}
                        {canManage && !intention.managed && (
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
                              {busy
                                ? t('page.saving')
                                : intention.active
                                  ? t('page.deactivate')
                                  : t('page.activate')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(intention)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost', 'sm')}
                            >
                              {t('page.edit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(intention.id)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost-danger', 'sm')}
                            >
                              {t('page.remove')}
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
