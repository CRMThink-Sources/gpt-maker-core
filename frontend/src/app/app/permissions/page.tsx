'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlusIcon, UsersIcon } from '@/components/icons';
import { Alert, Avatar, buttonClass, Card, EmptyState, Loading, PageHeader } from '@/components/ui';
import { bx24Call, bx24SelectUsers } from '@/lib/bx24';
import { ApiRequestError } from '@/lib/platform-session';
import { useAppSession } from '../session-provider';

interface GrantedUser {
  bitrixUserId: string;
  grantedBy: string;
  grantedAt: string;
}

interface BitrixUser {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
}

/** Nomes vêm do próprio portal (auth do usuário no BX24); o backend guarda só os ids. */
async function userNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    const users = await bx24Call<BitrixUser[]>('user.get', { ID: ids });
    return Object.fromEntries(
      users.map((user) => [
        user.ID,
        [user.NAME, user.LAST_NAME].filter(Boolean).join(' ') || `#${user.ID}`,
      ]),
    );
  } catch {
    return {};
  }
}

/** Concessão de permissão: o admin do portal escolhe quem pode gerenciar agentes. */
export default function PermissionsPage() {
  const { session, api } = useAppSession();
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
      .catch(() => !cancelled && setError('Não foi possível carregar as permissões.'));
    return () => {
      cancelled = true;
    };
  }, [fetchList, session.user.isAdmin]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      show(await fetchList());
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.');
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
      title="Permissões"
      description="Administradores do portal sempre podem criar, editar, treinar e configurar gatilhos. Autorize aqui outros usuários; os demais só consultam."
      actions={
        session.user.isAdmin && (
          <button type="button" onClick={add} disabled={busy} className={buttonClass('primary')}>
            <PlusIcon className="size-4" />
            Autorizar usuários
          </button>
        )
      }
    />
  );

  if (!session.user.isAdmin) {
    return (
      <>
        {header}
        <Alert tone="warning">Somente administradores do portal gerenciam permissões.</Alert>
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
              title="Só administradores gerenciam agentes"
              description="Autorize outros usuários do portal para que também possam criar e editar agentes."
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {users.map((user) => {
                const name = names[user.bitrixUserId] ?? `Usuário #${user.bitrixUserId}`;
                return (
                  <li key={user.bitrixUserId} className="flex items-center gap-4 px-5 py-4 text-sm">
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-zinc-900">{name}</p>
                      <p className="text-xs text-zinc-500">
                        Autorizado por {names[user.grantedBy] ?? `#${user.grantedBy}`} em{' '}
                        {new Date(user.grantedAt).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(user.bitrixUserId)}
                      disabled={busy}
                      className={buttonClass('ghost-danger', 'sm')}
                    >
                      Remover acesso
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
