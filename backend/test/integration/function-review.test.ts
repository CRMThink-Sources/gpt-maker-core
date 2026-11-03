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
import { LedgerService } from '../../src/modules/billing/ledger.service';
import type { AiKeyService } from '../../src/modules/function-review/ai-key.service';
import {
  FunctionReviewService,
  TENANT_FIELDS_PER_WINDOW,
} from '../../src/modules/function-review/function-review.service';
import { ReviewSessionStore } from '../../src/modules/function-review/review-session.store';
import { VibecodeError, type VibecodeClient } from '../../src/modules/vibecode';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import type { Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agent, agentFunctionConfig, aiModel, creditLedger, tenant } = schema;

const MODEL = 'bitrix/bitrixgpt-5.5';
const PRICE = 2;

const KNOWLEDGE = (title: string) => [
  {
    itemKey: randomUUID(),
    values: { problema: title, solucao: 'Reinicie o aplicativo e tente de novo.' },
  },
];

/** As 4 respostas revisáveis do Suporte: 3 bases e a descrição da empresa. */
const ANSWERS = () => ({
  'empresa.descricao': 'Vendemos roupas femininas pela internet para todo o Brasil.',
  'base.problemas': KNOWLEDGE('Não consigo entrar'),
  'base.faq': [
    {
      itemKey: randomUUID(),
      values: { pergunta: 'Qual o prazo de entrega?', resposta: 'Até 5 dias úteis na capital.' },
    },
  ],
  'base.politicas': [
    {
      itemKey: randomUUID(),
      values: { titulo: 'Trocas', texto: 'Trocas em até 7 dias corridos após o recebimento.' },
    },
  ],
});
const FIELDS = ['empresa.descricao', 'base.problemas', 'base.faq', 'base.politicas'];

const GOOD_FIELD = JSON.stringify({
  summary: 'Resumo do campo.',
  items: [
    { index: 0, problems: [{ category: 'incomplete', severity: 'polish', text: 'Está curto.' }] },
  ],
});

/** Resposta do Vibecode simulado: um texto, ou uma falha. */
type Script = string | VibecodeError;

