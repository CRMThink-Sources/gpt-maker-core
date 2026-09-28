'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
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

  if (!session.user.isAdmin) {
    return (
      <p className="text-sm text-zinc-600">
        Somente administradores do portal gerenciam permissões.
      </p>
    );
  }

  return (
    <section className="max-w-2xl">
      <Link href="/app" className="text-sm text-violet-700 underline">
        Voltar
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Quem pode gerenciar os agentes</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Administradores do portal sempre podem criar, editar, treinar e configurar gatilhos.
        Autorize aqui outros usuários; os demais só consultam.
      </p>

      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="mt-4 rounded bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        Autorizar usuários
      </button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {users === null ? (
        <p className="mt-4 text-sm text-zinc-500">Carregando…</p>
      ) : users.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600">
          Nenhum usuário autorizado além dos administradores.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 rounded border border-zinc-200">
          {users.map((user) => (
            <li key={user.bitrixUserId} className="flex items-center justify-between p-3 text-sm">
              <span>
                {names[user.bitrixUserId] ?? `Usuário #${user.bitrixUserId}`}
                <span className="block text-xs text-zinc-500">
                  por {names[user.grantedBy] ?? `#${user.grantedBy}`} em{' '}
                  {new Date(user.grantedAt).toLocaleDateString('pt-BR')}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(user.bitrixUserId)}
                disabled={busy}
                className="text-red-700 underline disabled:opacity-50"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
