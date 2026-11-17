import { z } from 'zod';

/**
 * Conversas do agente para a análise de alucinação (spec agent-hallucination-analysis): as do chat
 * de teste (guardadas aqui) e as reais (lidas do GPTMaker na hora, nunca gravadas).
 */
export const conversationSourceSchema = z.enum(['TEST', 'REAL']);
export type ConversationSource = z.infer<typeof conversationSourceSchema>;

/** Quantas mensagens mais recentes entram na análise (spec: Escolher a conversa). */
export const CONVERSATION_MAX_MESSAGES = 50;

/**
 * `cursor` é opaco para a tela: começa em 0 e o servidor devolve o próximo em `nextCursor` (`null`
 * quando acabou). Nas reais, o GPTMaker lista o workspace inteiro e o servidor filtra o tenant,
 * então a página do cliente não corresponde a uma página do GPTMaker.
 */
export const listConversationsQuerySchema = z.object({
  source: conversationSourceSchema,
  cursor: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListConversationsQuery = z.input<typeof listConversationsQuerySchema>;

export interface ConversationSummary {
  /** Teste: id local. Real: id do chat no GPTMaker. */
  id: string;
  source: ConversationSource;
  title: string;
  /** Última atividade (ISO), quando conhecida. */
  at: string | null;
  /** Só conhecido nas conversas de teste. */
  messageCount: number | null;
}

export interface ConversationList {
  conversations: ConversationSummary[];
  nextCursor: number | null;
}

export type ConversationRole = 'CUSTOMER' | 'AGENT' | 'OTHER';

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  text: string;
  at: string | null;
  /** Imagem, áudio ou documento: o texto da análise não os inclui. */
  hasAttachment: boolean;
}

export interface ConversationMessages {
  /** As mais recentes (até `CONVERSATION_MAX_MESSAGES`), da mais antiga para a mais nova. */
  messages: ConversationMessage[];
  /** Quantas mensagens anteriores ficaram de fora. */
  omitted: number;
}

/** `source` das mensagens: o id da conversa vem na rota. */
export const conversationMessagesQuerySchema = z.object({ source: conversationSourceSchema });
export type ConversationMessagesQuery = z.input<typeof conversationMessagesQuerySchema>;
