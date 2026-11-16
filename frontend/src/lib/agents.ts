import type { AgentView } from '@gptmaker/contracts';
import { createT, type T } from '@/i18n';
import { ApiRequestError } from './platform-session';

/** Sem `t` (testes e quem ainda não traduz) vale o pt-BR do namespace `agentDetail`. */
const fallbackT = createT('pt-BR', 'agentDetail');

/** Tipos do agente, em pt-BR; para outro idioma use `agentTypeLabel(type, t)`. */
export const AGENT_TYPES: Record<AgentView['type'], string> = {
  SUPPORT: fallbackT('types.SUPPORT'),
  SALE: fallbackT('types.SALE'),
  PERSONAL: fallbackT('types.PERSONAL'),
};

/** Tipo do agente no idioma de `t` (namespace `agentDetail`). */
export function agentTypeLabel(type: AgentView['type'], t: T): string {
  return t(`types.${type}`);
}

export function communicationLabel(type: AgentView['communicationType'], t: T): string {
  return t(`communication.${type}`);
}

/** Rótulo e cor do status do agente na lista e no formulário (`t` do namespace `agentDetail`). */
export function agentStatus(
  agent: Pick<AgentView, 'status' | 'inactiveReason'>,
  t: T = fallbackT,
): {
  label: string;
  tone: 'green' | 'zinc' | 'amber';
} {
  if (agent.status === 'ACTIVE') return { label: t('status.active'), tone: 'green' };
  if (agent.status === 'OUT_OF_SYNC') return { label: t('status.outOfSync'), tone: 'amber' };
  const reason = agent.inactiveReason ? `inactiveReasons.${agent.inactiveReason}` : undefined;
  return reason && t.has(reason)
    ? { label: t('status.inactiveWithReason', { reason: t(reason) }), tone: 'zinc' }
    : { label: t('status.inactive'), tone: 'zinc' };
}

/** Inativação feita pelo sistema: volta sozinha quando a causa for resolvida. */
export function inactiveBySystem(agent: Pick<AgentView, 'status' | 'inactiveReason'>): boolean {
  return agent.status === 'INACTIVE' && agent.inactiveReason !== 'MANUAL';
}

export function credits(value: number, t: T = fallbackT): string {
  return t('creditsPerResponse', { count: value });
}

const MESSAGES = ['VALIDATION_ERROR', 'TENANT_AGENT_LIMIT'];

/**
 * Mensagem para o usuário: a da API, salvo códigos com texto melhor aqui. `translate` vem de
 * `useErrorMessage(ns)`; sem ele a mensagem é a que a API devolveu (pt-BR).
 */
export function errorMessage(
  error: unknown,
  fallback: string,
  translate?: (error: unknown) => string,
): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  if (error.code.startsWith('HTTP_')) return fallback;
  if (translate) return translate(error);
  return MESSAGES.includes(error.code) ? fallbackT(`errors.${error.code}`) : error.message;
}
