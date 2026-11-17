import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { FunctionCatalog } from '../../src/modules/agent-functions/function-catalog.service';
import { seedAgentFunctions } from '../../src/modules/agent-functions/function-seed';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { BalanceReader } from '../../src/modules/billing/balance.reader';
import type { CreditAlerts } from '../../src/modules/billing/credit-alerts';
import { CreditStatementService } from '../../src/modules/billing/credit-statement.service';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import type { AiKeyService } from '../../src/modules/function-review/ai-key.service';
import { ConversationSourceService } from '../../src/modules/function-review/conversation-source.service';
import { FunctionTemplateReader } from '../../src/modules/function-review/function-template.reader';
import { HallucinationAnalysisService } from '../../src/modules/function-review/hallucination-analysis.service';
import { ReviewAiRunner } from '../../src/modules/function-review/review-ai.runner';
import type { GptMakerClient } from '../../src/modules/gptmaker';
import { VibecodeError, type VibecodeClient } from '../../src/modules/vibecode';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import type { Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const {
  agent,
  agentFunctionConfig,
  agentTestConversation,
  agentTestMessage,
  aiModel,
  creditLedger,
  tenant,
} = schema;

const MODEL = 'bitrix/bitrixgpt-5.5';
const PRICE = 3;

const ANSWERS = () => ({
  'base.politicas': [
    {
      itemKey: randomUUID(),
      values: { titulo: 'Pagamento', texto: 'Aceitamos só cartão de crédito.' },
    },
  ],
});

const FINDING = {
  messageRef: 'm2',
  claim: 'Entregamos em 5 dias',
  verdict: 'UNSUPPORTED',
  reason: 'Nada na base fala de prazo de entrega',
  cause: 'MISSING_IN_BASE',
  suggestion: {
    kind: 'ADD_ITEM',
    fieldId: 'base.politicas',
    item: { titulo: 'Prazo de entrega', texto: 'Entregamos em [preencher: prazo em dias]' },
  },
};
const GOOD = JSON.stringify({ findings: [FINDING] });

type Script = string | VibecodeError;

// Análise de alucinação: chave, cobrança no razão, extrato e isolamento (spec agent-hallucination-analysis).
describe('análise de alucinação de conversa', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let service: HallucinationAnalysisService;
  let statement: CreditStatementService;

  let queue: Script[];
  let chats: Array<{ apiKey: string; prompt: string }>;
  let tenantKey: string | null;
  let realChats: Record<string, Array<Record<string, unknown>>>;

  const vibecode = {
    chat: async (input: { apiKey: string; messages: Array<{ content: string }> }) => {
      chats.push({ apiKey: input.apiKey, prompt: input.messages.map((m) => m.content).join('\n') });
      const next = queue.shift() ?? GOOD;
      if (next instanceof VibecodeError) throw next;
      return { content: next };
    },
  } as unknown as VibecodeClient;
  const keys = { find: async () => tenantKey } as unknown as AiKeyService;
  const alerts = { afterDebit: async () => null } as unknown as CreditAlerts;
  const gptmaker = {
    listChats: async () => [],
    listChatMessages: async (chatId: string) => realChats[chatId] ?? [],
  } as unknown as GptMakerClient;

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const database = db as unknown as Database;
    ledger = new LedgerService(database, redis);
    statement = new CreditStatementService(database);
    await seedAgentFunctions(db, new FunctionCatalog(db));

    const env = {
      VIBECODE_REVIEW_MODEL: MODEL,
      REVIEW_CREDITS_PER_FIELD: 2,
      HALLUCINATION_CREDITS_PER_ANALYSIS: PRICE,
      VIBECODE_PLATFORM_RPM: 600,
      VIBECODE_PLATFORM_FALLBACK: true,
      VIBECODE_PLATFORM_API_KEY: 'vibe_api_plataforma',
    } as unknown as Env;
    const runner = new ReviewAiRunner(
      env,
      redis,
      keys,
      vibecode,
      new BalanceReader(database, redis),
      ledger,
      alerts,
    );
    const agents = new AgentRepository(database);
    service = new HallucinationAnalysisService(
      database,
      env,
      runner,
      new FunctionTemplateReader(database, agents, new FunctionCatalog(db)),
      new ConversationSourceService(database, agents, gptmaker),
      redis,
    );
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  beforeEach(async () => {
    queue = [];
    chats = [];
    tenantKey = null;
    realChats = {};
    await redis.flushall();
  });

  async function setup(credits = 0) {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.b24.com`,
        tenantCode: code,
      })
      .returning();
    const tenantId = row!.id;
    let [model] = await db.select().from(aiModel).limit(1);
    model ??= (
      await db
        .insert(aiModel)
        .values({
          code: 'GPT_5_MINI',
          displayName: 'GPT-5 Mini',
          creditsPerResponse: 1,
          isDefault: true,
        })
        .returning()
    )[0]!;
    const [created] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${code}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId: model.id,
        webhookTokenHash: code,
      })
      .returning();
    const published = await new FunctionCatalog(db).latestPublished('SUPPORT', tenantId);
    await db.insert(agentFunctionConfig).values({
      agentId: created!.id,
      tenantId,
      templateId: published.templateId,
      versionId: published.versionId,
    });
    if (credits) {
      await ledger.credit({
        tenantId,
        key: `${tenantId}:grant`,
        createdBy: 'teste',
        wallet: 'TRIAL',
        type: 'GRANT',
        amount: credits,
      });
    }
    return { tenantId, agentId: created!.id, gptmakerAgentId: `gm-${code}` };
  }

  /** Conversa de teste do agente com uma pergunta e duas respostas. */
  async function testConversation(owner: { tenantId: string; agentId: string }) {
    const [conversation] = await db
      .insert(agentTestConversation)
      .values({
        tenantId: owner.tenantId,
        agentId: owner.agentId,
        contextId: `${owner.tenantId}:t-${randomBytes(5).toString('hex')}`,
        createdByUserId: '1',
        createdByName: 'Maria',
      })
      .returning();
    const at = (n: number) => new Date(2026, 0, 1, 0, n);
    const [, reply] = await db
      .insert(agentTestMessage)
      .values([
        {
          conversationId: conversation!.id,
          role: 'USER',
          text: 'Qual o prazo?',
          status: 'ANSWERED',
          createdAt: at(1),
        },
        {
          conversationId: conversation!.id,
          role: 'AGENT',
          text: 'Entregamos em 5 dias.',
          status: 'ANSWERED',
          createdAt: at(2),
        },
        {
          conversationId: conversation!.id,
          role: 'USER',
          text: 'E boleto?',
          status: 'ANSWERED',
          createdAt: at(3),
        },
        {
          conversationId: conversation!.id,
          role: 'AGENT',
          text: 'Só cartão.',
          status: 'ANSWERED',
          createdAt: at(4),
        },
      ])
      .returning();
    return { conversationId: conversation!.id, replyId: reply!.id };
  }

  const debits = (tenantId: string) =>
    db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.tenantId, tenantId), eq(creditLedger.type, 'DEBIT')));
  const spent = async (tenantId: string) =>
    (await debits(tenantId)).reduce((sum, entry) => sum - entry.amount, 0);
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { code?: string }) => error.code ?? null,
    );
  const request = (conversationId: string, extra: Record<string, unknown> = {}) => ({
    analysisId: randomUUID(),
    source: 'TEST' as const,
    conversationId,
    answers: ANSWERS(),
    ...extra,
  });

  describe('com a chave da CRMThink', () => {
    it('analisa a conversa de teste, devolve os achados e debita no razão', async () => {
      const owner = await setup(20);
      const { conversationId, replyId } = await testConversation(owner);
      const input = request(conversationId);

      const result = await service.analyze(owner.tenantId, owner.agentId, input);

      expect(result).toMatchObject({ analysisId: input.analysisId, credits: PRICE, omitted: 0 });
      expect(result.findings).toEqual([
        expect.objectContaining({
          messageId: replyId,
          verdict: 'UNSUPPORTED',
          cause: 'MISSING_IN_BASE',
          suggestion: expect.objectContaining({ kind: 'ADD_ITEM', applicable: true }),
        }),
      ]);
      expect(chats).toHaveLength(1);
      expect(chats[0]!.apiKey).toBe('vibe_api_plataforma');
      expect(chats[0]!.prompt).toContain('Entregamos em 5 dias.');
      const rows = await debits(owner.tenantId);
      expect(rows.map((row) => [row.refType, row.refId, row.agentId, -row.amount])).toEqual([
        ['hallucination_analysis', input.analysisId, owner.agentId, PRICE],
      ]);
    });

    it('reenviar a análise já feita é recusado: a IA não roda de novo e não cobra de novo', async () => {
      const owner = await setup(20);
      const { conversationId } = await testConversation(owner);
      const input = request(conversationId);

      await service.analyze(owner.tenantId, owner.agentId, input);
      const code = await refusal(service.analyze(owner.tenantId, owner.agentId, input));

      expect(code).toBe('HALLUCINATION_ALREADY_ANALYZED');
      expect(chats).toHaveLength(1);
      expect(await spent(owner.tenantId)).toBe(PRICE);
    });

    it('a chave do razão leva o tenant: o mesmo analysisId de outro tenant não colide', async () => {
      const owner = await setup(20);
      const other = await setup(20);
      const mine = await testConversation(owner);
      const theirs = await testConversation(other);
      const shared = randomUUID();

      await service.analyze(
        owner.tenantId,
        owner.agentId,
        request(mine.conversationId, { analysisId: shared }),
      );
      await service.analyze(
        other.tenantId,
        other.agentId,
        request(theirs.conversationId, { analysisId: shared }),
      );

      expect(await spent(owner.tenantId)).toBe(PRICE);
      expect(await spent(other.tenantId)).toBe(PRICE);
      const [entry] = await debits(owner.tenantId);
      expect(entry!.idempotencyKey).toContain(`hallucination:${owner.tenantId}:${shared}`);
    });

    it('duas análises ao mesmo tempo com saldo para uma só: o saldo nunca fica negativo', async () => {
      const owner = await setup(PRICE);
      const { conversationId } = await testConversation(owner);

      const results = await Promise.allSettled([
        service.analyze(owner.tenantId, owner.agentId, request(conversationId)),
        service.analyze(owner.tenantId, owner.agentId, request(conversationId)),
      ]);

      expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
      const codes = results.flatMap((entry) =>
        entry.status === 'rejected' ? [(entry.reason as { code?: string }).code] : [],
      );
      expect(['HALLUCINATION_IN_PROGRESS', 'NO_CREDIT']).toContain(codes[0]);
      expect(await spent(owner.tenantId)).toBe(PRICE);
      expect(chats).toHaveLength(1);
    });

    it('análises diferentes cobram cada uma', async () => {
      const owner = await setup(20);
      const { conversationId } = await testConversation(owner);

      await service.analyze(owner.tenantId, owner.agentId, request(conversationId));
      await service.analyze(owner.tenantId, owner.agentId, request(conversationId));

      expect(await spent(owner.tenantId)).toBe(PRICE * 2);
    });

    it('sem saldo, a IA nem é chamada e nada é cobrado', async () => {
      const owner = await setup(PRICE - 1);
      const { conversationId } = await testConversation(owner);

      const code = await refusal(
        service.analyze(owner.tenantId, owner.agentId, request(conversationId)),
      );

      expect(code).toBe('NO_CREDIT');
      expect(chats).toHaveLength(0);
      expect(await spent(owner.tenantId)).toBe(0);
    });

    it('IA fora do ar ou saída inválida: erro e nenhum débito', async () => {
      const owner = await setup(20);
      const { conversationId } = await testConversation(owner);

      queue = [new VibecodeError('AI_UNAVAILABLE', 'chat', 'HTTP 503', { status: 503 })];
      expect(
        await refusal(service.analyze(owner.tenantId, owner.agentId, request(conversationId))),
      ).toBe('AI_UNAVAILABLE');

      await redis.flushall();
      queue = ['isto não é json', 'nem isto'];
      expect(
        await refusal(service.analyze(owner.tenantId, owner.agentId, request(conversationId))),
      ).toBe('AI_BAD_OUTPUT');

      expect(await spent(owner.tenantId)).toBe(0);
    });

    it('conversa sem resposta do agente: não chama a IA e não cobra', async () => {
      const owner = await setup(20);
      const [conversation] = await db
        .insert(agentTestConversation)
        .values({
          tenantId: owner.tenantId,
          agentId: owner.agentId,
          contextId: `${owner.tenantId}:t-${randomBytes(5).toString('hex')}`,
          createdByUserId: '1',
          createdByName: 'Maria',
        })
        .returning();
      await db.insert(agentTestMessage).values({
        conversationId: conversation!.id,
        role: 'USER',
        text: 'Oi',
        status: 'ANSWERED',
      });

      const code = await refusal(
        service.analyze(owner.tenantId, owner.agentId, request(conversation!.id)),
      );

      expect(code).toBe('HALLUCINATION_NOTHING_TO_ANALYZE');
      expect(chats).toHaveLength(0);
      expect(await spent(owner.tenantId)).toBe(0);
    });

    it('aparece no extrato de consumo como análise de alucinação', async () => {
      const owner = await setup(20);
      const { conversationId } = await testConversation(owner);
      await service.analyze(owner.tenantId, owner.agentId, request(conversationId));
      await service.analyze(owner.tenantId, owner.agentId, request(conversationId));
      // O extrato fecha o dia no fuso do Brasil: a faixa pega ontem, hoje e amanhã para não depender da hora.
      const around = (offset: number) =>
        new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

      const view = await statement.usage(owner.tenantId, { from: around(-1), to: around(1) });

      expect(view.rows.map((row) => [row.kind, row.agentId, row.responses, row.credits])).toEqual([
        ['HALLUCINATION_ANALYSIS', owner.agentId, 2, PRICE * 2],
      ]);
      expect(view.totals).toEqual({ responses: 0, credits: PRICE * 2 });
    });
  });

  describe('com a chave do cliente', () => {
    it('usa a chave dele e não debita créditos', async () => {
      const owner = await setup(20);
      tenantKey = 'vibe_api_cliente';
      const { conversationId } = await testConversation(owner);

      const result = await service.analyze(owner.tenantId, owner.agentId, request(conversationId));

      expect(result.credits).toBe(0);
      expect(chats[0]!.apiKey).toBe('vibe_api_cliente');
      expect(await spent(owner.tenantId)).toBe(0);
    });

    it('chave do cliente recusada pelo Vibecode: informa o problema e não usa a da CRMThink', async () => {
      const owner = await setup(20);
      tenantKey = 'vibe_api_cliente';
      queue = [new VibecodeError('AI_KEY_INVALID', 'chat', 'HTTP 401', { status: 401 })];
      const { conversationId } = await testConversation(owner);

      const code = await refusal(
        service.analyze(owner.tenantId, owner.agentId, request(conversationId)),
      );

      expect(code).toBe('AI_KEY_INVALID');
      expect(chats.map((entry) => entry.apiKey)).toEqual(['vibe_api_cliente']);
      expect(await spent(owner.tenantId)).toBe(0);
    });

    it('funciona sem saldo algum', async () => {
      const owner = await setup(0);
      tenantKey = 'vibe_api_cliente';
      const { conversationId } = await testConversation(owner);

      const result = await service.analyze(owner.tenantId, owner.agentId, request(conversationId));

      expect(result.findings).toHaveLength(1);
    });
  });

  describe('isolamento entre tenants e agentes', () => {
    it('conversa de teste de outro tenant não existe e a IA nem é chamada', async () => {
      const owner = await setup(20);
      const other = await setup(20);
      const foreign = await testConversation(other);

      const error = await service
        .analyze(owner.tenantId, owner.agentId, request(foreign.conversationId))
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 });
      expect(chats).toHaveLength(0);
      expect(await spent(owner.tenantId)).toBe(0);
    });

    it('agente de outro tenant responde como inexistente', async () => {
      const owner = await setup(20);
      const other = await setup(20);
      const { conversationId } = await testConversation(owner);

      const error = await service
        .analyze(other.tenantId, owner.agentId, request(conversationId))
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ status: 404 });
      expect(chats).toHaveLength(0);
    });

    it('chat real de outro tenant não é lido nem analisado', async () => {
      const owner = await setup(20);
      const other = await setup(20);
      const foreignChat = `public-api-${other.gptmakerAgentId}-${other.tenantId}:chat1`;
      realChats[foreignChat] = [{ id: 'm1', role: 'assistant', text: 'Entregamos em 5 dias.' }];

      const error = await service
        .analyze(owner.tenantId, owner.agentId, request(foreignChat, { source: 'REAL' }))
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 });
      expect(chats).toHaveLength(0);
      expect(await spent(owner.tenantId)).toBe(0);
    });
  });

  describe('conversa real', () => {
    it('lê as mensagens do GPTMaker e analisa, sem gravar o texto', async () => {
      const owner = await setup(20);
      const chat = `public-api-${owner.gptmakerAgentId}-${owner.tenantId}:chat1`;
      realChats[chat] = [
        { id: 'r1', role: 'user', text: 'Qual o prazo?', time: 1_700_000_010 },
        {
          id: 'r2',
          role: 'assistant',
          text: 'Entregamos em 5 dias, garantido.',
          time: 1_700_000_020,
        },
      ];
      const input = request(chat, { source: 'REAL', flaggedMessageIds: ['r2'] });

      const result = await service.analyze(owner.tenantId, owner.agentId, input);

      expect(result.findings[0]).toMatchObject({ messageId: 'r2' });
      expect(chats[0]!.prompt).toContain('Entregamos em 5 dias, garantido.');
      expect(chats[0]!.prompt).toContain('(marcada como suspeita)');
      expect(await spent(owner.tenantId)).toBe(PRICE);
      // Nada do texto da conversa real fica no banco.
      const stored = JSON.stringify(await db.select().from(agentTestMessage));
      expect(stored).not.toContain('garantido');
    });
  });
});
