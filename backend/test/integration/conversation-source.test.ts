import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { ConversationSourceService } from '../../src/modules/function-review/conversation-source.service';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';
import { WireMock } from '../support/wiremock';

const { agent, agentTestConversation, agentTestMessage, aiModel, tenant } = schema;

// Conversas do agente para a análise de alucinação (spec agent-hallucination-analysis; tarefa 3.1).
describe('conversas do agente para análise', () => {
  let postgres: StartedPostgreSqlContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: ConversationSourceService;
  let modelId: string;

  const errorOf = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

  async function newTenantAgent(gptmakerAgentId = `gm-${randomBytes(3).toString('hex')}`) {
    const code = randomBytes(3).toString('hex');
    const [owner] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner!.id,
        gptmakerAgentId,
        name: 'Atendente',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return { tenantId: owner!.id, agentId: row!.id, gptmakerAgentId };
  }

  async function addAgent(tenantId: string, gptmakerAgentId: string) {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId,
        name: 'Outro',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return row!.id;
  }

  async function addTest(
    owner: { tenantId: string; agentId: string },
    values: Partial<typeof agentTestConversation.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(agentTestConversation)
      .values({
        tenantId: owner.tenantId,
        agentId: owner.agentId,
        contextId: `${owner.tenantId}:t-${randomBytes(5).toString('hex')}`,
        createdByUserId: '1',
        createdByName: 'Maria',
        ...values,
      })
      .returning();
    return row!;
  }

  const addMessage = (
    conversationId: string,
    role: 'USER' | 'AGENT',
    text: string,
    status: 'PENDING' | 'ANSWERED' | 'FAILED' | 'DELIVERED' = 'ANSWERED',
    createdAt = new Date(),
  ) =>
    db
      .insert(agentTestMessage)
      .values({ conversationId, role, text, status, createdAt })
      .returning()
      .then(([row]) => row!);

  const chatId = (owner: { tenantId: string; gptmakerAgentId: string }, dialog: string) =>
    `public-api-${owner.gptmakerAgentId}-${owner.tenantId}:${dialog}`;

  const chat = (
    owner: { tenantId: string; gptmakerAgentId: string },
    dialog: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id: chatId(owner, dialog),
    recipient: `${owner.tenantId}:${dialog}`,
    type: 'API',
    ...extra,
  });

  const stubChats = (pages: unknown[][]) =>
    Promise.all(
      pages.map((body, page) =>
        wiremock.stub({
          request: {
            method: 'GET',
            urlPath: '/v2/workspace/ws-test/chats',
            queryParameters: { page: { equalTo: String(page) } },
          },
          response: { status: 200, jsonBody: body },
        }),
      ),
    );

  const stubMessages = (id: string, body: unknown[], status = 200) =>
    wiremock.stub({
      request: { method: 'GET', urlPath: `/v2/chat/${encodeURIComponent(id)}/messages` },
      response: { status, jsonBody: status === 200 ? body : { error: 'x' } },
    });

  const messageRequests = async () => {
    const res = await fetch(`${wiremock.baseUrl}/__admin/requests/count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'GET', urlPathPattern: '/v2/chat/.*' }),
    });
    return ((await res.json()) as { count: number }).count;
  };

  beforeAll(async () => {
    [postgres, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      WireMock.start(),
    ]);
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    const client = new GptMakerClient(
      {
        baseUrl: `${wiremock.baseUrl}/v2`,
        token: 't',
        workspaceId: 'ws-test',
        timeoutMs: 5000,
        conversationTimeoutMs: 5000,
      },
      new GptMakerResilience({
        maxAttempts: 1,
        breakerThreshold: 50,
        halfOpenAfterMs: 1000,
        beforeAttempt: async () => {},
      }),
    );
    service = new ConversationSourceService(db, new AgentRepository(db), client);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await db.delete(agentTestMessage);
    await db.delete(agentTestConversation);
    await db.delete(agent);
  });

  afterAll(async () => {
    await pool?.end();
    await Promise.all([postgres?.stop(), wiremock?.stop()]);
  });

  describe('conversas de teste', () => {
    it('lista só as do agente e do tenant, da mais recente para a mais antiga, com a contagem', async () => {
      const owner = await newTenantAgent();
      const other = await newTenantAgent();
      const sameTenantOtherAgent = await addAgent(owner.tenantId, 'gm-outro');
      const old = await addTest(owner, { lastMessageAt: new Date('2026-01-01') });
      const recent = await addTest(owner, {
        lastMessageAt: new Date('2026-02-01'),
        clientName: 'Acme',
      });
      await addTest(other);
      await addTest({ tenantId: owner.tenantId, agentId: sameTenantOtherAgent });
      await addMessage(recent.id, 'USER', 'oi');
      await addMessage(recent.id, 'AGENT', 'olá');

      const result = await service.list(owner.tenantId, owner.agentId, 'TEST', 0);

      expect(result.conversations.map((c) => c.id)).toEqual([recent.id, old.id]);
      expect(result.conversations[0]).toMatchObject({
        source: 'TEST',
        title: 'Maria · Acme',
        messageCount: 2,
      });
      expect(result.conversations[1]).toMatchObject({ title: 'Maria', messageCount: 0 });
      expect(result.nextCursor).toBeNull();
    });

    it('pagina por cursor: 25 conversas viram 20 e depois 5', async () => {
      const owner = await newTenantAgent();
      for (let i = 0; i < 25; i++) {
        await addTest(owner, { lastMessageAt: new Date(2026, 0, 1, 0, i) });
      }

      const first = await service.list(owner.tenantId, owner.agentId, 'TEST', 0);
      const second = await service.list(owner.tenantId, owner.agentId, 'TEST', first.nextCursor!);

      expect(first.conversations).toHaveLength(20);
      expect(first.nextCursor).toBe(20);
      expect(second.conversations).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      const ids = [...first.conversations, ...second.conversations].map((c) => c.id);
      expect(new Set(ids).size).toBe(25);
    });

    it('lê as mensagens em ordem, sem a resposta do agente que não chegou', async () => {
      const owner = await newTenantAgent();
      const conversation = await addTest(owner);
      const t = (n: number) => new Date(2026, 0, 1, 0, n);
      await addMessage(conversation.id, 'USER', 'quanto custa?', 'ANSWERED', t(1));
      await addMessage(conversation.id, 'AGENT', 'R$ 10', 'ANSWERED', t(2));
      await addMessage(conversation.id, 'USER', 'e o prazo?', 'ANSWERED', t(3));
      await addMessage(conversation.id, 'AGENT', 'falha', 'FAILED', t(4));

      const result = await service.messages(owner.tenantId, owner.agentId, 'TEST', conversation.id);

      expect(result.messages.map((m) => [m.role, m.text])).toEqual([
        ['CUSTOMER', 'quanto custa?'],
        ['AGENT', 'R$ 10'],
        ['CUSTOMER', 'e o prazo?'],
      ]);
      expect(result.omitted).toBe(0);
    });

    it('conversa de outro tenant, de outro agente do tenant e id inválido não existem', async () => {
      const owner = await newTenantAgent();
      const other = await newTenantAgent();
      const otherAgentId = await addAgent(owner.tenantId, 'gm-outro');
      const foreign = await addTest(other);
      const sibling = await addTest({ tenantId: owner.tenantId, agentId: otherAgentId });

      for (const id of [foreign.id, sibling.id, 'não-é-uuid', randomUUID()]) {
        const error = await errorOf(service.messages(owner.tenantId, owner.agentId, 'TEST', id));
        expect(error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 });
      }
    });

    it('agente de outro tenant responde como inexistente', async () => {
      const owner = await newTenantAgent();
      const other = await newTenantAgent();
      const error = await errorOf(service.list(other.tenantId, owner.agentId, 'TEST', 0));
      expect(error).toMatchObject({ status: 404 });
    });
  });

  describe('conversas reais (GPTMaker)', () => {
    it('lista só as reais do tenant e do agente, sem teste, sem outro tenant e sem outro agente', async () => {
      const owner = await newTenantAgent('gm-a');
      const other = await newTenantAgent('gm-b');
      await stubChats([
        [
          chat(owner, 'chat1', { title: 'Cliente João', time: 1_700_000_100 }),
          chat(owner, 't-0123456789', { title: 'Teste — Maria' }),
          chat(other, 'chat9', { title: 'Cliente de outro tenant' }),
          chat({ ...owner, gptmakerAgentId: 'gm-zzz' }, 'chat2', { title: 'Outro agente' }),
          chat(owner, 'chat3', { time: 1_700_000_500 }),
        ],
        [],
      ]);

      const result = await service.list(owner.tenantId, owner.agentId, 'REAL', 0);

      expect(result.conversations.map((c) => [c.id, c.title])).toEqual([
        [chatId(owner, 'chat3'), 'chat3'],
        [chatId(owner, 'chat1'), 'Cliente João'],
      ]);
      expect(result.conversations.every((c) => c.source === 'REAL')).toBe(true);
      expect(result.conversations[0]!.at).toBe(new Date(1_700_000_500_000).toISOString());
      expect(result.nextCursor).toBeNull();
    });

    it('junta uma página do cliente e devolve o cursor da próxima página do GPTMaker', async () => {
      const owner = await newTenantAgent('gm-a');
      const many = Array.from({ length: 25 }, (_, i) =>
        chat(owner, `c${i}`, { time: 1_700_000_000 + i }),
      );
      await stubChats([many, [chat(owner, 'c99')], []]);

      const first = await service.list(owner.tenantId, owner.agentId, 'REAL', 0);

      expect(first.conversations).toHaveLength(25);
      expect(first.nextCursor).toBe(1);
      const second = await service.list(owner.tenantId, owner.agentId, 'REAL', first.nextCursor!);
      expect(second.conversations.map((c) => c.id)).toEqual([chatId(owner, 'c99')]);
    });

    it('procura nas páginas seguintes quando a primeira só tem chats de outros tenants', async () => {
      const owner = await newTenantAgent('gm-a');
      const other = await newTenantAgent('gm-a2');
      await stubChats([[chat(other, 'x1'), chat(other, 'x2')], [chat(owner, 'meu')], []]);

      const result = await service.list(owner.tenantId, owner.agentId, 'REAL', 0);

      expect(result.conversations.map((c) => c.id)).toEqual([chatId(owner, 'meu')]);
    });

    it('API que ignora a página e repete a lista não trava: acaba', async () => {
      const owner = await newTenantAgent('gm-a');
      await wiremock.stub({
        request: { method: 'GET', urlPath: '/v2/workspace/ws-test/chats' },
        response: { status: 200, jsonBody: [chat(owner, 'chat1')] },
      });

      const result = await service.list(owner.tenantId, owner.agentId, 'REAL', 0);

      expect(result.conversations).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('API com página começando em 1 (a 0 repete a 1) não trunca a lista', async () => {
      const owner = await newTenantAgent('gm-a');
      const first = Array.from({ length: 12 }, (_, i) =>
        chat(owner, `a${i}`, { time: 1_700_000_000 + i }),
      );
      const second = Array.from({ length: 12 }, (_, i) =>
        chat(owner, `b${i}`, { time: 1_700_001_000 + i }),
      );
      // Página 0 e 1 devolvem o mesmo conteúdo; a 2 traz chats novos.
      await stubChats([first, first, second, []]);

      const result = await service.list(owner.tenantId, owner.agentId, 'REAL', 0);

      const ids = new Set(result.conversations.map((c) => c.id));
      expect(ids.size).toBe(24);
      expect(ids.has(chatId(owner, 'b0'))).toBe(true);
    });

    it('GPTMaker fora do ar vira CONVERSATIONS_UNAVAILABLE e as de teste continuam', async () => {
      const owner = await newTenantAgent();
      await addTest(owner);
      await wiremock.stub({
        request: { method: 'GET', urlPath: '/v2/workspace/ws-test/chats' },
        response: { status: 500, jsonBody: { error: 'x' } },
      });

      const real = await errorOf(service.list(owner.tenantId, owner.agentId, 'REAL', 0));
      const tests = await service.list(owner.tenantId, owner.agentId, 'TEST', 0);

      expect(real).toMatchObject({ code: 'CONVERSATIONS_UNAVAILABLE', status: 503 });
      expect(tests.conversations).toHaveLength(1);
    });

    it('404 do GPTMaker ao listar é indisponibilidade, não conversa inexistente', async () => {
      const owner = await newTenantAgent('gm-a');
      await wiremock.stub({
        request: { method: 'GET', urlPath: '/v2/workspace/ws-test/chats' },
        response: { status: 404, jsonBody: { error: 'x' } },
      });

      const error = await errorOf(service.list(owner.tenantId, owner.agentId, 'REAL', 0));

      expect(error).toMatchObject({ code: 'CONVERSATIONS_UNAVAILABLE', status: 503 });
    });

    it('lê as mensagens em ordem de tempo, normaliza papel e tempo, e mantém só mídia', async () => {
      const owner = await newTenantAgent('gm-a');
      const id = chatId(owner, 'chat1');
      await stubMessages(id, [
        { id: 'm3', role: 'assistant', text: 'Entregamos em 5 dias', time: 1_700_000_030 },
        { id: 'm1', role: 'user', text: 'Qual o prazo?', time: 1_700_000_010_000 },
        {
          id: 'm2',
          role: 'assistant',
          text: null,
          imageUrl: 'https://x.test/a.png',
          time: 1_700_000_020,
        },
        { id: 'm4', role: 'assistant', text: '   ', time: 1_700_000_040 },
        { id: 'm5', role: 'system', text: 'transferido', time: 1_700_000_050 },
      ]);

      const result = await service.messages(owner.tenantId, owner.agentId, 'REAL', id);

      expect(result.messages.map((m) => [m.id, m.role, m.text, m.hasAttachment])).toEqual([
        ['m1', 'CUSTOMER', 'Qual o prazo?', false],
        ['m2', 'AGENT', '', true],
        ['m3', 'AGENT', 'Entregamos em 5 dias', false],
        ['m5', 'OTHER', 'transferido', false],
      ]);
      expect(result.omitted).toBe(0);
    });

    it('conversa longa: fica com as 50 mais recentes e informa as omitidas', async () => {
      const owner = await newTenantAgent('gm-a');
      const id = chatId(owner, 'chat1');
      const items = Array.from({ length: 60 }, (_, i) => ({
        id: `m${i}`,
        role: i % 2 ? 'assistant' : 'user',
        text: `mensagem ${i}`,
        time: 1_700_000_000 + i,
      }));
      await stubMessages(id, [...items].reverse());

      const result = await service.messages(owner.tenantId, owner.agentId, 'REAL', id);

      expect(result.messages).toHaveLength(50);
      expect(result.messages[0]!.text).toBe('mensagem 10');
      expect(result.messages.at(-1)!.text).toBe('mensagem 59');
      expect(result.omitted).toBe(10);
    });

    it.each([
      ['de outro tenant', (o: Ctx, x: Ctx) => chatId({ ...o, tenantId: x.tenantId }, 'chat1')],
      [
        'de outro agente do tenant',
        (o: Ctx) => chatId({ ...o, gptmakerAgentId: 'gm-zzz' }, 'chat1'),
      ],
      ['de teste', (o: Ctx) => chatId(o, 't-0123456789')],
      ['sem prefixo', () => 'chat1'],
    ])('chat %s não existe e o GPTMaker nem é chamado', async (_nome, build) => {
      const owner = await newTenantAgent('gm-a');
      const other = await newTenantAgent('gm-b');
      const id = build(owner, other);
      await stubMessages(id, [{ id: 'm1', role: 'user', text: 'oi' }]);

      const error = await errorOf(service.messages(owner.tenantId, owner.agentId, 'REAL', id));

      expect(error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 });
      expect(await messageRequests()).toBe(0);
    });

    it('chat que o GPTMaker diz não existir vira conversa inexistente', async () => {
      const owner = await newTenantAgent('gm-a');
      const id = chatId(owner, 'apagado');
      await stubMessages(id, [], 404);

      const error = await errorOf(service.messages(owner.tenantId, owner.agentId, 'REAL', id));

      expect(error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    });

    it('falha do GPTMaker ao ler a conversa vira CONVERSATIONS_UNAVAILABLE', async () => {
      const owner = await newTenantAgent('gm-a');
      const id = chatId(owner, 'chat1');
      await stubMessages(id, [], 500);

      const error = await errorOf(service.messages(owner.tenantId, owner.agentId, 'REAL', id));

      expect(error).toMatchObject({ code: 'CONVERSATIONS_UNAVAILABLE', status: 503 });
    });
  });
});

type Ctx = { tenantId: string; gptmakerAgentId: string };
