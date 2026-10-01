import type { AgentView } from '@gptmaker/contracts';
import { ApiRequestError } from './platform-session';

export const AGENT_TYPES: Record<AgentView['type'], string> = {
  SUPPORT: 'Suporte',
  SALE: 'Vendas',
  PERSONAL: 'Assistente pessoal',
};

export const COMMUNICATION_TYPES: Record<AgentView['communicationType'], string> = {
  FORMAL: 'Formal',
  NORMAL: 'Normal',
  RELAXED: 'Descontraído',
};

const INACTIVE_REASONS: Record<string, string> = {
  MANUAL: 'inativado manualmente',
  SUBSCRIPTION_EXPIRED: 'assinatura inativa',
  TENANT_SUSPENDED: 'conta suspensa',
  UNINSTALLED: 'app desinstalado',
};

/** Rótulo e cor do status do agente na lista e no formulário. */
export function agentStatus(agent: Pick<AgentView, 'status' | 'inactiveReason'>): {
  label: string;
  tone: 'green' | 'zinc' | 'amber';
} {
  if (agent.status === 'ACTIVE') return { label: 'Ativo', tone: 'green' };
  if (agent.status === 'OUT_OF_SYNC') return { label: 'Fora de sincronia', tone: 'amber' };
  const reason = agent.inactiveReason ? INACTIVE_REASONS[agent.inactiveReason] : undefined;
  return { label: reason ? `Inativo · ${reason}` : 'Inativo', tone: 'zinc' };
}

/** Inativação feita pelo sistema: volta sozinha quando a causa for resolvida. */
export function inactiveBySystem(agent: Pick<AgentView, 'status' | 'inactiveReason'>): boolean {
  return agent.status === 'INACTIVE' && agent.inactiveReason !== 'MANUAL';
}

export function credits(value: number): string {
  return `${value} ${value === 1 ? 'crédito' : 'créditos'} por resposta`;
}

const MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Alguns campos estão inválidos. Revise e tente de novo.',
  TENANT_AGENT_LIMIT: 'Você atingiu o limite de agentes. Remova um agente para criar outro.',
};

/** Mensagem para o usuário: a da API (já em pt-BR), salvo códigos com texto melhor aqui. */
export function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  if (MESSAGES[error.code]) return MESSAGES[error.code]!;
  return error.code.startsWith('HTTP_') ? fallback : error.message;
}
