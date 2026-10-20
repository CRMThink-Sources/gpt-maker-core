import { randomBytes, randomUUID } from 'node:crypto';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentTestService, type Tester } from '../../src/modules/agent-test/agent-test.service';
import { TestConversations } from '../../src/modules/agent-test/test-conversations';
import type { BalanceReader } from '../../src/modules/billing/balance.reader';
import type { UsageResponseEvent } from '../../src/modules/billing/usage-debit.consumer';
import type { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerError } from '../../src/modules/gptmaker/gptmaker.errors';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import type { Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { EXCHANGES, USAGE_EVENTS } from '../../src/shared/messaging/topology';

const { agent, agentTestConversation, agentTestMessage, aiModel, tenant } = schema;

// Teste do agente dentro do app (spec agent-test-chat; tarefas 2.1 a 2.3).
describe('teste do agente', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let service: AgentTestService;
  let simulated: TestConversations;
  let tester: Tester;
  let agentId: string;
  let modelId: string;

  let balance = 100;
  const sent: Array<{ agentId: string; input: Record<string, unknown> }> = [];
  let reply: string | Error = 'Olá! Como posso ajudar?';
  const published: Array<{ exchange: string; routingKey: string; event: UsageResponseEvent }> = [];

  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { code?: string; getStatus?: () => number }) => ({
        code: error.code,
        status: error.getStatus?.(),
      }),
    );

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const gptmaker = {
      sendMessage: async (id: string, input: Record<string, unknown>) => {
        sent.push({ agentId: id, input });
        if (reply instanceof Error) throw reply;
        return { message: reply };
      },
    } as unknown as GptMakerClient;
    const balances = { total: async () => balance } as unknown as BalanceReader;
    const amqp = {
      publish: async (exchange: string, routingKey: string, event: UsageResponseEvent) => {
        published.push({ exchange, routingKey, event });
      },
    } as unknown as AmqpConnection;
    const database = db as unknown as Database;
    service = new AgentTestService(gptmaker, balances, amqp, database, redis);
    simulated = new TestConversations(database);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 2 })
      .returning();
    modelId = model!.id;
  });

  async function newAgent(tenantId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomBytes(4).toString('hex')}`,
        name: 'Bruna',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
        status,
      })
      .returning();
    return row!;
  }

  async function newTenant() {
    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    return row!;
  }

  beforeEach(async () => {
    balance = 100;
    reply = 'Olá! Como posso ajudar?';
    sent.length = 0;
    published.length = 0;
    await redis.flushall();
    const t = await newTenant();
    tester = { tenantId: t.id, tenantStatus: 'ACTIVE', userId: '7', userName: 'Ana' };
    agentId = (await newAgent(t.id)).id;
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('cria conversa com contexto próprio e cliente simulado opcional', async () => {
    const plain = await service.create(tester, agentId, {});
    expect(plain).toMatchObject({ client: null, createdByName: 'Ana', messages: [] });
    const withClient = await service.create(tester, agentId, {
      client: { type: 'contact', id: 12, name: 'Maria Souza' },
    });
    expect(withClient.client).toEqual({ type: 'contact', id: 12, name: 'Maria Souza' });

    const rows = await db.select().from(agentTestConversation);
    expect(new Set(rows.map((row) => row.contextId)).size).toBe(2);
    expect(rows.every((row) => row.contextId === `${tester.tenantId}:test-${row.id}`)).toBe(true);
    expect(await simulated.simulatedClient(tester.tenantId, withClient.id)).toEqual({
      type: 'contact',
      id: 12,
    });
    expect(await simulated.simulatedClient(randomUUID(), withClient.id)).toBeNull();
  });

  it('conversa: pergunta e resposta gravadas, contexto da conversa e débito publicado', async () => {
    const conversation = await service.create(tester, agentId, {});
    const exchange = await service.send(tester, agentId, conversation.id, {
      text: 'Quais planos vocês têm?',
    });
    expect(exchange).toMatchObject({
      message: { role: 'USER', text: 'Quais planos vocês têm?', status: 'ANSWERED' },
      reply: { role: 'AGENT', text: 'Olá! Como posso ajudar?', status: 'DELIVERED' },
    });
    expect(sent[0]!.input).toEqual({
      contextId: `${tester.tenantId}:test-${conversation.id}`,
      chatName: 'Teste — Ana',
      prompt: 'Quais planos vocês têm?',
    });
    expect(published).toEqual([
      {
        exchange: EXCHANGES.usageEvents,
        routingKey: USAGE_EVENTS.response,
        event: expect.objectContaining({
          messageId: `test:${conversation.id}:${exchange.message.id}`,
          tenantId: tester.tenantId,
          agentId,
          dialogId: `test-${conversation.id}`,
          modelCode: 'GPT_5_MINI',
          source: 'test',
        }),
      },
    ]);

    const view = await service.get(tester, agentId, conversation.id);
    expect(view.messages.map((m) => [m.role, m.text])).toEqual([
      ['USER', 'Quais planos vocês têm?'],
      ['AGENT', 'Olá! Como posso ajudar?'],
    ]);
    const [summary] = await service.list(tester, agentId);
    expect(summary).toMatchObject({ id: conversation.id, lastMessage: 'Olá! Como posso ajudar?' });
  });

  it('GPTMaker falha: pergunta marcada como não respondida, erro recuperável, sem débito', async () => {
    const conversation = await service.create(tester, agentId, {});
    reply = new GptMakerError('UNAVAILABLE', 'agent.conversation', 'timeout');
    expect(await errorOf(service.send(tester, agentId, conversation.id, { text: 'Oi' }))).toEqual({
      code: 'TEST_REPLY_FAILED',
      status: 503,
    });
    const [message] = await db
      .select()
      .from(agentTestMessage)
      .where(eq(agentTestMessage.conversationId, conversation.id));
    expect(message).toMatchObject({ role: 'USER', status: 'FAILED' });
    expect(published).toEqual([]);
  });

  it('sem saldo: recusa sem chamar o GPTMaker', async () => {
    const conversation = await service.create(tester, agentId, {});
    balance = 0;
    expect(await errorOf(service.send(tester, agentId, conversation.id, { text: 'Oi' }))).toEqual({
      code: 'NO_CREDIT',
      status: 422,
    });
    expect(sent).toEqual([]);
  });

  it('resposta anterior em andamento: recusa a segunda mensagem', async () => {
    const conversation = await service.create(tester, agentId, {});
    await redis.set(`lock:agent-test:${conversation.id}`, 'outro', 'PX', 60_000);
    expect(await errorOf(service.send(tester, agentId, conversation.id, { text: 'Oi' }))).toEqual({
      code: 'TEST_REPLY_PENDING',
      status: 409,
    });
    expect(sent).toEqual([]);
  });

  it('agente inativo: não cria nem envia', async () => {
    const conversation = await service.create(tester, agentId, {});
    await db.update(agent).set({ status: 'INACTIVE' }).where(eq(agent.id, agentId));
    expect((await errorOf(service.create(tester, agentId, {})))?.code).toBe('AGENT_NOT_ACTIVE');
    expect(
      (await errorOf(service.send(tester, agentId, conversation.id, { text: 'Oi' })))?.code,
    ).toBe('AGENT_NOT_ACTIVE');
    // Histórico continua acessível.
    await expect(service.get(tester, agentId, conversation.id)).resolves.toHaveProperty('id');
  });

  it('isolamento: outro tenant e outro agente não enxergam a conversa', async () => {
    const conversation = await service.create(tester, agentId, {});
    const other = await newTenant();
    const intruder: Tester = { ...tester, tenantId: other.id };
    const otherAgent = await newAgent(other.id);
    expect((await errorOf(service.get(intruder, agentId, conversation.id)))?.status).toBe(404);
    expect((await errorOf(service.get(intruder, otherAgent.id, conversation.id)))?.status).toBe(
      404,
    );
    const sibling = await newAgent(tester.tenantId);
    expect((await errorOf(service.get(tester, sibling.id, conversation.id)))?.status).toBe(404);
    expect((await errorOf(service.remove(intruder, agentId, conversation.id)))?.status).toBe(404);
  });

  it('excluir apaga a conversa e as mensagens', async () => {
    const conversation = await service.create(tester, agentId, {});
    await service.send(tester, agentId, conversation.id, { text: 'Oi' });
    await service.remove(tester, agentId, conversation.id);
    expect(await service.list(tester, agentId)).toEqual([]);
    expect(
      await db
        .select()
        .from(agentTestMessage)
        .where(eq(agentTestMessage.conversationId, conversation.id)),
    ).toEqual([]);
  });

  it('limite de 50 conversas por agente: a mais antiga sai', async () => {
    const first = await service.create(tester, agentId, {});
    await db
      .update(agentTestConversation)
      .set({ lastMessageAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(agentTestConversation.id, first.id));
    for (let i = 0; i < 50; i++) await service.create(tester, agentId, {});
    const list = await service.list(tester, agentId);
    expect(list).toHaveLength(50);
    expect(list.map((item) => item.id)).not.toContain(first.id);
  });
});
