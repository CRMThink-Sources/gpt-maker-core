import { randomBytes } from 'node:crypto';
import type { FunctionField, FunctionTemplateContent } from '@gptmaker/contracts';
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
import { FunctionReviewService } from '../../src/modules/function-review/function-review.service';
import { ReviewSessionStore } from '../../src/modules/function-review/review-session.store';
import type { VibecodeClient } from '../../src/modules/vibecode';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import type { Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agent, agentFunctionConfig, agentFunctionTemplateVersion, aiModel, creditLedger, tenant } =
  schema;

const MODEL = 'bitrix/bitrixgpt-5.5';
const PRICE = 2;
const ABOUT =
  'Vendemos roupas femininas pela internet para todo o Brasil, com entrega em até 5 dias.';
const TEXT_ID = 'empresa.descricao';
const LIST_ID = 'suporte.excluidos';

const GOOD = JSON.stringify({
  fields: [
    { fieldId: TEXT_ID, text: 'Loja de roupas online. [preencher: horário de atendimento]' },
    { fieldId: LIST_ID, items: ['Cancelamento', 'Troca'] },
  ],
});

/** Liga a ajuda e declara `assist` nos dois campos de texto do Suporte. */
function withAssist(content: FunctionTemplateContent, enabled: boolean): FunctionTemplateContent {
  const fields = content.fields.map((field): FunctionField => {
    if (field.id === TEXT_ID || field.id === LIST_ID) {
      return { ...field, assist: { questions: ['O que a empresa faz?'] } } as FunctionField;
    }
    return field;
  });
  return { ...content, fields, assist: { enabled } };
}

