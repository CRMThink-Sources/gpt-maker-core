'use client';

import type { AdminSessionView } from '@gptmaker/contracts';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Logo } from '@/components/logo';
import { Avatar, Spinner } from '@/components/ui';
import { type AdminApi, createAdminApi } from '@/lib/admin-api';
import { ApiRequestError } from '@/lib/platform-session';

type Operator = AdminSessionView['operator'];

interface AdminContextValue {
  api: AdminApi;
  operator: Operator | null;
  signedIn: (operator: Operator) => void;
  signOut: () => Promise<void>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin fora do AdminProvider');
  return value;
}

/** Operador logado (as páginas internas só renderizam com sessão). */
export function useOperator(): Operator {
  const { operator } = useAdmin();
  if (!operator) throw new Error('useOperator sem sessão');
  return operator;
}

const NAV = [
  { href: '/admin', label: 'Início', match: (path: string) => path === '/admin' },
  {
    href: '/admin/tenants',
    label: 'Portais',
    match: (path: string) => path.startsWith('/admin/tenants'),
  },
  {
    href: '/admin/models',
    label: 'Modelos',
    match: (path: string) => path.startsWith('/admin/models'),
  },
  {
    href: '/admin/plans',
    label: 'Planos',
    match: (path: string) => path.startsWith('/admin/plans'),
  },
  {
    href: '/admin/workspace',
    label: 'Workspace',
    match: (path: string) => path.startsWith('/admin/workspace'),
  },
  {
    href: '/admin/consumption',
    label: 'Consumo',
    match: (path: string) => path.startsWith('/admin/consumption'),
  },
  {
    href: '/admin/operators',
    label: 'Operadores',
    match: (path: string) => path.startsWith('/admin/operators'),
  },
  {
    href: '/admin/account',
    label: 'Minha conta',
    match: (path: string) => path.startsWith('/admin/account'),
  },
];

/**
 * Sessão do backoffice: confere `/admin/auth/me` ao abrir; sem sessão, manda para o login. As
 * páginas internas ficam dentro do menu; o login, sozinho.
 */
export function AdminProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => createAdminApi(), []);
  const router = useRouter();
  const pathname = usePathname();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [checked, setChecked] = useState(false);
  const onLogin = pathname === '/admin/login';

  useEffect(() => {
    let cancelled = false;
    api<AdminSessionView>('/admin/auth/me')
      .then(({ operator }) => !cancelled && setOperator(operator))
      .catch((e: unknown) => {
        if (!cancelled && !(e instanceof ApiRequestError && e.status === 401)) {
          console.error(e);
        }
      })
      .finally(() => !cancelled && setChecked(true));
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!checked) return;
    if (!operator && !onLogin) router.replace('/admin/login');
    if (operator && onLogin) router.replace('/admin');
  }, [checked, operator, onLogin, router]);

  const signOut = useCallback(async () => {
    await api('/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
    setOperator(null);
    router.replace('/admin/login');
  }, [api, router]);

  const value = useMemo(
    () => ({ api, operator, signedIn: setOperator, signOut }),
    [api, operator, signOut],
  );

  if (!checked || (!operator && !onLogin) || (operator && onLogin)) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <AdminContext.Provider value={value}>
      {onLogin ? children : <AdminShell>{children}</AdminShell>}
    </AdminContext.Provider>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const { signOut } = useAdmin();
  const operator = useOperator();
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-8">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo subtitle={false} />
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Backoffice
            </span>
          </Link>
          <nav className="flex flex-1 gap-1 text-sm">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md px-2.5 py-1.5 font-medium ${
                    active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Avatar name={operator.name} />
            <div className="hidden leading-tight sm:block">
              <p className="font-medium text-zinc-900">{operator.name}</p>
              <p className="text-xs text-zinc-500">
                {operator.role === 'ADMIN' ? 'Administrador' : 'Suporte'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
