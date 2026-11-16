'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlusIcon, UsersIcon } from '@/components/icons';
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { Alert, Avatar, buttonClass, Card, EmptyState, Loading, PageHeader } from '@/components/ui';
import { bx24SelectUsers } from '@/lib/bx24';
import { ApiRequestError } from '@/lib/platform-session';
import { userNames } from '@/lib/portal-users';
import { useAppSession } from '../session-provider';

interface GrantedUser {
  bitrixUserId: string;
  grantedBy: string;
  grantedAt: string;
}

/** Concessão de permissão: o admin do portal escolhe quem pode gerenciar agentes. */
export default function PermissionsPage() {
  const { session, api } = useAppSession();
  const t = useT('permissions');
  const format = useFormat();
  const errorText = useErrorMessage('permissions');
  const [users, setUsers] = useState<GrantedUser[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchList = useCallback(async () => {
    const { users: granted } = await api<{ users: GrantedUser[] }>('/app/permissions');
    const ids = [...new Set(granted.flatMap((u) => [u.bitrixUserId, u.grantedBy]))];
    return { granted, names: await userNames(ids) };
  }, [api]);

  const show = (list: Awaited<ReturnType<typeof fetchList>>) => {
    setUsers(list.granted);
    setNames(list.names);
  };

  useEffect(() => {
    if (!session.user.isAdmin) return;
    let cancelled = false;
    fetchList()
      .then((list) => {
        if (cancelled) return;
        setUsers(list.granted);
        setNames(list.names);
      })
      .catch(() => !cancelled && setError(t('errors.load')));
    return () => {
      cancelled = true;
    };
    // Trocar o idioma não deve refazer a consulta; só o texto de erro usa `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchList, session.user.isAdmin]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      show(await fetchList());
    } catch (e) {
      setError(e instanceof ApiRequestError ? errorText(e) : t('errors.save'));
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(async () => {
      const selected = await bx24SelectUsers();
      if (selected.length === 0) return;
      await api('/app/permissions', {
        method: 'POST',
        body: JSON.stringify({ bitrixUserIds: selected.map((user) => user.id) }),
      });
    });

  const remove = (bitrixUserId: string) =>
    run(() => api(`/app/permissions/${encodeURIComponent(bitrixUserId)}`, { method: 'DELETE' }));

  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        session.user.isAdmin && (
          <button type="button" onClick={add} disabled={busy} className={buttonClass('primary')}>
            <PlusIcon className="size-4" />
            {t('authorize')}
          </button>
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
      {users === null ? (
        !error && <Loading />
      ) : (
        <Card>
          {users.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="size-6" />}
              title={t('empty.title')}
              description={t('empty.description')}
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {users.map((user) => {
                const name =
                  names[user.bitrixUserId] ?? t('userFallback', { id: user.bitrixUserId });
                return (
                  <li key={user.bitrixUserId} className="flex items-center gap-4 px-5 py-4 text-sm">
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-zinc-900">{name}</p>
                      <p className="text-xs text-zinc-500">
                        {t('grantedBy', {
                          name: names[user.grantedBy] ?? `#${user.grantedBy}`,
                          date: format.dateTime(new Date(user.grantedAt), { dateStyle: 'short' }),
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(user.bitrixUserId)}
                      disabled={busy}
                      className={buttonClass('ghost-danger', 'sm')}
                    >
                      {t('revoke')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
