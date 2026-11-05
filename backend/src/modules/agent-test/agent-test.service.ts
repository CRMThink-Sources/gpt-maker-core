import { randomUUID } from 'node:crypto';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AGENT_TEST_CONVERSATIONS_MAX,
  type NewTestConversationInput,
  newTestConversationSchema,
  type TestConversationSummary,
  type TestConversationView,
  type TestExchangeView,
  type TestMessageInput,
  testMessageInputSchema,
  type TestMessageView,
} from '@gptmaker/contracts';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { Counter } from 'prom-client';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  agentTestConversation,
  agentTestMessage,
  aiModel,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { EXCHANGES, USAGE_EVENTS } from '../../shared/messaging/topology';
import { metricsRegistry } from '../../shared/metrics/metrics';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { BalanceReader, type UsageResponseEvent } from '../billing';
import { GptMakerClient, GptMakerError } from '../gptmaker';
import { newTestDialogKey, testContextId, testDialogOf } from './test-dialog';

type Conversation = typeof agentTestConversation.$inferSelect;
type Message = typeof agentTestMessage.$inferSelect;

/** Quem testa: o usuário da sessão, no tenant dela. */
export interface Tester {
  tenantId: string;
  tenantStatus: string;
  userId: string;
  userName: string;
}

/** Cobre a espera do GPTMaker (60 s no canal) com folga. */
const LOCK_TTL_MS = 90_000;
const SNIPPET = 120;

const messages = new Counter({
  name: 'agent_test_messages_total',
  help: 'Mensagens enviadas no teste do agente, por resultado',
  labelNames: ['outcome'],
  registers: [metricsRegistry],
});

const notFound = () =>
  new DomainError(
    'TEST_CONVERSATION_NOT_FOUND',
    'Conversa de teste não encontrada',
    HttpStatus.NOT_FOUND,
  );

/**
 * Teste do agente dentro do app (spec agent-test-chat, design T1–T4): conversas com contexto
 * próprio no GPTMaker, envio síncrono com trava por conversa e gate de saldo, débito da resposta
 * pelo mesmo `usage.response` do canal (`source: 'test'`).
 */
