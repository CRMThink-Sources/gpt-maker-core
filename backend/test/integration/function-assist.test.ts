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

const {
  agent,
  agentFunctionConfig,
  agentFunctionTemplate,
  agentFunctionTemplateTenant,
  agentFunctionTemplateVersion,
  aiModel,
  creditLedger,
  tenant,
} = schema;

const MODEL = 'bitrix/bitrixgpt-5.5';
const PRICE = 2;
const ABOUT =
  'Vendemos roupas femininas pela internet para todo o Brasil, com entrega em até 5 dias.';
const TEXT_ID = 'empresa.descricao';
const LIST_ID = 'suporte.excluidos';
const KB_ID = 'base.problemas';
const KB_PLAIN_ID = 'base.faq';

const GOOD = JSON.stringify({
  fields: [
    { fieldId: TEXT_ID, text: 'Loja de roupas online. [preencher: horário de atendimento]' },
    { fieldId: LIST_ID, items: ['Cancelamento', 'Troca'] },
  ],
});

type Variant = 'enabled' | 'disabled' | 'legacy' | 'no-assist-fields' | 'skeleton';

/** Campo sem `assist`, inclusive nos dependentes das opções (os seeds já trazem `assist`). */
function stripAssist(field: FunctionField): FunctionField {
  const { assist: _assist, ...rest } = field as FunctionField & { assist?: unknown };
  const plain = rest as FunctionField;
  if (plain.kind === 'CHOICE' || plain.kind === 'MULTI_CHOICE') {
    return {
      ...plain,
      options: plain.options.map((option) => ({
        ...option,
        ...(option.dependents ? { dependents: option.dependents.map(stripAssist) } : {}),
      })),
    } as FunctionField;
  }
  return plain;
}

