'use client';

import type { AgentView } from '@gptmaker/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { use, useEffect, useMemo, useState } from 'react';
import { ChatIcon } from '@/components/icons';
import { Alert, Avatar, Badge, buttonClass, Loading, PageHeader } from '@/components/ui';
import { AGENT_TYPES, agentStatus, errorMessage } from '@/lib/agents';
import { useAppSession } from '../../session-provider';
import { AgentContext } from './agent-context';
import { TestChatModal } from './test-chat-modal';

/** Cabeçalho e abas do agente; as páginas recebem o agente já carregado pelo contexto. */
export default function AgentLayout({ params, children }: LayoutProps<'/app/agents/[id]'>) {
  const { id } = use(params);
  const { api, session } = useAppSession();
  const pathname = usePathname();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<AgentView>(`/app/agents/${encodeURIComponent(id)}`)
      .then((row) => !cancelled && setAgent(row))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar o agente.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  const context = useMemo(() => (agent ? { agent, setAgent } : null), [agent]);

  if (error) {
    return (
      <>
        <PageHeader title="Agente" back={{ href: '/app', label: 'Agentes' }} />
        <Alert tone="error">{error}</Alert>
      </>
    );
  }
  if (!context) return <Loading />;

  const base = `/app/agents/${agent!.id}`;
  const tabs = [
    { href: base, label: 'Configurações', active: pathname === base },
    {
      href: `${base}/trainings`,
      label: 'Treinamentos',
      active: pathname.startsWith(`${base}/trainings`),
    },
    {
      href: `${base}/intentions`,
      label: 'Intenções',
      active: pathname.startsWith(`${base}/intentions`),
    },
    {
      href: `${base}/triggers`,
      label: 'Gatilhos',
      active: pathname.startsWith(`${base}/triggers`),
    },
  ];
  const status = agentStatus(agent!);
  const canTest = session.canManage && agent!.status === 'ACTIVE';

  return (
    <AgentContext.Provider value={context}>
      <PageHeader
        back={{ href: '/app', label: 'Agentes' }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={agent!.name} src={agent!.avatarUrl} />
            {agent!.name}
          </span>
        }
        aside={
          <>
            <Badge tone={status.tone}>{status.label}</Badge>
            {canTest && (
              <button
                type="button"
                onClick={() => setTesting(true)}
                className={buttonClass('secondary', 'sm')}
              >
                <ChatIcon className="size-4" />
                Testar
              </button>
            )}
          </>
        }
        description={`${AGENT_TYPES[agent!.type]} · criado em ${new Date(agent!.createdAt).toLocaleDateString('pt-BR')}`}
      />
      <nav className="-mt-2 mb-6 flex gap-6 border-b border-zinc-200" aria-label="Seções do agente">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.active ? 'page' : undefined}
            className={`-mb-px border-b-2 pb-3 text-sm font-medium transition-colors ${
              tab.active
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {agent!.status === 'OUT_OF_SYNC' && (
        <Alert tone="warning" className="mb-6">
          O agente não foi encontrado no GPTMaker e não pode ser alterado. Fale com o suporte.
        </Alert>
      )}
      {children}
      {testing && canTest && <TestChatModal onClose={() => setTesting(false)} />}
    </AgentContext.Provider>
  );
}