@Injectable()
export class AgentTestService {
  private readonly logger = new Logger(AgentTestService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly gptmaker: GptMakerClient,
    private readonly balance: BalanceReader,
    private readonly amqp: AmqpConnection,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  async list(tester: Tester, agentId: string): Promise<TestConversationSummary[]> {
    const owner = await this.agentOf(tester, agentId);
    const rows = await this.db
      .select()
      .from(agentTestConversation)
      .where(eq(agentTestConversation.agentId, owner.id))
      .orderBy(desc(agentTestConversation.lastMessageAt));
    const last = await this.lastMessages(rows.map((row) => row.id));
    return rows.map((row) => summary(row, last.get(row.id) ?? null));
  }

  async create(
    tester: Tester,
    agentId: string,
    raw: NewTestConversationInput,
  ): Promise<TestConversationView> {
    const input = newTestConversationSchema.parse(raw);
    const owner = await this.agentOf(tester, agentId, { mustBeActive: true });
    const id = randomUUID();
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(agentTestConversation)
        .values({
          id,
          tenantId: tester.tenantId,
          agentId: owner.id,
          contextId: testContextId(tester.tenantId, newTestDialogKey()),
          clientType: input.client?.type ?? null,
          clientId: input.client?.id ?? null,
          clientName: input.client?.name ?? null,
          createdByUserId: tester.userId,
          createdByName: tester.userName,
        })
        .returning();
      // Limite por agente: as mais antigas além do limite saem (mensagens em cascata).
      const keep = await tx
        .select({ id: agentTestConversation.id })
        .from(agentTestConversation)
        .where(eq(agentTestConversation.agentId, owner.id))
        .orderBy(desc(agentTestConversation.lastMessageAt), desc(agentTestConversation.createdAt))
        .limit(AGENT_TEST_CONVERSATIONS_MAX);
      await tx.delete(agentTestConversation).where(
        and(
          eq(agentTestConversation.agentId, owner.id),
          notInArray(
            agentTestConversation.id,
            keep.map((item) => item.id),
          ),
        ),
      );
      return created!;
    });
    return { ...summary(row, null), messages: [] };
  }

  async get(tester: Tester, agentId: string, id: string): Promise<TestConversationView> {
    const owner = await this.agentOf(tester, agentId);
    const row = await this.conversationOf(tester, owner.id, id);
    const rows = await this.db
      .select()
      .from(agentTestMessage)
      .where(eq(agentTestMessage.conversationId, row.id))
      .orderBy(agentTestMessage.createdAt);
    return {
      ...summary(row, rows.at(-1) ?? null),
      messages: rows.map(messageView),
    };
  }

  async remove(tester: Tester, agentId: string, id: string): Promise<void> {
    const owner = await this.agentOf(tester, agentId);
    const row = await this.conversationOf(tester, owner.id, id);
    // O GPTMaker não tem rota para apagar o contexto; o id nunca é reutilizado (design T2).
    await this.db.delete(agentTestConversation).where(eq(agentTestConversation.id, row.id));
  }

  async send(
    tester: Tester,
    agentId: string,
    id: string,
    raw: TestMessageInput,
  ): Promise<TestExchangeView> {
    const input = testMessageInputSchema.parse(raw);
    const owner = await this.agentOf(tester, agentId, { mustBeActive: true });
    const conversation = await this.conversationOf(tester, owner.id, id);
    const outcome = await this.lock.runExclusive(`agent-test:${conversation.id}`, LOCK_TTL_MS, () =>
      this.exchange(tester, owner, conversation, input.text),
    );
    if (!outcome.ran) {
      messages.inc({ outcome: 'busy' });
      throw new DomainError(
        'TEST_REPLY_PENDING',
        'O agente ainda está respondendo a mensagem anterior',
        HttpStatus.CONFLICT,
      );
    }
    return outcome.result;
  }

  private async exchange(
    tester: Tester,
    owner: { id: string; gptmakerAgentId: string; modelCode: string },
    conversation: Conversation,
    text: string,
  ): Promise<TestExchangeView> {
    if ((await this.balance.total(tester.tenantId)) <= 0) {
      messages.inc({ outcome: 'no-credit' });
      throw new DomainError(
        'NO_CREDIT',
        'Seus créditos de IA acabaram. Adicione créditos para continuar testando o agente.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const [question] = await this.db
      .insert(agentTestMessage)
      .values({ conversationId: conversation.id, role: 'USER', text, status: 'PENDING' })
      .returning();
    await this.touch(conversation.id);

    const started = Date.now();
    let replyText: string;
    try {
      const response = await this.gptmaker.sendMessage(owner.gptmakerAgentId, {
        contextId: conversation.contextId,
        chatName: `Teste — ${tester.userName}`.slice(0, 120),
        prompt: text,
      });
      replyText = (response.message ?? '').trim();
      if (!replyText) throw new Error('resposta sem texto');
    } catch (error) {
      await this.db
        .update(agentTestMessage)
        .set({ status: 'FAILED' })
        .where(eq(agentTestMessage.id, question!.id));
      messages.inc({ outcome: 'failed' });
      this.logger.warn(
        { conversationId: conversation.id, durationMs: Date.now() - started, err: error },
        'agente não respondeu no teste',
      );
      throw new DomainError(
        'TEST_REPLY_FAILED',
        error instanceof GptMakerError && error.kind === 'UNAVAILABLE'
          ? 'O agente demorou demais para responder. Tente de novo.'
          : 'O agente não respondeu agora. Tente de novo.',
        HttpStatus.SERVICE_UNAVAILABLE,
        { messageId: question!.id },
      );
    }

    const [answered] = await this.db
      .update(agentTestMessage)
      .set({ status: 'ANSWERED' })
      .where(eq(agentTestMessage.id, question!.id))
      .returning();
    const [reply] = await this.db
      .insert(agentTestMessage)
      .values({
        conversationId: conversation.id,
        role: 'AGENT',
        text: replyText,
        status: 'DELIVERED',
        modelCode: owner.modelCode,
      })
      .returning();
    await this.touch(conversation.id);
    await this.publishUsage(tester, owner, conversation, question!.id);
    messages.inc({ outcome: 'answered' });
    this.logger.log(
      { conversationId: conversation.id, durationMs: Date.now() - started },
      'resposta de teste entregue',
    );
    return { message: messageView(answered!), reply: messageView(reply!) };
  }

  /** Mesmo evento do canal: o débito é idempotente pela mensagem (design T4). */
  private async publishUsage(
    tester: Tester,
    owner: { id: string; modelCode: string },
    conversation: Conversation,
    questionId: string,
  ): Promise<void> {
    const event: UsageResponseEvent = {
      messageId: `test:${conversation.id}:${questionId}`,
      tenantId: tester.tenantId,
      agentId: owner.id,
      dialogId: testDialogOf(conversation.contextId),
      modelCode: owner.modelCode,
      replyMessageId: null,
      respondedAt: new Date().toISOString(),
      source: 'test',
    };
    try {
      await this.amqp.publish(EXCHANGES.usageEvents, USAGE_EVENTS.response, event, {
        persistent: true,
        messageId: event.messageId,
      });
    } catch (error) {
      // A resposta já foi entregue; a reconciliação diária cobra o que faltar.
      this.logger.error(
        { alert: true, messageId: event.messageId, err: error },
        'consumo da resposta de teste não publicado',
      );
    }
  }

  private async agentOf(
    tester: Tester,
    agentId: string,
    options: { mustBeActive?: boolean } = {},
  ): Promise<{ id: string; gptmakerAgentId: string; modelCode: string; status: string }> {
    if (!/^[\da-f-]{36}$/i.test(agentId)) throw agentNotFound();
    const [row] = await this.db
      .select({
        id: agent.id,
        gptmakerAgentId: agent.gptmakerAgentId,
        status: agent.status,
        modelCode: aiModel.code,
      })
      .from(agent)
      .innerJoin(aiModel, eq(aiModel.id, agent.modelId))
      .where(
        and(eq(agent.id, agentId), eq(agent.tenantId, tester.tenantId), isNull(agent.deletedAt)),
      );
    if (!row) throw agentNotFound();
    if (options.mustBeActive && (row.status !== 'ACTIVE' || tester.tenantStatus !== 'ACTIVE')) {
      throw new DomainError(
        'AGENT_NOT_ACTIVE',
        'O agente precisa estar ativo para ser testado',
        HttpStatus.CONFLICT,
      );
    }
    return row;
  }

  private async conversationOf(tester: Tester, agentId: string, id: string): Promise<Conversation> {
    if (!/^[\da-f-]{36}$/i.test(id)) throw notFound();
    const [row] = await this.db
      .select()
      .from(agentTestConversation)
      .where(
        and(
          eq(agentTestConversation.id, id),
          eq(agentTestConversation.agentId, agentId),
          eq(agentTestConversation.tenantId, tester.tenantId),
        ),
      );
    if (!row) throw notFound();
    return row;
  }

  private async touch(conversationId: string): Promise<void> {
    await this.db
      .update(agentTestConversation)
      .set({ lastMessageAt: new Date() })
      .where(eq(agentTestConversation.id, conversationId));
  }

  /** Última mensagem de cada conversa (para o trecho da lista). */
  private async lastMessages(ids: string[]): Promise<Map<string, Message>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .selectDistinctOn([agentTestMessage.conversationId])
      .from(agentTestMessage)
      .where(inArray(agentTestMessage.conversationId, ids))
      .orderBy(agentTestMessage.conversationId, sql`${agentTestMessage.createdAt} desc`);
    return new Map(rows.map((row) => [row.conversationId, row]));
  }
}

const agentNotFound = () =>
  new DomainError('AGENT_NOT_FOUND', 'Agente não encontrado', HttpStatus.NOT_FOUND);

function summary(row: Conversation, last: Message | null): TestConversationSummary {
  return {
    id: row.id,
    client:
      row.clientType && row.clientId
        ? { type: row.clientType, id: row.clientId, name: row.clientName ?? '' }
        : null,
    createdByName: row.createdByName,
    lastMessage: last ? last.text.slice(0, SNIPPET) : null,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function messageView(row: Message): TestMessageView {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
