import type { ConversationRole } from '@gptmaker/contracts';
import { isTestDialog } from '../agent-test';

/**
 * Normalização do que o GPTMaker devolve em chats e mensagens (spec agent-hallucination-analysis;
 * design D3 e D4). A doc não lista os valores de `role` nem a unidade de `time`: as regras abaixo
 * seguem o observado nos webhooks (`assistant` e `user`) e são conferidas contra um workspace real
 * (docs/gptmaker-api.md). Tudo é puro, para testar sem rede.
 */

const AGENT_ROLES: ReadonlySet<string> = new Set(['assistant', 'agent', 'bot', 'ai', 'model']);
const CUSTOMER_ROLES: ReadonlySet<string> = new Set(['user', 'customer', 'client', 'human']);

/** Papel da mensagem; valor desconhecido é `OTHER` e nunca conta como resposta do agente. */
export function normalizeRole(role: string | null | undefined): ConversationRole {
  const value = (role ?? '').trim().toLowerCase();
  if (AGENT_ROLES.has(value)) return 'AGENT';
  if (CUSTOMER_ROLES.has(value)) return 'CUSTOMER';
  return 'OTHER';
}

/** Abaixo de 1e12 é época em segundos (até o ano 33658); acima, em milissegundos. */
const MILLISECONDS_FROM = 1e12;

/** Data da mensagem, ou `null` se o tempo faltar ou não for um número utilizável. */
export function normalizeTime(time: number | null | undefined): Date | null {
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return null;
  return new Date(time < MILLISECONDS_FROM ? time * 1000 : time);
}

export type ChatOrigin = 'REAL' | 'TEST';

/** Escopo da conversa: o agente do GPTMaker e o tenant da sessão. */
export interface ChatScope {
  gptmakerAgentId: string;
  tenantId: string;
}

/** Início do `id` dos chats do agente do tenant (`public-api-<agentId>-<tenantId>:<diálogo>`). */
export function chatIdPrefix(scope: ChatScope): string {
  return `public-api-${scope.gptmakerAgentId}-${scope.tenantId}:`;
}

/** Diálogo do chat (a parte depois do prefixo do tenant), ou `null` se o chat não for do escopo. */
export function dialogOfChat(
  chat: { id: string; recipient?: string | null },
  scope: ChatScope,
): string | null {
  const prefix = chatIdPrefix(scope);
  if (!chat.id.startsWith(prefix)) return null;
  const dialog = chat.id.slice(prefix.length);
  if (dialog === '') return null;
  // Quando o GPTMaker informa o `recipient` (o contextId original), ele precisa concordar com o id:
  // dois sinais independentes do mesmo tenant antes de aceitar a conversa.
  if (chat.recipient && chat.recipient !== `${scope.tenantId}:${dialog}`) return null;
  return dialog;
}

/**
 * `REAL` ou `TEST` para um chat do agente do tenant; `null` para qualquer chat de outro tenant,
 * de outro agente ou sem diálogo. O workspace é compartilhado entre tenants: este é o filtro que
 * impede o vazamento.
 */
export function classifyChat(
  chat: { id: string; recipient?: string | null },
  scope: ChatScope,
): ChatOrigin | null {
  const dialog = dialogOfChat(chat, scope);
  if (dialog === null) return null;
  return isTestDialog(dialog) ? 'TEST' : 'REAL';
}
