'use client';

import type { AgentView } from '@gptmaker/contracts';
import { createContext, useContext } from 'react';

export interface AgentContextValue {
  agent: AgentView;
  /** Atualiza o agente exibido (cabeçalho e abas) depois de salvar. */
  setAgent: (agent: AgentView) => void;
}

export const AgentContext = createContext<AgentContextValue | null>(null);

export function useAgent(): AgentContextValue {
  const value = useContext(AgentContext);
  if (!value) throw new Error('useAgent fora do layout do agente');
  return value;
}
