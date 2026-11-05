'use client';

import type { AgentView } from '@gptmaker/contracts';
import { useEffect, useState } from 'react';
import { useAppSession } from '../session-provider';

/**
 * Agentes do portal que um campo "Agente" pode escolher como destino de transferência (design
 * D17): todos, menos o próprio. A lista do app já vem sem os removidos.
 */
export function useTransferAgents(exclude?: string): Array<{ id: string; name: string }> {
  const { api } = useAppSession();
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    api<{ agents: AgentView[] }>('/app/agents')
      .then(({ agents: list }) => {
        if (!cancelled) setAgents(list.map(({ id, name }) => ({ id, name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);
  return agents.filter((agent) => agent.id !== exclude);
}
