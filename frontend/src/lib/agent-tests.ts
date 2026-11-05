import type {
  CrmClientOption,
  NewTestConversationInput,
  TestConversationSummary,
  TestConversationView,
  TestExchangeView,
  TestMessageInput,
} from '@gptmaker/contracts';
import { errorMessage } from './agents';
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

const MESSAGES: Record<string, string> = {
  TEST_REPLY_PENDING:
    'O agente ainda está respondendo a mensagem anterior. Aguarde a resposta antes de enviar outra.',
  NO_CREDIT:
    'Sua conta está sem créditos para respostas do agente. Adicione créditos para continuar testando.',
  TEST_REPLY_FAILED:
    'O agente não respondeu desta vez. Tente enviar a mensagem de novo em alguns instantes.',
  AGENT_NOT_ACTIVE: 'O agente não está ativo. Ative o agente para testá-lo.',
  CRM_UNAVAILABLE: 'O Bitrix24 não respondeu agora. Aguarde um pouco e tente de novo.',
};

/** Mensagem para o usuário no teste do agente. */
export function agentTestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && MESSAGES[error.code]) return MESSAGES[error.code]!;
  return errorMessage(error, fallback);
}

/** Data/hora curta e relativa para a lista de conversas ("agora", "há 5 min", "ontem, 14:02"). */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60_000);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return `hoje, ${time}`;
  if (date.getTime() >= startOfToday - 86_400_000) return `ontem, ${time}`;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
