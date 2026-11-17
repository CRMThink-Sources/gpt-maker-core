import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  CONVERSATION_MAX_MESSAGES,
  type ConversationList,
  type ConversationMessage,
  type ConversationMessages,
  type ConversationSource,
  type ConversationSummary,
} from '@gptmaker/contracts';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agentTestConversation, agentTestMessage } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { type Agent, AgentRepository } from '../agents';
import { GptMakerClient, GptMakerError, type GptMakerChat } from '../gptmaker';
import {
  type ChatScope,
  classifyChat,
  normalizeRole,
  normalizeTime,
} from './conversation-normalize';

/** Conversas por resposta da lista (as de teste e as reais). */
export const CONVERSATIONS_PAGE_SIZE = 20;
/**
 * Página pedida ao GPTMaker. A listagem de chats aceita até 200 (acima disso responde 400);
 * 50 é conservador (docs/gptmaker-api.md, §7, validado em 2026-11-17).
 */
const GPTMAKER_PAGE_SIZE = 50;
/** Páginas do GPTMaker lidas por pedido da lista (o workspace é de todos os tenants; design D3). */
const MAX_LIST_PAGES = 5;
/** Páginas de mensagens lidas de um chat; mais que isso é conversa que a análise nem usaria. */
const MAX_MESSAGE_PAGES = 10;

