'use client';

import type { AgentView } from '@gptmaker/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { use, useEffect, useMemo, useState } from 'react';
import { ChatIcon } from '@/components/icons';
import { Alert, Avatar, Badge, buttonClass, Loading, PageHeader } from '@/components/ui';
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { agentStatus, agentTypeLabel, errorMessage } from '@/lib/agents';
import { useAppSession } from '../../session-provider';
import { AgentContext } from './agent-context';
import { TestChatModal } from './test-chat-modal';

/** Cabeçalho e abas do agente; as páginas recebem o agente já carregado pelo contexto. */
export default function AgentLayout({ params, children }: LayoutProps<'/app/agents/[id]'>) {
  const { id } = use(params);
  const { api, session } = useAppSession();
  const pathname = usePathname();
  const t = useT('agentDetail');
  const format = useFormat();
  const translateError = useErrorMessage('agentDetail');
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<AgentView>(`/app/agents/${encodeURIComponent(id)}`)
      .then((row) => !cancelled && setAgent(row))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, t('layout.loadError'), translateError)),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o idioma não refaz a leitura
  }, [api, id]);

  const context = useMemo(() => (agent ? { agent, setAgent } : null), [agent]);

  if (error) {
    return (
      <>
        <PageHeader title={t('layout.agent')} back={{ href: '/app', label: t('layout.agents') }} />
        <Alert tone="error">{error}</Alert>
      </>
    );
  }
  if (!context) return <Loading />;

  const base = `/app/agents/${agent!.id}`;
  const tabs = [
    {
      href: `${base}/function`,
      label: t('layout.tabs.function'),
      active: pathname.startsWith(`${base}/function`),
    },
    { href: base, label: t('layout.tabs.settings'), active: pathname === base },
    {
      href: `${base}/trainings`,
      label: t('layout.tabs.trainings'),
      active: pathname.startsWith(`${base}/trainings`),
    },
    {
      href: `${base}/intentions`,
      label: t('layout.tabs.intentions'),
      active: pathname.startsWith(`${base}/intentions`),
    },
    {
      href: `${base}/triggers`,
      label: t('layout.tabs.triggers'),
      active: pathname.startsWith(`${base}/triggers`),
    },
  ];
  const status = agentStatus(agent!, t);
  const canTest = session.canManage && agent!.status === 'ACTIVE';

  return (
    <AgentContext.Provider value={context}>
      <PageHeader
        back={{ href: '/app', label: t('layout.agents') }}
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
                {t('layout.test')}
              </button>
            )}
          </>
        }
        description={t('layout.description', {
          type: agentTypeLabel(agent!.type, t),
          date: format.dateTime(new Date(agent!.createdAt), { dateStyle: 'short' }),
        })}
      />
      <nav
        className="-mt-2 mb-6 flex gap-6 border-b border-zinc-200"
        aria-label={t('layout.sections')}
      >
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
          {t('layout.outOfSync')}
        </Alert>
      )}
      {children}
      {testing && canTest && <TestChatModal onClose={() => setTesting(false)} />}
    </AgentContext.Provider>
  );
}
