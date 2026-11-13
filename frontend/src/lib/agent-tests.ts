import type {
  CrmClientOption,
  NewTestConversationInput,
  TestConversationSummary,
  TestConversationView,
  TestExchangeView,
  TestMessageInput,
} from '@gptmaker/contracts';
import type { createFormat, T } from '@/i18n';
import { ApiRequestError, type PlatformSessionClient } from './platform-session';

/** `api` da sessão do iframe (`useAppSession().api`). */
type Api = PlatformSessionClient['api'];

function testsPath(agentId: string, conversationId?: string): string {
  const base = `/app/agents/${encodeURIComponent(agentId)}/tests`;
  return conversationId ? `${base}/${encodeURIComponent(conversationId)}` : base;
}

/** Conversas de teste do agente, da mais recente para a mais antiga. */
export function listTestConversations(
  api: Api,
  agentId: string,
): Promise<TestConversationSummary[]> {
  return api<TestConversationSummary[]>(testsPath(agentId));
}

export function createTestConversation(
  api: Api,
  agentId: string,
  body: NewTestConversationInput,
): Promise<TestConversationView> {
  return api<TestConversationView>(testsPath(agentId), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getTestConversation(
  api: Api,
  agentId: string,
  conversationId: string,
): Promise<TestConversationView> {
  return api<TestConversationView>(testsPath(agentId, conversationId));
}

export function deleteTestConversation(
  api: Api,
  agentId: string,
  conversationId: string,
): Promise<void> {
  return api<void>(testsPath(agentId, conversationId), { method: 'DELETE' });
}

/** Envia a mensagem e espera a resposta do agente (síncrono: pode levar até ~60 segundos). */
export function sendTestMessage(
  api: Api,
  agentId: string,
  conversationId: string,
  body: TestMessageInput,
): Promise<TestExchangeView> {
  return api<TestExchangeView>(`${testsPath(agentId, conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Busca clientes do CRM (contatos, leads, empresas) por nome, telefone ou e-mail. */
export function searchCrmClients(api: Api, query: string): Promise<CrmClientOption[]> {
  return api<CrmClientOption[]>(`/app/crm/clients?query=${encodeURIComponent(query)}`);
}

/** Mínimo de caracteres para buscar clientes do CRM. */
export const CRM_CLIENT_SEARCH_MIN = 2;

/** Sem créditos para a resposta de teste (422 `NO_CREDIT`). */
export function noCredit(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'NO_CREDIT';
}

/** Data/hora curta e relativa para a lista de conversas ("agora", "há 5 min", "ontem, 14:02"). */
export function formatWhen(
  iso: string,
  t: T,
  format: ReturnType<typeof createFormat>,
  now: Date = new Date(),
): string {
  const date = new Date(iso);
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60_000);
  const time = format.dateTime(date, { hour: '2-digit', minute: '2-digit' });
  if (diffMin < 1) return t('when.now');
  if (diffMin < 60) return t('when.minutesAgo', { count: diffMin });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return t('when.today', { time });
  if (date.getTime() >= startOfToday - 86_400_000) return t('when.yesterday', { time });
  return format.dateTime(date, { dateStyle: 'short', timeStyle: 'short' });
}