const unavailable = () =>
  new DomainError(
    'CONVERSATIONS_UNAVAILABLE',
    'Não foi possível carregar as conversas agora. Tente de novo em instantes.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );

const notFound = () =>
  new DomainError('CONVERSATION_NOT_FOUND', 'Conversa não encontrada', HttpStatus.NOT_FOUND);

/**
 * Conversas do agente para a análise de alucinação (spec agent-hallucination-analysis): lê as de
 * teste do banco e as reais do GPTMaker, só do tenant e do agente da sessão. Nada do texto das
 * conversas reais é gravado ou logado (design D4 e D7).
 */
@Injectable()
export class ConversationSourceService {
  private readonly logger = new Logger(ConversationSourceService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly agents: AgentRepository,
    private readonly gptmaker: GptMakerClient,
  ) {}

  async list(
    tenantId: string,
    agentId: string,
    source: ConversationSource,
    cursor: number,
  ): Promise<ConversationList> {
    const agent = await this.agents.getById(tenantId, agentId);
    return source === 'TEST'
      ? this.listTests(agent, cursor)
      : this.listReal(scopeOf(agent), cursor);
  }

  /**
   * Mensagens da conversa (as mais recentes, até o limite da análise). Qualquer id fora do tenant e
   * do agente da sessão, ou da origem pedida, é `CONVERSATION_NOT_FOUND` sem tocar no GPTMaker.
   */
  async messages(
    tenantId: string,
    agentId: string,
    source: ConversationSource,
    conversationId: string,
  ): Promise<ConversationMessages> {
    const agent = await this.agents.getById(tenantId, agentId);
    return source === 'TEST'
      ? this.testMessages(agent, conversationId)
      : this.realMessages(scopeOf(agent), conversationId);
  }

  // Teste -----------------------------------------------------------------------------------

  private async listTests(agent: Agent, cursor: number): Promise<ConversationList> {
    const rows = await this.db
      .select()
      .from(agentTestConversation)
      .where(
        and(
          eq(agentTestConversation.tenantId, agent.tenantId),
          eq(agentTestConversation.agentId, agent.id),
        ),
      )
      .orderBy(desc(agentTestConversation.lastMessageAt), desc(agentTestConversation.id))
      .limit(CONVERSATIONS_PAGE_SIZE + 1)
      .offset(cursor);
    const page = rows.slice(0, CONVERSATIONS_PAGE_SIZE);
    const counts = page.length
      ? await this.db
          .select({ id: agentTestMessage.conversationId, total: count() })
          .from(agentTestMessage)
          .where(
            inArray(
              agentTestMessage.conversationId,
              page.map((row) => row.id),
            ),
          )
          .groupBy(agentTestMessage.conversationId)
      : [];
    const totals = new Map(counts.map((entry) => [entry.id, entry.total]));
    const conversations: ConversationSummary[] = page.map((row) => ({
      id: row.id,
      source: 'TEST',
      title: row.clientName ? `${row.createdByName} · ${row.clientName}` : row.createdByName,
      at: row.lastMessageAt.toISOString(),
      messageCount: totals.get(row.id) ?? 0,
    }));
    return {
      conversations,
      nextCursor: rows.length > CONVERSATIONS_PAGE_SIZE ? cursor + CONVERSATIONS_PAGE_SIZE : null,
    };
  }

  private async testMessages(agent: Agent, conversationId: string): Promise<ConversationMessages> {
    if (!UUID.test(conversationId)) throw notFound();
    const [conversation] = await this.db
      .select({ id: agentTestConversation.id })
      .from(agentTestConversation)
      .where(
        and(
          eq(agentTestConversation.id, conversationId),
          eq(agentTestConversation.tenantId, agent.tenantId),
          eq(agentTestConversation.agentId, agent.id),
        ),
      );
    if (!conversation) throw notFound();
    const rows = await this.db
      .select()
      .from(agentTestMessage)
      .where(eq(agentTestMessage.conversationId, conversation.id))
      .orderBy(asc(agentTestMessage.createdAt), asc(agentTestMessage.id));
    const messages: ConversationMessage[] = rows
      // Resposta do agente que não chegou (pendente ou falha) não é resposta para analisar.
      .filter((row) => row.role === 'USER' || ['ANSWERED', 'DELIVERED'].includes(row.status))
      .map((row) => ({
        id: row.id,
        role: row.role === 'AGENT' ? 'AGENT' : 'CUSTOMER',
        text: row.text,
        at: row.createdAt.toISOString(),
        hasAttachment: false,
      }));
    return lastMessages(messages);
  }

  // Reais -----------------------------------------------------------------------------------

  /**
   * O GPTMaker lista o workspace inteiro (todos os tenants) e não documenta a ordem. Cada pedido
   * lê até `MAX_LIST_PAGES` páginas a partir do cursor, fica só com os chats reais do tenant e do
   * agente, e para quando junta uma página; `nextCursor` é a próxima página do GPTMaker.
   */
  private async listReal(scope: ScopeWithAgent, cursor: number): Promise<ConversationList> {
    const found = new Map<string, ConversationSummary>();
    const seenIds = new Set<string>();
    let stale = 0;
    // O cursor da tela começa em 0; a paginação do GPTMaker é 1-based (a página 0 repete a 1).
    let page = cursor + 1;
    let exhausted = false;
    try {
      for (let read = 0; read < MAX_LIST_PAGES && found.size < CONVERSATIONS_PAGE_SIZE; read++) {
        const chats = await this.gptmaker.listChats({
          agentId: scope.gptmakerAgentId,
          page,
          pageSize: GPTMAKER_PAGE_SIZE,
        });
        page += 1;
        if (chats.length === 0) {
          exhausted = true;
          break;
        }
        // Páginas que só repetem chats já vistos (a API pode ignorar `page`) encerram a lista, mas
        // só depois de duas seguidas, por tolerância a uma repetição isolada.
        const fresh = chats.filter((chat) => !seenIds.has(chat.id));
        for (const chat of chats) seenIds.add(chat.id);
        stale = fresh.length === 0 ? stale + 1 : 0;
        if (stale >= 2) {
          exhausted = true;
          break;
        }
        for (const chat of fresh) {
          if (classifyChat(chat, scope) === 'REAL') found.set(chat.id, summaryOf(chat, scope));
        }
      }
    } catch (error) {
      throw this.failure(error, false);
    }
    const conversations = [...found.values()].sort(
      (a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id),
    );
    return { conversations, nextCursor: exhausted ? null : page - 1 };
  }

  private async realMessages(
    scope: ScopeWithAgent,
    conversationId: string,
  ): Promise<ConversationMessages> {
    // O id vem do cliente: só vale o chat REAL deste tenant e deste agente (design D4).
    if (classifyChat({ id: conversationId }, scope) !== 'REAL') throw notFound();
    try {
      const seen = new Map<string, ConversationMessage & { order: number }>();
      let capped = true;
      // Páginas 1-based: a página 1 é o bloco mais recente e as seguintes vão para trás; dentro de
      // cada página a ordem é crescente. Uma página pode vir com menos itens que `pageSize` sem ser
      // a última, então só a vazia (ou repetida) encerra a leitura.
      for (let page = 1; page <= MAX_MESSAGE_PAGES; page++) {
        const items = await this.gptmaker.listChatMessages(conversationId, {
          page,
          pageSize: GPTMAKER_PAGE_SIZE,
        });
        const before = seen.size;
        for (const item of items) {
          if (seen.has(item.id)) continue;
          // Avisos do sistema (transferência, etc.) são `NOTIFICATION`: não são fala de ninguém e
          // gastariam o limite de mensagens da análise.
          if (item.type === 'NOTIFICATION') continue;
          const text = (item.text ?? '').trim();
          const at = normalizeTime(item.time);
          seen.set(item.id, {
            id: item.id,
            role: normalizeRole(item.role),
            text,
            at: at ? at.toISOString() : null,
            hasAttachment: Boolean(
              item.imageUrl || item.audioUrl || item.documentUrl || item.fileName,
            ),
            order: seen.size,
          });
        }
        // Vazia, ou repetida (a API pode ignorar `page`): não há mais nada novo.
        if (items.length === 0 || seen.size === before) {
          capped = false;
          break;
        }
      }
      if (capped) this.logger.warn({ pages: MAX_MESSAGE_PAGES }, 'conversa lida até o limite');
      const ordered = [...seen.values()]
        .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.order - b.order)
        // Mensagem sem texto (só mídia) fica, marcada; vazia e sem mídia não ajuda a análise.
        .filter((message) => message.text !== '' || message.hasAttachment)
        .map(({ order: _order, ...message }) => message);
      return lastMessages(ordered);
    } catch (error) {
      throw this.failure(error, true);
    }
  }

  /**
   * Erro do GPTMaker → erro de domínio. Ao ler as mensagens de um chat, 404 é conversa inexistente;
   * ao listar, 404 não é sobre uma conversa e vira indisponibilidade como os demais.
   */
  private failure(error: unknown, notFoundMeansConversation: boolean): unknown {
    if (error instanceof DomainError) return error;
    if (error instanceof GptMakerError) {
      if (notFoundMeansConversation && error.kind === 'NOT_FOUND') return notFound();
      this.logger.warn(
        { operation: error.operation, kind: error.kind },
        'leitura de conversas falhou',
      );
      return unavailable();
    }
    return error;
  }
}

type ScopeWithAgent = ChatScope;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scopeOf(agent: Agent): ScopeWithAgent {
  return { gptmakerAgentId: agent.gptmakerAgentId, tenantId: agent.tenantId };
}

function summaryOf(chat: GptMakerChat, scope: ScopeWithAgent): ConversationSummary {
  const at = normalizeTime(chat.time ?? chat.createdAt);
  return {
    id: chat.id,
    source: 'REAL',
    title: (chat.title ?? chat.name ?? '').trim() || dialogLabel(chat.id, scope),
    at: at ? at.toISOString() : null,
    messageCount: null,
  };
}

/** Rótulo de reserva quando o chat não tem título: o diálogo do portal. */
function dialogLabel(chatId: string, scope: ScopeWithAgent): string {
  return chatId.slice(`public-api-${scope.gptmakerAgentId}-${scope.tenantId}:`.length);
}

function lastMessages(messages: ConversationMessage[]): ConversationMessages {
  const omitted = Math.max(0, messages.length - CONVERSATION_MAX_MESSAGES);
  return { messages: messages.slice(omitted), omitted };
}