// Revisão por IA da função: criação, campo a campo, cobrança e limites (tarefas 5.1 a 5.6).
describe('revisão por IA da função', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let service: FunctionReviewService;

  // Estado do Vibecode simulado.
  let queue: Script[];
  let chats: Array<{ apiKey: string; prompt: string }>;
  let tenantKey: string | null;
  let platformKey: string | undefined;
  let debitFails = false;
  let rpm = 600;

  const vibecode = {
    chat: async (input: { apiKey: string; messages: Array<{ content: string }> }) => {
      const prompt = input.messages.map((message) => message.content).join('\n');
      chats.push({ apiKey: input.apiKey, prompt });
      const next = queue.shift() ?? GOOD_FIELD;
      if (next instanceof VibecodeError) throw next;
      return { content: next };
    },
  } as unknown as VibecodeClient;
  const keys = { find: async () => tenantKey } as unknown as AiKeyService;
  const alerts = { afterDebit: async () => null } as unknown as CreditAlerts;

  function build() {
    const env = {
      VIBECODE_REVIEW_MODEL: MODEL,
      REVIEW_CREDITS_PER_FIELD: PRICE,
      VIBECODE_PLATFORM_RPM: rpm,
      get VIBECODE_PLATFORM_API_KEY() {
        return platformKey;
      },
    } as unknown as Env;
    const failingLedger = {
      debit: (input: Parameters<LedgerService['debit']>[0]) => {
        if (debitFails) throw new Error('ledger fora do ar');
        return ledger.debit(input);
      },
    } as unknown as LedgerService;
    return new FunctionReviewService(
      db as unknown as Database,
      env,
      redis,
      new AgentRepository(db as unknown as Database),
      new FunctionCatalog(db),
      keys,
      vibecode,
      new ReviewSessionStore(redis),
      new BalanceReader(db as unknown as Database, redis),
      failingLedger,
      alerts,
    );
  }

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
    ledger = new LedgerService(db as unknown as Database, redis);
    await seedAgentFunctions(db, new FunctionCatalog(db));
    service = build();
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  beforeEach(() => {
    queue = [];
    chats = [];
    tenantKey = null;
    platformKey = 'vibe_api_plataforma';
    debitFails = false;
  });

  /** Tenant com um agente de Suporte e, opcionalmente, créditos. */
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
    return { tenantId, agentId: created!.id };
  }

  const debits = (tenantId: string) =>
    db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.tenantId, tenantId), eq(creditLedger.type, 'DEBIT')));
  const total = async (tenantId: string) =>
    (await debits(tenantId)).reduce((sum, entry) => sum - entry.amount, 0);
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { code?: string }) => error.code ?? null,
    );

  describe('criação (5.1)', () => {
    it('chave do cliente, da CRMThink ou nenhuma', async () => {
      const { tenantId, agentId } = await setup();
      tenantKey = 'vibe_api_cliente';
      expect(await service.create(tenantId, agentId, { fieldIds: FIELDS })).toMatchObject({
        keySource: 'tenant',
        creditsPerField: PRICE,
      });

      tenantKey = null;
      expect(await service.create(tenantId, agentId, { fieldIds: FIELDS })).toMatchObject({
        keySource: 'platform',
      });

      platformKey = undefined;
      expect(await refusal(service.create(tenantId, agentId, { fieldIds: FIELDS }))).toBe(
        'AI_KEY_REQUIRED',
      );
    });

    it('recusa campo que não é de texto, lista ou base', async () => {
      const { tenantId, agentId } = await setup();
      expect(await refusal(service.create(tenantId, agentId, { fieldIds: ['comum.tom'] }))).toBe(
        'REVIEW_FIELD_NOT_REVIEWABLE',
      );
      expect(await refusal(service.create(tenantId, agentId, { fieldIds: ['nao.existe'] }))).toBe(
        'REVIEW_FIELD_NOT_REVIEWABLE',
      );
    });

    it('revisão e agente de outro tenant não existem', async () => {
      const mine = await setup();
      const other = await setup();
      expect(
        await refusal(service.create(other.tenantId, mine.agentId, { fieldIds: FIELDS })),
      ).toBe('AGENT_NOT_FOUND');
      const { reviewId } = await service.create(mine.tenantId, mine.agentId, { fieldIds: FIELDS });
      const field = { fieldId: FIELDS[0]!, answers: ANSWERS() };
      expect(
        await refusal(service.reviewField(other.tenantId, other.agentId, reviewId, field)),
      ).toBe('REVIEW_NOT_FOUND');
      expect(
        await refusal(service.reviewField(mine.tenantId, mine.agentId, randomUUID(), field)),
      ).toBe('REVIEW_NOT_FOUND');
    });
  });

  describe('campo (5.2)', () => {
    async function review(credits = 100) {
      const ctx = await setup(credits);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      const field = (fieldId: string, answers: Record<string, unknown> = ANSWERS()) =>
        service.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
          fieldId,
          answers: answers as never,
        });
      return { ...ctx, reviewId, field };
    }

    it('resultado válido, com a sugestão marcada pelo limite do subcampo', async () => {
      const { field } = await review();
      queue.push(
        JSON.stringify({
          summary: 'Problemas de acesso.',
          items: [
            {
              index: 0,
              problems: [{ category: 'incomplete', severity: 'blocks', text: 'Solução sem passos.' }],
              suggestion: { solucao: '1. Abra o app.\n2. Toque em Entrar.' },
            },
          ],
        }),
      );
      const result = await field('base.problemas');
      expect(result).toEqual({
        fieldId: 'base.problemas',
        summary: 'Problemas de acesso.',
        items: [
          {
            index: 0,
            problems: [
              {
                code: 'incomplete',
                category: 'incomplete',
                severity: 'blocks',
                text: 'Solução sem passos.',
              },
            ],
            suggestion: {
              values: { solucao: '1. Abra o app.\n2. Toque em Entrar.' },
              applicable: true,
            },
          },
        ],
      });
      expect(chats[0]!.apiKey).toBe('vibe_api_plataforma');
    });

    it('sugestão acima do limite volta sem poder aplicar', async () => {
      const { field } = await review();
      // `solucao` aceita 850 caracteres.
      queue.push(
        JSON.stringify({
          summary: 'x',
          items: [{ index: 0, problems: [], suggestion: { solucao: 'a'.repeat(851) } }],
        }),
      );
      const result = await field('base.problemas');
      expect(result.items[0]!.suggestion).toMatchObject({ applicable: false });
    });

    it('saída fora do formato: tenta de novo uma vez; duas vezes vira AI_BAD_OUTPUT e libera o campo', async () => {
      const { field, tenantId } = await review();
      queue.push('não é json', '{"summary": 1}');
      expect(await refusal(field('base.faq'))).toBe('AI_BAD_OUTPUT');
      expect(chats).toHaveLength(2);
      expect(await total(tenantId)).toBe(0);

      // Saída ruim só na primeira: a segunda chamada resolve, e o campo é cobrado uma vez.
      queue.push('lixo');
      chats = [];
      expect((await field('base.faq')).summary).toBe('Resumo do campo.');
      expect(chats).toHaveLength(2);
      expect(await total(tenantId)).toBe(PRICE);
    });

    it('o mesmo campo na mesma revisão não é revisado de novo', async () => {
      const { field } = await review();
      await field('base.faq');
      expect(await refusal(field('base.faq'))).toBe('REVIEW_FIELD_RESERVED');
      expect(chats).toHaveLength(1);
    });

    it('campo fora da revisão, vazio ou com resposta inválida é recusado antes da IA', async () => {
      const { field } = await review();
      expect(await refusal(field('comum.tom'))).toBe('REVIEW_NOT_FOUND');
      expect(await refusal(field('base.faq', { ...ANSWERS(), 'base.faq': [] }))).toBe(
        'REVIEW_FIELD_NOT_REVIEWABLE',
      );
      const tooLong = [
        { itemKey: randomUUID(), values: { pergunta: 'p', resposta: 'a'.repeat(900) } },
      ];
      expect(await refusal(field('base.faq', { ...ANSWERS(), 'base.faq': tooLong }))).toBe(
        'FUNCTION_ANSWERS_INVALID',
      );
      expect(chats).toHaveLength(0);
    });

    it('o roteiro e os limites vêm do template no banco, não do app', async () => {
      const { field } = await review();
      await field('base.politicas');
      const prompt = chats[0]!.prompt;
      expect(prompt).toContain('Cada política traz prazo, horário ou condição concreta');
      expect(prompt).toContain('titulo (até 100), texto (até 900)');
      // O conteúdo do cliente vai delimitado, como dado.
      expect(prompt).toContain('<item index="0" posição="1">');
    });
  });

  describe('cobrança (5.3)', () => {
    it('4 campos com 1 falha: 3 débitos, e o extrato guarda o tipo e o agente', async () => {
      const ctx = await setup(100);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      const run = (fieldId: string) =>
        service.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
          fieldId,
          answers: ANSWERS() as never,
        });
      queue.push(
        GOOD_FIELD,
        new VibecodeError('AI_UNAVAILABLE', 'chat', 'HTTP 503', { status: 503 }),
        GOOD_FIELD,
        GOOD_FIELD,
      );
      const outcomes = await Promise.all(FIELDS.map((id) => refusal(run(id))));
      expect(outcomes.filter((code) => code === 'AI_UNAVAILABLE')).toHaveLength(1);
      const entries = await debits(ctx.tenantId);
      expect(entries).toHaveLength(3);
      expect(await total(ctx.tenantId)).toBe(3 * PRICE);
      expect(entries[0]).toMatchObject({
        refType: 'function_review',
        refId: reviewId,
        agentId: ctx.agentId,
        createdBy: 'system:review',
      });
    });

    it('saldo para só 2 campos: os outros mostram NO_CREDIT sem chamar a IA', async () => {
      const ctx = await setup(2 * PRICE);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      const outcomes: Array<string | null> = [];
      for (const fieldId of FIELDS) {
        outcomes.push(
          await refusal(
            service.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
              fieldId,
              answers: ANSWERS() as never,
            }),
          ),
        );
      }
      expect(outcomes).toEqual([null, null, 'NO_CREDIT', 'NO_CREDIT']);
      expect(chats).toHaveLength(2);
      expect(await total(ctx.tenantId)).toBe(2 * PRICE);
    });

    it('o mesmo campo chegando duas vezes é cobrado uma vez só', async () => {
      const ctx = await setup(100);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      const input = { fieldId: 'base.faq', answers: ANSWERS() as never };
      await service.reviewField(ctx.tenantId, ctx.agentId, reviewId, input);
      expect(await refusal(service.reviewField(ctx.tenantId, ctx.agentId, reviewId, input))).toBe(
        'REVIEW_FIELD_RESERVED',
      );
      expect(await debits(ctx.tenantId)).toHaveLength(1);
    });

    it('chave do cliente: nenhum débito', async () => {
      const ctx = await setup(100);
      tenantKey = 'vibe_api_cliente';
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      for (const fieldId of FIELDS) {
        await service.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
          fieldId,
          answers: ANSWERS() as never,
        });
      }
      expect(chats.every((chat) => chat.apiKey === 'vibe_api_cliente')).toBe(true);
      expect(await debits(ctx.tenantId)).toHaveLength(0);
    });

    it('débito que falha: o campo volta sem resultado e a reserva é liberada', async () => {
      const ctx = await setup(100);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      const input = { fieldId: 'base.faq', answers: ANSWERS() as never };
      debitFails = true;
      await expect(service.reviewField(ctx.tenantId, ctx.agentId, reviewId, input)).rejects.toThrow(
        'ledger fora do ar',
      );
      expect(await debits(ctx.tenantId)).toHaveLength(0);

      debitFails = false;
      await service.reviewField(ctx.tenantId, ctx.agentId, reviewId, input);
      expect(await debits(ctx.tenantId)).toHaveLength(1);
    });
  });

  describe('erros da chave (5.4)', () => {
    async function failWith(source: 'tenant' | 'platform', error: VibecodeError) {
      const ctx = await setup(100);
      tenantKey = source === 'tenant' ? 'vibe_api_cliente' : null;
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      queue.push(error);
      const code = await refusal(
        service.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
          fieldId: 'base.faq',
          answers: ANSWERS() as never,
        }),
      );
      return { code, chats: chats.length, debits: (await debits(ctx.tenantId)).length };
    }

    it('insufficient_balance na chave do cliente: mensagem da conta dele, sem trocar de chave', async () => {
      const error = new VibecodeError('AI_NO_BALANCE', 'chat', 'HTTP 402', {
        status: 402,
        vibecodeCode: 'insufficient_balance',
      });
      expect(await failWith('tenant', error)).toEqual({
        code: 'AI_NO_BALANCE',
        chats: 1,
        debits: 0,
      });
    });

    it('insufficient_balance na chave da CRMThink: o cliente só vê "fora do ar"', async () => {
      const error = new VibecodeError('AI_NO_BALANCE', 'chat', 'HTTP 402', {
        status: 402,
        vibecodeCode: 'insufficient_balance',
      });
      expect(await failWith('platform', error)).toEqual({
        code: 'AI_UNAVAILABLE',
        chats: 1,
        debits: 0,
      });
    });
  });

  describe('contradições (5.5)', () => {
    it('uma chamada com os resumos e nenhum lançamento no razão', async () => {
      const ctx = await setup(100);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      queue.push(
        JSON.stringify({
          contradictions: [
            { fields: ['base.politicas', 'base.faq'], text: 'Trocas: 7 dias contra 30 dias.' },
            { fields: ['campo.de.fora'], text: 'Ignorada: campo fora da revisão.' },
          ],
        }),
      );
      const result = await service.cross(ctx.tenantId, ctx.agentId, reviewId, {
        summaries: [
          { fieldId: 'base.politicas', summary: 'Trocas em até 7 dias.' },
          { fieldId: 'base.faq', summary: 'Trocas em até 30 dias.' },
        ],
      });
      expect(result.contradictions).toEqual([
        { fields: ['base.politicas', 'base.faq'], text: 'Trocas: 7 dias contra 30 dias.' },
      ]);
      expect(chats).toHaveLength(1);
      expect(await debits(ctx.tenantId)).toHaveLength(0);
    });

    it('resumo de campo fora da revisão é recusado', async () => {
      const ctx = await setup();
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, {
        fieldIds: ['base.faq'],
      });
      expect(
        await refusal(
          service.cross(ctx.tenantId, ctx.agentId, reviewId, {
            summaries: [
              { fieldId: 'base.faq', summary: 'a' },
              { fieldId: 'base.politicas', summary: 'b' },
            ],
          }),
        ),
      ).toBe('REVIEW_NOT_FOUND');
    });
  });

  describe('limites (5.6)', () => {
    it('por tenant: passado o limite da janela, recusa e não chama a IA', async () => {
      const ctx = await setup();
      tenantKey = 'vibe_api_cliente';
      let refused: string | null = null;
      for (let i = 0; i <= TENANT_FIELDS_PER_WINDOW; i++) {
        const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, {
          fieldIds: ['base.faq'],
        });
        refused = await refusal(
          service.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
            fieldId: 'base.faq',
            answers: ANSWERS() as never,
          }),
        );
        if (refused) break;
      }
      expect(refused).toBe('REVIEW_RATE_LIMITED');
      expect(chats).toHaveLength(TENANT_FIELDS_PER_WINDOW);
    });

    it('global da chave da CRMThink: o excedente espera, tenta uma vez e vira AI_BUSY sem cobrança', async () => {
      await redis.flushall();
      rpm = 6; // 1 chamada por janela de 10 s
      const limited = build();
      const ctx = await setup(100);
      const { reviewId } = await limited.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      const outcomes = await Promise.all(
        ['base.problemas', 'base.faq', 'base.politicas'].map((fieldId) =>
          refusal(
            limited.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
              fieldId,
              answers: ANSWERS() as never,
            }),
          ),
        ),
      );
      rpm = 600;
      expect(outcomes.filter((code) => code === 'AI_BUSY')).toHaveLength(1);
      expect(outcomes.filter((code) => code === null)).toHaveLength(2);
      // Sem cobrança do campo que não foi, e a reserva dele foi liberada.
      expect(await debits(ctx.tenantId)).toHaveLength(2);
      const busyField = ['base.problemas', 'base.faq', 'base.politicas'][
        outcomes.indexOf('AI_BUSY')
      ]!;
      expect(await new ReviewSessionStore(redis).reserve(reviewId, busyField)).toBe(true);
    }, 60_000);

    it('com 20 por minuto, vários campos de uma revisão passam sem "muitas revisões"', async () => {
      await redis.flushall();
      rpm = 20; // antes: floor(20 × 5 / 60) = 1 por janela, e a revisão de 11 campos estourava
      const limited = build();
      rpm = 600;
      const ctx = await setup(100);
      const { reviewId } = await limited.create(ctx.tenantId, ctx.agentId, { fieldIds: FIELDS });
      const outcomes = await Promise.all(
        ['base.problemas', 'base.faq', 'base.politicas'].map((fieldId) =>
          refusal(
            limited.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
              fieldId,
              answers: ANSWERS() as never,
            }),
          ),
        ),
      );
      expect(outcomes).toEqual([null, null, null]);
      expect(await debits(ctx.tenantId)).toHaveLength(3);
    }, 30_000);
  });
  describe('cobertura da base (agent-knowledge-gaps)', () => {
    const EXPECTATION = 'Clientes pedem segunda via de boleto e perguntam o prazo de troca.';
    const GAPS_OK = JSON.stringify({
      gaps: [
        {
          fieldId: 'base.politicas',
          title: 'Prazo de troca',
          why: 'A expectativa cita troca e a base não tem política.',
          item: { titulo: 'Troca', texto: 'Trocas em [preencher: prazo de troca em dias].' },
        },
        {
          fieldId: 'base.faq',
          title: 'Segunda via de boleto',
          why: 'Não há pergunta sobre boleto.',
          item: { pergunta: 'Como pedir a 2ª via?', resposta: 'Pelo [preencher: canal].' },
        },
      ],
      covered: [{ text: 'Prazo de entrega' }],
    });

    async function covered(credits = 100, withGaps = true) {
      const ctx = await setup(credits);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, {
        fieldIds: ['base.faq'],
        withGaps,
      });
      // "base.politicas" fica vazia de propósito: a cobertura enxerga campo de base vazio.
      const answers = { 'base.faq': ANSWERS()['base.faq'] };
      const ask = (patch: Partial<{ expectation: string }> = {}) =>
        service.gaps(ctx.tenantId, ctx.agentId, reviewId, {
          expectation: patch.expectation ?? EXPECTATION,
          answers: answers as never,
          summaries: [{ fieldId: 'base.faq', summary: 'Prazo de entrega.' }],
        });
      return { ...ctx, reviewId, ask };
    }

    it('sugere itens, inclusive para campo de base vazio, e lista o que a base cobre', async () => {
      const { ask } = await covered();
      queue.push(GAPS_OK);
      const result = await ask();
      expect(result.gaps.map((gap) => [gap.fieldId, gap.applicable])).toEqual([
        ['base.politicas', true],
        ['base.faq', true],
      ]);
      expect(result.covered).toEqual([{ text: 'Prazo de entrega' }]);
      const prompt = chats[0]!.prompt;
      expect(prompt).toContain(EXPECTATION);
      expect(prompt).toContain('id="base.politicas"');
      expect(prompt).toContain('"Qual o prazo de entrega?"');
    });

    it('revisão criada sem withGaps não faz cobertura', async () => {
      const { ask } = await covered(100, false);
      expect(await refusal(ask())).toBe('REVIEW_GAPS_NOT_ENABLED');
      expect(chats).toHaveLength(0);
    });

    it('revisão de outro tenant não existe', async () => {
      const mine = await covered();
      const other = await setup();
      expect(
        await refusal(
          service.gaps(other.tenantId, other.agentId, mine.reviewId, {
            expectation: EXPECTATION,
            answers: {},
            summaries: [],
          }),
        ),
      ).toBe('REVIEW_NOT_FOUND');
    });

    it('saída fora do formato duas vezes: AI_BAD_OUTPUT, sem cobrança e com a reserva liberada', async () => {
      const { ask, tenantId } = await covered();
      queue.push('lixo', '{"gaps": "x"}');
      expect(await refusal(ask())).toBe('AI_BAD_OUTPUT');
      expect(await total(tenantId)).toBe(0);
      queue.push(GAPS_OK);
      expect((await ask()).gaps).toHaveLength(2);
    });

    it('a segunda cobertura da mesma revisão é recusada e cobra uma vez só', async () => {
      const { ask, tenantId } = await covered();
      queue.push(GAPS_OK);
      await ask();
      expect(await refusal(ask())).toBe('REVIEW_FIELD_RESERVED');
      expect(await total(tenantId)).toBe(PRICE);
    });

    it('sem saldo para a cobertura: NO_CREDIT sem chamar a IA', async () => {
      const { ask } = await covered(PRICE - 1);
      expect(await refusal(ask())).toBe('NO_CREDIT');
      expect(chats).toHaveLength(0);
    });

    it('chave do cliente: nenhum débito', async () => {
      tenantKey = 'vibe_api_cliente';
      const { ask, tenantId } = await covered();
      queue.push(GAPS_OK);
      await ask();
      expect(chats[0]!.apiKey).toBe('vibe_api_cliente');
      expect(await debits(tenantId)).toHaveLength(0);
    });

    it('4 campos e a cobertura: 5 débitos, e a cobertura aparece como um campo', async () => {
      const ctx = await setup(100);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, {
        fieldIds: FIELDS,
        withGaps: true,
      });
      for (const fieldId of FIELDS) {
        await service.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
          fieldId,
          answers: ANSWERS() as never,
        });
      }
      queue.push(GAPS_OK);
      await service.gaps(ctx.tenantId, ctx.agentId, reviewId, {
        expectation: EXPECTATION,
        answers: ANSWERS() as never,
        summaries: [],
      });
      const entries = await debits(ctx.tenantId);
      expect(entries).toHaveLength(5);
      expect(entries.some((entry) => entry.idempotencyKey.includes(':__gaps__'))).toBe(true);
      expect(await total(ctx.tenantId)).toBe(5 * PRICE);
    });

    it('débito que falha: sem resultado e a reserva é liberada', async () => {
      const { ask, tenantId } = await covered();
      queue.push(GAPS_OK);
      debitFails = true;
      await expect(ask()).rejects.toThrow('ledger fora do ar');
      debitFails = false;
      queue.push(GAPS_OK);
      await ask();
      expect(await debits(tenantId)).toHaveLength(1);
    });
  });

  describe('contexto da revisão (agent-review-quality)', () => {
    const EXPECTATION = 'Clientes pedem segunda via de boleto e perguntam o prazo de troca.';
    const GAPS_EMPTY = JSON.stringify({ gaps: [], covered: [] });

    async function started(expectation?: string) {
      const ctx = await setup(100);
      const { reviewId } = await service.create(ctx.tenantId, ctx.agentId, {
        fieldIds: FIELDS,
        withGaps: true,
        ...(expectation ? { expectation } : {}),
      });
      const field = (fieldId: string) =>
        service.reviewField(ctx.tenantId, ctx.agentId, reviewId, {
          fieldId,
          answers: ANSWERS() as never,
        });
      return { ...ctx, reviewId, field };
    }

    it('a expectativa da criação chega ao prompt de cada campo', async () => {
      const { field } = await started(EXPECTATION);
      await field('base.faq');
      expect(chats[0]!.prompt).toContain(`<expectativa>\n${EXPECTATION}\n</expectativa>`);
    });

    it('sem expectativa o prompt do campo não tem o bloco', async () => {
      const { field } = await started();
      await field('base.faq');
      expect(chats[0]!.prompt).not.toContain('<expectativa>');
    });

    it('o prompt leva o que a função faz e só os títulos dos outros campos de base', async () => {
      const { field } = await started();
      await field('base.faq');
      const prompt = chats[0]!.prompt;
      expect(prompt).toContain('O que a função faz:');
      expect(prompt).toContain('Problemas comuns');
      expect(prompt).toContain('"Não consigo entrar"');
      // O corpo dos itens dos outros campos não vai.
      expect(prompt).not.toContain('Reinicie o aplicativo e tente de novo.');
      expect(prompt).not.toContain('Trocas em até 7 dias corridos');
    });

    it('a cobertura usa a expectativa da sessão quando o corpo não a traz', async () => {
      const { tenantId, agentId, reviewId } = await started(EXPECTATION);
      queue.push(GAPS_EMPTY);
      await service.gaps(tenantId, agentId, reviewId, {
        answers: { 'base.faq': ANSWERS()['base.faq'] } as never,
        summaries: [],
      });
      expect(chats[0]!.prompt).toContain(EXPECTATION);
    });

    it('a expectativa do corpo do /gaps vale mais que a da sessão', async () => {
      const { tenantId, agentId, reviewId } = await started(EXPECTATION);
      queue.push(GAPS_EMPTY);
      await service.gaps(tenantId, agentId, reviewId, {
        expectation: 'Clientes querem saber se há entrega aos domingos.',
        answers: { 'base.faq': ANSWERS()['base.faq'] } as never,
        summaries: [],
      });
      expect(chats[0]!.prompt).toContain('entrega aos domingos');
      expect(chats[0]!.prompt).not.toContain('segunda via de boleto');
    });

    it('sem expectativa na sessão nem no corpo, a cobertura é recusada antes da IA', async () => {
      const { tenantId, agentId, reviewId } = await started();
      expect(
        await refusal(
          service.gaps(tenantId, agentId, reviewId, {
            answers: { 'base.faq': ANSWERS()['base.faq'] } as never,
            summaries: [],
          }),
        ),
      ).toBe('REVIEW_EXPECTATION_REQUIRED');
      expect(chats).toHaveLength(0);
    });

    it('categoria desconhecida volta como "outro" e o campo não falha', async () => {
      const { field } = await started();
      queue.push(
        JSON.stringify({
          summary: 'x',
          items: [{ index: 0, problems: [{ category: 'tom_de_voz', text: 'Tom informal.' }] }],
        }),
      );
      const result = await field('base.faq');
      expect(result.items[0]!.problems[0]).toMatchObject({
        category: 'other',
        severity: 'polish',
      });
    });
  });
});
