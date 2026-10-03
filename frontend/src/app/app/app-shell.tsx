'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { BoltIcon, BotIcon, CloseIcon, MenuIcon, UsersIcon, WalletIcon } from '@/components/icons';
import { Logo } from '@/components/logo';
import { Alert, Avatar } from '@/components/ui';
import { useAppSession } from './session-provider';

interface NavItem {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href?: string;
  /** Prefixos de rota que marcam o item como atual. */
  match?: (path: string) => boolean;
  adminOnly?: boolean;
}

const NAV: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [
      {
        label: 'Agentes',
        icon: BotIcon,
        href: '/app',
        match: (path) => path === '/app' || path.startsWith('/app/agents'),
      },
      // Treinamentos ficam em cada agente (aba). Seções seguintes (10 e 12) entram quando existirem.
      { label: 'Gatilhos', icon: BoltIcon },
      {
        label: 'Créditos e plano',
        icon: WalletIcon,
        href: '/app/plan',
        match: (path) => path.startsWith('/app/plan'),
      },
    ],
  },
  {
    title: 'Configurações',
    items: [
      {
        label: 'Permissões',
        icon: UsersIcon,
        href: '/app/permissions',
        match: (path) => path.startsWith('/app/permissions'),
        adminOnly: true,
      },
    ],
  },
];

function roleLabel(session: ReturnType<typeof useAppSession>['session']): string {
  if (session.user.isAdmin) return 'Administrador';
  return session.canManage ? 'Gerencia agentes' : 'Somente leitura';
}

/** Layout da área do cliente: aside fixo no desktop, gaveta no celular. */
export function AppShell({ children }: { children: ReactNode }) {
  const { session } = useAppSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/app" onClick={() => setOpen(false)}>
          <Logo />
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
          const items = group.items.filter((item) => !item.adminOnly || session.user.isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={group.title ?? index}>
              {group.title && (
                <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {group.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  if (!item.href) {
                    return (
                      <li
                        key={item.label}
                        className="flex cursor-default items-center gap-3 rounded-lg px-2 py-2 text-sm text-zinc-400"
                      >
                        <Icon className="size-5" />
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                          Em breve
                        </span>
                      </li>
                    );
                  }
                  const active = item.match?.(pathname) ?? pathname === item.href;
                  return (
                    <li key={item.label}>
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

      <div className="border-t border-zinc-200 p-4">
        <div className="flex items-center gap-3">
          <Avatar name={session.user.name} />
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium text-zinc-900">{session.user.name}</p>
            <p className="truncate text-xs text-zinc-500">
              {roleLabel(session)} · portal {session.tenant.code}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white lg:block">
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
          <div className="mx-auto max-w-5xl">
            {session.tenant.status === 'AUTH_ERROR' && (
              <Alert tone="warning" className="mb-6">
                O Bitrix24 recusou a autorização do app e o atendimento dos agentes está pausado. Um
                administrador do portal precisa reinstalar o app para restabelecer o acesso.
              </Alert>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