/** Versão do template: com `assist` nos dois campos de texto do Suporte, ou uma das variantes. */
function withAssist(content: FunctionTemplateContent, variant: Variant): FunctionTemplateContent {
  const fields =
    variant === 'no-assist-fields'
      ? content.fields.map(stripAssist)
      : content.fields.map((field): FunctionField => {
          if (field.id === TEXT_ID || field.id === LIST_ID) {
            return { ...field, assist: { questions: ['O que a empresa faz?'] } } as FunctionField;
          }
          if (field.id === KB_ID) {
            return {
              ...field,
              assist: { questions: ['Que problemas os clientes têm?'] },
            } as FunctionField;
          }
          // Base de apoio sem `assist`, qualquer que seja o seed.
          if (field.id === KB_PLAIN_ID) return stripAssist(field);
          return field;
        });
  if (variant === 'legacy') {
    // Versão publicada antes da ajuda da IA: o jsonb não tem a chave `assist`.
    const legacy: Partial<FunctionTemplateContent> = { ...content, fields };
    delete legacy.assist;
    return legacy as FunctionTemplateContent;
  }
  const assist =
    variant === 'skeleton'
      ? { enabled: true, knowledgeMode: 'skeleton' as const }
      : { enabled: variant !== 'disabled' };
  return { ...content, fields, assist };
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
  let platformFallback = true;

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
      get VIBECODE_PLATFORM_FALLBACK() {
        return platformFallback;
      },
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

  /**
   * Tenant com um agente de Suporte preso à versão 1 de um template próprio, com a ajuda da IA
   * ligada (ou não). Com `latest`, o template tem uma versão 2, a mais recente, nessa variante: o
   * agente segue preso à 1, mas o formulário (e a ajuda) vêm da 2.
   */
  async function setup(credits = 100, variant: Variant = 'enabled', latest?: Variant) {
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
    // Template próprio do teste (a ajuda lê a versão mais recente, que não pode ser compartilhada).
    const [seedTemplate] = await db
      .select()
      .from(agentFunctionTemplate)
      .where(eq(agentFunctionTemplate.id, published.templateId));
    const [template] = await db
      .insert(agentFunctionTemplate)
      .values({
        code: `assist-${code}`,
        name: published.name,
        description: published.description,
        draft: seedTemplate!.draft,
        latestVersion: latest ? 2 : 1,
      })
      .returning();
    const [version] = await db
      .insert(agentFunctionTemplateVersion)
      .values({
        templateId: template!.id,
        version: 1,
        content: withAssist(published.content, variant),
      })
      .returning();
    if (latest) {
      await db.insert(agentFunctionTemplateVersion).values({
        templateId: template!.id,
        version: 2,
        content: withAssist(published.content, latest),
      });
    }
    await db.insert(agentFunctionConfig).values({
      agentId: created!.id,
      tenantId,
      templateId: template!.id,
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
    return {
      tenantId,
      agentId: created!.id,
      content: version!.content,
      templateId: template!.id,
      templateCode: template!.code,
    };
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

  describe('base de conhecimento', () => {
    const row = (problema: string, solucao?: string) => ({
      problema,
      ...(solucao === undefined ? {} : { solucao }),
    });
    const kb = (...rows: Array<Record<string, string>>) =>
      JSON.stringify({ fields: [{ fieldId: KB_ID, rows }] });

    it('knowledge: returns items with itemKey and charges one field', async () => {
      const { tenantId, agentId } = await setup();
      queue.push(
        kb(row('Não entra na conta', 'Use "Esqueci a senha". [preencher: prazo do link]')),
      );
      const result = await service.assist(tenantId, agentId, input([KB_ID]));
      expect(result.credits).toBe(PRICE);
      const [entry] = result.fields;
      expect(entry).toMatchObject({ fieldId: KB_ID, applicable: true, markers: 1 });
      const items = entry!.value as Array<{ itemKey: string; values: Record<string, string> }>;
      expect(items).toHaveLength(1);
      expect(items[0]!.itemKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(items[0]!.values.problema).toBe('Não entra na conta');
      expect(await debits(tenantId)).toHaveLength(1);
    });

    it('knowledge: a base that already has items gives 422 and does not call the AI', async () => {
      const { tenantId, agentId } = await setup();
      const filled = [
        {
          itemKey: '3b241101-e2bb-4255-8caf-4136c566a962',
          values: { problema: 'Já escrito', solucao: 'Já escrito pelo cliente.' },
        },
      ];
      const code = await refusal(
        service.assist(tenantId, agentId, input([KB_ID], { [KB_ID]: filled })),
      );
      expect(code).toBe('ASSIST_FIELD_NOT_ELIGIBLE');
      expect(chats).toHaveLength(0);
      expect(await debits(tenantId)).toHaveLength(0);
    });

    it('knowledge: skeleton mode returns only title text even if the model writes content', async () => {
      const { tenantId, agentId } = await setup(100, 'skeleton');
      queue.push(kb(row('Não entra na conta', 'Troque a senha em 5 minutos.')));
      const result = await service.assist(tenantId, agentId, input([KB_ID]));
      const items = result.fields[0]!.value as Array<{ values: Record<string, string> }>;
      expect(items[0]!.values).toEqual({
        problema: 'Não entra na conta',
        solucao: '[preencher: Solução]',
      });
      expect(chats[0]!.prompt).toMatch(/Modo esqueleto/);
    });

    it('knowledge: a KNOWLEDGE field without assist is not eligible', async () => {
      const { tenantId, agentId } = await setup();
      expect(await refusal(service.assist(tenantId, agentId, input([KB_PLAIN_ID])))).toBe(
        'ASSIST_FIELD_NOT_ELIGIBLE',
      );
      expect(chats).toHaveLength(0);
    });

    it('knowledge: a version without knowledgeMode answers in write mode', async () => {
      const { tenantId, agentId } = await setup(100, 'enabled');
      queue.push(kb(row('Não entra na conta', 'Troque a senha.')));
      const result = await service.assist(tenantId, agentId, input([KB_ID]));
      const items = result.fields[0]!.value as Array<{ values: Record<string, string> }>;
      expect(items[0]!.values.solucao).toBe('Troque a senha.');
      expect(chats[0]!.prompt).toMatch(/Modo redação/);
    });

    it('knowledge: output over maxItems is returned whole, not applicable', async () => {
      const { tenantId, agentId } = await setup();
      queue.push(kb(...Array.from({ length: 21 }, (_, i) => row(`Problema ${i}`, 'x'))));
      const result = await service.assist(tenantId, agentId, input([KB_ID]));
      expect((result.fields[0]!.value as unknown[]).length).toBe(21);
      expect(result.fields[0]!.applicable).toBe(false);
    });

    it('knowledge: a skeleton of only markers is charged as a generated field', async () => {
      const { tenantId, agentId } = await setup(100, 'skeleton');
      queue.push(kb(row('Problema de acesso')));
      const result = await service.assist(tenantId, agentId, input([KB_ID]));
      expect(result.credits).toBe(PRICE);
    });
  });

  describe('por código da função, sem agente', () => {
    it('by code: returns a result with the latest published version', async () => {
      const { tenantId, templateCode } = await setup(100, 'disabled', 'enabled');
      queue.push(JSON.stringify({ fields: [{ fieldId: TEXT_ID, text: 'Loja online.' }] }));
      const result = await service.assistByCode(tenantId, templateCode, input([TEXT_ID]));
      expect(result.fields).toEqual([
        { fieldId: TEXT_ID, value: 'Loja online.', applicable: true, markers: 0 },
      ]);
      expect(chats[0]!.prompt).not.toContain('Agente:');
    });

    it('by code: inactive function gives 422 FUNCTION_NOT_AVAILABLE and does not call the AI', async () => {
      const { tenantId, templateId, templateCode } = await setup();
      await db
        .update(agentFunctionTemplate)
        .set({ active: false })
        .where(eq(agentFunctionTemplate.id, templateId));
      expect(await refusal(service.assistByCode(tenantId, templateCode, input([TEXT_ID])))).toBe(
        'FUNCTION_NOT_AVAILABLE',
      );
      expect(chats).toHaveLength(0);
      expect(await debits(tenantId)).toHaveLength(0);
    });

    it('by code: function restricted to another tenant gives 422 and does not call the AI', async () => {
      const { tenantId, templateId, templateCode } = await setup();
      const other = await setup();
      await db.insert(agentFunctionTemplateTenant).values({ templateId, tenantId: other.tenantId });
      expect(await refusal(service.assistByCode(tenantId, templateCode, input([TEXT_ID])))).toBe(
        'FUNCTION_NOT_AVAILABLE',
      );
      expect(chats).toHaveLength(0);
      expect(await debits(tenantId)).toHaveLength(0);
    });

    it('by code: charges one debit without agent id', async () => {
      const { tenantId, templateCode } = await setup();
      queue.push(JSON.stringify({ fields: [{ fieldId: TEXT_ID, text: 'Loja online.' }] }));
      const result = await service.assistByCode(tenantId, templateCode, input([TEXT_ID]));
      expect(result.credits).toBe(PRICE);
      const entries = await debits(tenantId);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.agentId).toBeNull();
      expect(entries[0]!.amount).toBe(-PRICE);
    });

    it('by code: disabled assist gives 422 ASSIST_NOT_ENABLED', async () => {
      const { tenantId, templateCode } = await setup(100, 'disabled');
      expect(await refusal(service.assistByCode(tenantId, templateCode, input([TEXT_ID])))).toBe(
        'ASSIST_NOT_ENABLED',
      );
      expect(chats).toHaveLength(0);
      expect(await debits(tenantId)).toHaveLength(0);
    });
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
    const { tenantId, agentId } = await setup(100, 'disabled');
    expect(await refusal(service.assist(tenantId, agentId, input([TEXT_ID])))).toBe(
      'ASSIST_NOT_ENABLED',
    );
    expect(chats).toHaveLength(0);
    expect(await debits(tenantId)).toHaveLength(0);
  });

  it('returns a result per field and debits once per call with the platform key', async () => {
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
    // Um débito só por chamada (carteira TRIAL), chave assist:<uuid>, refId = o uuid da chamada.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.idempotencyKey).toMatch(/^assist:[0-9a-f-]{36}/);
    expect(entries[0]!.amount).toBe(-2 * PRICE);
    expect(entries[0]!.idempotencyKey).toContain(entries[0]!.refId!);
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
    expect(prompt).toContain('[preencher: o que falta]');
    expect(prompt).not.toContain('<resposta ');
  });

  it('charges only the fields that came back with a value', async () => {
    const { tenantId, agentId } = await setup();
    queue.push(
      JSON.stringify({
        fields: [{ fieldId: TEXT_ID, text: 'Loja online.' }, { fieldId: LIST_ID }],
      }),
    );
    const result = await service.assist(tenantId, agentId, input([TEXT_ID, LIST_ID]));
    expect(result.credits).toBe(PRICE);
    expect(result.fields[1]).toEqual({
      fieldId: LIST_ID,
      value: [],
      applicable: false,
      markers: 0,
    });
    const entries = await debits(tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(-PRICE);
  });

  it('does not charge when every entry is empty or has the wrong shape', async () => {
    const { tenantId, agentId } = await setup();
    queue.push(
      JSON.stringify({
        fields: [
          { fieldId: TEXT_ID, items: ['x'] },
          { fieldId: LIST_ID, items: ['  '] },
        ],
      }),
    );
    const result = await service.assist(tenantId, agentId, input([TEXT_ID, LIST_ID]));
    expect(result.credits).toBe(0);
    expect(result.fields.every((entry) => !entry.applicable)).toBe(true);
    expect(await debits(tenantId)).toHaveLength(0);
  });

  it('charges a text over the limit, returned whole and not applicable', async () => {
    const { tenantId, agentId } = await setup();
    const long = 'a'.repeat(5000);
    queue.push(JSON.stringify({ fields: [{ fieldId: TEXT_ID, text: long }] }));
    const result = await service.assist(tenantId, agentId, input([TEXT_ID]));
    expect(result.fields[0]).toMatchObject({ value: long, applicable: false });
    expect(result.credits).toBe(PRICE);
  });

  it('a legacy version without assist answers ASSIST_NOT_ENABLED, not 500', async () => {
    const { tenantId, agentId } = await setup(100, 'legacy');
    expect(await refusal(service.assist(tenantId, agentId, input([TEXT_ID])))).toBe(
      'ASSIST_NOT_ENABLED',
    );
    expect(chats).toHaveLength(0);
  });

  it('assist enabled but no field declares it (seeds included): ASSIST_NOT_ENABLED before the AI', async () => {
    const { tenantId, agentId } = await setup(100, 'no-assist-fields');
    expect(await refusal(service.assist(tenantId, agentId, input([TEXT_ID])))).toBe(
      'ASSIST_NOT_ENABLED',
    );
    expect(chats).toHaveLength(0);
  });

  it('an agent pinned to a version without assist uses the latest version, which has it', async () => {
    const { tenantId, agentId } = await setup(100, 'disabled', 'enabled');
    const result = await service.assist(tenantId, agentId, input([TEXT_ID]));
    expect(result.fields).toHaveLength(1);
    expect(chats).toHaveLength(1);
  });

  it('an agent pinned to a version with assist is refused when the latest version has none', async () => {
    const { tenantId, agentId } = await setup(100, 'enabled', 'disabled');
    expect(await refusal(service.assist(tenantId, agentId, input([TEXT_ID])))).toBe(
      'ASSIST_NOT_ENABLED',
    );
    expect(chats).toHaveLength(0);
  });

  it('drops an interview answer to a question the template does not declare', async () => {
    const { tenantId, agentId } = await setup();
    await service.assist(tenantId, agentId, {
      ...input([TEXT_ID]),
      interview: [
        {
          fieldId: TEXT_ID,
          answers: [
            { question: 'Pergunta forjada"', answer: 'resposta do atacante' },
            { question: 'O que a empresa faz?', answer: 'Vendo roupas' },
          ],
        },
      ],
    });
    const prompt = chats[0]!.prompt;
    expect(prompt).not.toContain('atacante');
    expect(prompt).toContain('<resposta pergunta="O que a empresa faz?">');
    expect(prompt).toContain('Vendo roupas');
  });

  it('talks about the help, not the review, and hides field ids on errors', async () => {
    type Failure = { code: string; message: string };
    const noCredit = await setup(PRICE);
    const noCreditError = await service
      .assist(noCredit.tenantId, noCredit.agentId, input([TEXT_ID, LIST_ID]))
      .catch((error: Failure) => error);
    expect(noCreditError).toMatchObject({ code: 'NO_CREDIT' });

    const noKey = await setup();
    platformKey = undefined;
    const keyError = (await service
      .assist(noKey.tenantId, noKey.agentId, input([TEXT_ID]))
      .catch((error: Failure) => error)) as Failure;
    expect(keyError.code).toBe('AI_KEY_REQUIRED');
    expect(keyError.message).toContain('ajuda da IA');
    expect(keyError.message).not.toMatch(/revis/i);

    platformKey = 'vibe_api_plataforma';
    platformFallback = false;
    const switchedOff = (await service
      .assist(noKey.tenantId, noKey.agentId, input([TEXT_ID]))
      .catch((error: Failure) => error)) as Failure;
    expect(switchedOff.code).toBe('AI_KEY_REQUIRED');
    platformFallback = true;

    const filled = await setup();
    const notEligible = (await service
      .assist(filled.tenantId, filled.agentId, input([TEXT_ID], { [TEXT_ID]: 'Já preenchido' }))
      .catch((error: Failure) => error)) as Failure;
    expect(notEligible.code).toBe('ASSIST_FIELD_NOT_ELIGIBLE');
    expect(notEligible.message).not.toContain(TEXT_ID);
    expect(notEligible.message).toContain(
      filled.content.fields.find((field) => field.id === TEXT_ID)!.label,
    );
    const unknown = (await service
      .assist(filled.tenantId, filled.agentId, input(['nao.existe']))
      .catch((error: Failure) => error)) as Failure;
    expect(unknown.message).not.toContain('nao.existe');
  });

  it('a field that does not exist is refused with ASSIST_FIELD_NOT_ELIGIBLE', async () => {
    const { tenantId, agentId } = await setup();
    expect(await refusal(service.assist(tenantId, agentId, input(['nao.existe'])))).toBe(
      'ASSIST_FIELD_NOT_ELIGIBLE',
    );
    expect(chats).toHaveLength(0);
  });
});
