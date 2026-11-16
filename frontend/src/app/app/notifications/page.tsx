'use client';

import type { NotificationRecipientsView, NotificationTestView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { BellIcon, PlusIcon } from '@/components/icons';
import { useErrorMessage, useT } from '@/i18n';
import {
  Alert,
  Avatar,
  buttonClass,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { bx24SelectUsers } from '@/lib/bx24';
import { ApiRequestError } from '@/lib/platform-session';
import { userNames } from '@/lib/portal-users';
import { useAppSession } from '../session-provider';

const NOTICES = ['credits80', 'creditsOut', 'paymentFailed', 'periodEnd'] as const;

/**
 * Destinatários dos avisos do app (spec credit-billing, "Destinatários de avisos"; tarefa 11.10):
 * o administrador escolhe quem recebe as notificações no Bitrix24. Sem ninguém, vão para os
 * administradores do portal.
 */
export default function NotificationsPage() {
  const { session, api } = useAppSession();
  const t = useT('notifications');
  const errorText = useErrorMessage('notifications');
  const [ids, setIds] = useState<string[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const fetchList = useCallback(async () => {
    const { bitrixUserIds } = await api<NotificationRecipientsView>('/app/notification-recipients');
    return { ids: bitrixUserIds, names: await userNames(bitrixUserIds) };
  }, [api]);

  useEffect(() => {
    if (!session.user.isAdmin) return;
    let cancelled = false;
    fetchList()
      .then((list) => {
        if (cancelled) return;
        setIds(list.ids);
        setNames(list.names);
      })
      .catch(() => !cancelled && setError(t('errors.load')));
    return () => {
      cancelled = true;
    };
    // Trocar o idioma não deve refazer a consulta; só o texto de erro usa `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchList, session.user.isAdmin]);

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { bitrixUserIds } = await api<NotificationRecipientsView>(
        '/app/notification-recipients',
        { method: 'PUT', body: JSON.stringify({ bitrixUserIds: next }) },
      );
      setIds(bitrixUserIds);
      setNames(await userNames(bitrixUserIds));
    } catch (e) {
      setError(e instanceof ApiRequestError ? errorText(e) : t('errors.save'));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const selected = await bx24SelectUsers();
    if (selected.length === 0) return;
    await save([...(ids ?? []), ...selected.map((user) => user.id)]);
  }

  async function test() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<NotificationTestView>('/app/notification-recipients/test', {
        method: 'POST',
      });
      if (result.status === 'SENT') {
        setNotice(t('test.sent', { count: result.sentTo.length }));
      } else if (result.status === 'PENDING') {
        setNotice(t('test.pending'));
      } else {
        setError(t('test.noRecipient'));
      }
    } catch (e) {
      setError(e instanceof ApiRequestError ? errorText(e) : t('errors.test'));
    } finally {
      setTesting(false);
    }
  }

  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        session.user.isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void test()}
              disabled={testing || busy}
              className={buttonClass('secondary')}
            >
              {testing && <Spinner className="size-4" />}
              {t('sendTest')}
            </button>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              className={buttonClass('primary')}
            >
              <PlusIcon className="size-4" />
              {t('addPeople')}
            </button>
          </div>
        )
      }
    />
  );

  if (!session.user.isAdmin) {
    return (
      <>
        {header}
        <Alert tone="warning">{t('adminOnly')}</Alert>
      </>
    );
  }

  return (
    <>
      {header}
      {error && (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-6">
          {notice}
        </Alert>
      )}

      {ids === null ? (
        !error && <Loading />
      ) : (
        <Card>
          {ids.length === 0 ? (
            <EmptyState
              icon={<BellIcon className="size-6" />}
              title={t('empty.title')}
              description={t('empty.description')}
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {ids.map((id) => {
                const name = names[id] ?? t('userFallback', { id });
                return (
                  <li key={id} className="flex items-center gap-4 px-5 py-4 text-sm">
                    <Avatar name={name} />
                    <p className="min-w-0 flex-1 truncate font-medium text-zinc-900">{name}</p>
                    <button
                      type="button"
                      onClick={() => void save(ids.filter((other) => other !== id))}
                      disabled={busy}
                      className={buttonClass('ghost-danger', 'sm')}
                    >
                      {t('remove')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-zinc-900">{t('whenTitle')}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
          {NOTICES.map((item) => (
            <li key={item}>{t(`when.${item}`)}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500">{t('whenNote')}</p>
      </Card>
    </>
  );
}