// Ajuda da IA para preencher campos de texto vazios da função.
describe('ajuda da IA para preencher a função', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let service: FunctionReviewService;

  let queue: string[];
  let chats: Array<{ apiKey: string; prompt: string }>;
  let tenantKey: string | null;
  let platformKey: string | undefined;

  const vibecode = {
    chat: async (call: { apiKey: string; messages: Array<{ content: string }> }) => {
      const prompt = call.messages.map((message) => message.content).join('\n');
      chats.push({ apiKey: call.apiKey, prompt });
      return { content: queue.shift() ?? GOOD };
    },
  } as unknown as VibecodeClient;
  const keys = { find: async () => tenantKey } as unknown as AiKeyService;
  const alerts = { afterDebit: async () => null } as unknown as CreditAlerts;

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
    const env = {
      VIBECODE_REVIEW_MODEL: MODEL,
      REVIEW_CREDITS_PER_FIELD: PRICE,
      VIBECODE_PLATFORM_RPM: 600,
      get VIBECODE_PLATFORM_API_KEY() {
        return platformKey;
      },
    } as unknown as Env;
    service = new FunctionReviewService(
      db as unknown as Database,
      env,
      redis,
      new AgentRepository(db as unknown as Database),
      new FunctionCatalog(db),
      keys,
      vibecode,
      new ReviewSessionStore(redis),
      new BalanceReader(db as unknown as Database, redis),
      ledger,
      alerts,
    );
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
  });

  /** Tenant com um agente de Suporte preso a uma versão com a ajuda da IA ligada (ou não). */
  async function setup(credits = 100, assistEnabled = true) {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
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
    // Versão própria do teste: a do seed não tem `assist`.
    const [version] = await db
      .insert(agentFunctionTemplateVersion)
      .values({
        templateId: published.templateId,
        version: 1_000_000 + Math.floor(Math.random() * 1_000_000),
        content: withAssist(published.content, assistEnabled),
      })
      .returning();
    await db.insert(agentFunctionConfig).values({
      agentId: created!.id,
      tenantId,
      templateId: published.templateId,
      versionId: version!.id,
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
    return { tenantId, agentId: created!.id, content: version!.content };
  }

  const debits = (tenantId: string) =>
    db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.tenantId, tenantId), eq(creditLedger.type, 'DEBIT')));
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { code?: string }) => error.code ?? null,
    );
  const input = (fieldIds: string[], answers: Record<string, unknown> = {}) => ({
    fieldIds,
    about: ABOUT,
    interview: [],
    answers: answers as never,
  });

  it('refuses a filled field with 422 and does not call the AI', async () => {
    const { tenantId, agentId } = await setup();
    const code = await refusal(
      service.assist(tenantId, agentId, input([TEXT_ID], { [TEXT_ID]: 'Já preenchido' })),
    );
    expect(code).toBe('ASSIST_FIELD_NOT_ELIGIBLE');
    expect(chats).toHaveLength(0);
    expect(await debits(tenantId)).toHaveLength(0);
  });

  it('refuses when assist is disabled', async () => {
    const { tenantId, agentId } = await setup(100, false);
    expect(await refusal(service.assist(tenantId, agentId, input([TEXT_ID])))).toBe(
      'ASSIST_NOT_ENABLED',
    );
    expect(chats).toHaveLength(0);
    expect(await debits(tenantId)).toHaveLength(0);
  });

  it('returns a result per field and charges once per field with the platform key', async () => {
    const { tenantId, agentId } = await setup();
    queue.push(
      JSON.stringify({
        fields: [
          { fieldId: TEXT_ID, text: 'Loja online. [preencher: horário]' },
          { fieldId: LIST_ID, items: ['Cancelamento'] },
          { fieldId: 'campo.de.fora', text: 'ignorado' },
        ],
      }),
    );
    const result = await service.assist(tenantId, agentId, input([TEXT_ID, LIST_ID]));
    expect(result.credits).toBe(2 * PRICE);
    expect(result.fields).toEqual([
      {
        fieldId: TEXT_ID,
        value: 'Loja online. [preencher: horário]',
        applicable: true,
        markers: 1,
      },
      { fieldId: LIST_ID, value: ['Cancelamento'], applicable: true, markers: 0 },
    ]);
    expect(chats).toHaveLength(1);
    expect(chats[0]!.apiKey).toBe('vibe_api_plataforma');
    const entries = await debits(tenantId);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.idempotencyKey.startsWith('assist:'))).toBe(true);
    expect(entries.map((entry) => entry.idempotencyKey.split(':')[2]).sort()).toEqual(
      [LIST_ID, TEXT_ID].sort(),
    );
  });

  it('accepts the field label in place of the id', async () => {
    const { tenantId, agentId, content } = await setup();
    const label = content.fields.find((field) => field.id === TEXT_ID)!.label;
    queue.push(JSON.stringify({ fields: [{ fieldId: label, text: 'Texto pelo rótulo.' }] }));
    const result = await service.assist(tenantId, agentId, input([TEXT_ID]));
    expect(result.fields).toEqual([
      { fieldId: TEXT_ID, value: 'Texto pelo rótulo.', applicable: true, markers: 0 },
    ]);
  });

  it('does not charge when the AI output is invalid', async () => {
    const { tenantId, agentId } = await setup();
    queue.push('não é json', '{"fields": 1}');
    expect(await refusal(service.assist(tenantId, agentId, input([TEXT_ID, LIST_ID])))).toBe(
      'AI_BAD_OUTPUT',
    );
    expect(chats).toHaveLength(2);
    expect(await debits(tenantId)).toHaveLength(0);
  });

  it('does not charge with the tenant key', async () => {
    const { tenantId, agentId } = await setup();
    tenantKey = 'vibe_api_cliente';
    const result = await service.assist(tenantId, agentId, input([TEXT_ID, LIST_ID]));
    expect(result.credits).toBe(0);
    expect(chats[0]!.apiKey).toBe('vibe_api_cliente');
    expect(await debits(tenantId)).toHaveLength(0);
  });

  it('refuses without balance before calling the AI', async () => {
    const { tenantId, agentId } = await setup(PRICE);
    expect(await refusal(service.assist(tenantId, agentId, input([TEXT_ID, LIST_ID])))).toBe(
      'NO_CREDIT',
    );
    expect(chats).toHaveLength(0);
  });

  it('answers with an empty interview use markers only', async () => {
    const { tenantId, agentId } = await setup();
    await service.assist(tenantId, agentId, input([TEXT_ID]));
    const prompt = chats[0]!.prompt;
    expect(prompt).toContain('Respostas: nenhuma');
    expect(prompt).toContain('[preencher:');
  });
});
