'use client';

import type { AdminSessionView } from '@gptmaker/contracts';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertIcon,
  BotIcon,
  BuildingIcon,
  ChartIcon,
  CloseIcon,
  DatabaseIcon,
  HomeIcon,
  LogoutIcon,
  MenuIcon,
  ShieldIcon,
  SparkIcon,
  TextIcon,
  UsersIcon,
  WalletIcon,
} from '@/components/icons';
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

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  match: (path: string) => boolean;
  adminOnly?: boolean;
}

const under = (prefix: string) => (path: string) => path.startsWith(prefix);

/** Menu lateral em grupos: com muitos itens, a barra horizontal quebrava. */
const NAV: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [
      { href: '/admin', label: 'Início', icon: HomeIcon, match: (path) => path === '/admin' },
    ],
  },
  {
    title: 'Clientes',
    items: [
      {
        href: '/admin/tenants',
        label: 'Portais',
        icon: BuildingIcon,
        match: under('/admin/tenants'),
      },
      { href: '/admin/plans', label: 'Planos', icon: WalletIcon, match: under('/admin/plans') },
      {
        href: '/admin/consumption',
        label: 'Consumo',
        icon: ChartIcon,
        match: under('/admin/consumption'),
      },
    ],
  },
  {
    title: 'Agentes',
    items: [
      {
        href: '/admin/functions',
        label: 'Funções',
        icon: BotIcon,
        match: under('/admin/functions'),
      },
      { href: '/admin/models', label: 'Modelos', icon: SparkIcon, match: under('/admin/models') },
      {
        href: '/admin/crm-guidance',
        label: 'Orientações do CRM',
        icon: TextIcon,
        match: under('/admin/crm-guidance'),
      },
      {
        href: '/admin/workspace',
        label: 'Workspace',
        icon: DatabaseIcon,
        match: under('/admin/workspace'),
      },
    ],
  },
  {
    title: 'Operação',
    items: [
      {
        href: '/admin/operations',
        label: 'Erros',
        icon: AlertIcon,
        match: under('/admin/operations'),
      },
      {
        href: '/admin/audit',
        label: 'Auditoria',
        icon: ShieldIcon,
        match: under('/admin/audit'),
        adminOnly: true,
      },
      {
        href: '/admin/operators',
        label: 'Operadores',
        icon: UsersIcon,
        match: under('/admin/operators'),
      },
    ],
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

/** Layout do backoffice: menu lateral fixo no desktop, gaveta no celular. */
function AdminShell({ children }: { children: ReactNode }) {
  const { signOut } = useAdmin();
  const operator = useOperator();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const accountActive = pathname.startsWith('/admin/account');

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between gap-2 px-5">
        <Link href="/admin" onClick={() => setOpen(false)} className="relative">
          <Logo subtitle={false} />
          <span className="absolute -bottom-3.5 left-10.5 rounded bg-zinc-900 px-1 py-px text-[9px] font-semibold tracking-wide text-white uppercase">
            Backoffice
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 lg:hidden"
          aria-label="Fechar menu"
        >
          <CloseIcon />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV.map((group, index) => {
          const items = group.items.filter((item) => !item.adminOnly || operator.role === 'ADMIN');
          if (items.length === 0) return null;
          return (
            <div key={group.title ?? index}>
              {group.title && (
                <p className="px-2 pb-2 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
                  {group.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = item.match(pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-brand-50 text-brand-700'
                            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                        }`}
                      >
                        <Icon className={`size-5 ${active ? 'text-brand-600' : 'text-zinc-400'}`} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200 p-3">
        <div className="flex items-center gap-1">
          <Link
            href="/admin/account"
            onClick={() => setOpen(false)}
            aria-current={accountActive ? 'page' : undefined}
            title="Minha conta"
            className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 ${
              accountActive ? 'bg-brand-50' : 'hover:bg-zinc-100'
            }`}
          >
            <Avatar name={operator.name} />
            <span className="min-w-0 text-sm leading-tight">
              <span className="block truncate font-medium text-zinc-900">{operator.name}</span>
              <span className="block truncate text-xs text-zinc-500">
                {operator.role === 'ADMIN' ? 'Administrador' : 'Suporte'} · Minha conta
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sair"
            aria-label="Sair"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <LogoutIcon className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-zinc-900/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md p-1 text-zinc-600 hover:bg-zinc-100"
            aria-label="Abrir menu"
          >
            <MenuIcon />
          </button>
          <Logo subtitle={false} />
        </header>

        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {/* Editores de função e de bloco usam a largura toda (navegação, conteúdo e painel). */}
          <div
            className={`mx-auto ${pathname.startsWith('/admin/functions/') ? 'max-w-[100rem]' : 'max-w-6xl'}`}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
