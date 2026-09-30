import { randomBytes, randomUUID } from 'node:crypto';
import type { CreateAgentInput } from '@gptmaker/contracts';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { AgentService, hashWebhookToken } from '../../src/modules/agents/agent.service';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { WEBHOOK_EVENTS } from '../../src/modules/gptmaker/gptmaker.schemas';
import { TenantAgentLimitService } from '../../src/modules/gptmaker/tenant-agent-limit.service';
import { ModelCatalogService } from '../../src/modules/models/model-catalog.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runWithContext } from '../../src/shared/context/request-context';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { WireMock } from '../support/wiremock';

const { agent, aiModel, planAllowedModel, planEntitlement, subscriptionState, tenant } = schema;
const WS = 'ws-test';
const API = 'https://api.gptmaker.test';
const REMOTE_ID = 'gm-agent-1';

describe('serviço de agentes', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let repository: AgentRepository;
  let service: AgentService;
  let defaultModel: typeof aiModel.$inferSelect;
  let premiumModel: typeof aiModel.$inferSelect;
  let owner: { tenantId: string; tenantCode: string };

  const errorOf = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);
  const form = (extra: Partial<CreateAgentInput> = {}): CreateAgentInput => ({
    name: 'Atendente',
    behavior: 'Seja cordial',
    type: 'SUPPORT',
    communicationType: 'NORMAL',
    jobName: 'Loja Exemplo',
    ...extra,
  });

  async function newTenant() {
    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    return { tenantId: row!.id, tenantCode: row!.tenantCode };
  }

  async function stubGptMaker(
    overrides: { create?: number; settings?: number; webhooks?: number } = {},
  ) {
    await wiremock.stub({
      request: { method: 'POST', urlPath: `/v2/workspace/${WS}/agents` },
      response:
        (overrides.create ?? 200) === 200
          ? { status: 200, jsonBody: { id: REMOTE_ID, name: 'x' } }
          : { status: overrides.create!, jsonBody: { error: 'falhou' } },
    });
    for (const [path, status] of [
      ['settings', overrides.settings ?? 200],
      ['webhooks', overrides.webhooks ?? 200],
    ] as const) {
      await wiremock.stub({
        request: { method: 'PUT', urlPath: `/v2/agent/${REMOTE_ID}/${path}` },
        response:
          status === 200
            ? { status, jsonBody: { success: true } }
            : { status, jsonBody: { error: 'falhou' } },
      });
    }
    await wiremock.stub({
      request: { method: 'DELETE', urlPath: `/v2/agent/${REMOTE_ID}` },
      response: { status: 200, jsonBody: { success: true } },
    });
  }

  async function allowOnPlan(tenantId: string, modelId: string) {
    const planSpaId = `plan-${randomUUID()}`;
    await db
      .insert(planEntitlement)
      .values({ planSpaId, planType: 'subscription', creditsPerCycle: 1000 });
    await db.insert(planAllowedModel).values({ planSpaId, modelId });
    await db.insert(subscriptionState).values({
      tenantId,
      subscriptionId: `sub-${randomUUID()}`,
      status: 'active',
      modality: 'stripe',
      planId: planSpaId,
      version: 1,
    });
  }

  beforeAll(async () => {
    [postgres, redisContainer, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      WireMock.start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const client = new GptMakerClient(
      {
        baseUrl: `${wiremock.baseUrl}/v2`,
        token: 't',
        workspaceId: WS,
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
    const env = { API_PUBLIC_URL: API, TENANT_AGENT_LIMIT: 5 } as Env;
    repository = new AgentRepository(db);
    service = new AgentService(
      repository,
      new TenantAgentLimitService(db, env),
      new ModelCatalogService(db, client),
      client,
      db,
      redis,
      env,
    );
    const models = await db
      .insert(aiModel)
      .values([
        { code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1, isDefault: true },
        { code: 'GPT_5', displayName: 'GPT-5', creditsPerResponse: 5 },
      ])
      .returning();
    [defaultModel, premiumModel] = [models[0]!, models[1]!];
  });

  beforeEach(async () => {
    await wiremock.reset();
    await redis.flushall();
    await db.delete(agent);
    await db.delete(subscriptionState);
    await db.delete(planAllowedModel);
    await db.delete(planEntitlement);
    await db.update(aiModel).set({ active: true });
    owner = await newTenant();
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  it('cria no GPTMaker com nome prefixado, modelo padrão e webhooks, e grava o registro ACTIVE', async () => {
    await stubGptMaker();

    const view = await service.create(owner, form());

    const [created] = await wiremock.bodies('POST', `/v2/workspace/${WS}/agents`);
    expect(created).toEqual({
      name: `[${owner.tenantCode}] Atendente`,
      behavior: 'Seja cordial',
      type: 'SUPPORT',
      communicationType: 'NORMAL',
      jobName: 'Loja Exemplo',
      jobDescription: '',
    });
    expect(await wiremock.bodies('PUT', `/v2/agent/${REMOTE_ID}/settings`)).toEqual([
      { prefferModel: 'GPT_5_MINI' },
    ]);

    const [webhooks] = (await wiremock.bodies('PUT', `/v2/agent/${REMOTE_ID}/webhooks`)) as Array<
      Record<string, string>
    >;
    expect(Object.keys(webhooks!).sort()).toEqual([...WEBHOOK_EVENTS].sort());
    const url = new URL(webhooks!.onNewMessage!);
    expect(`${url.origin}${url.pathname}`).toBe(`${API}/gptmaker/webhooks/onNewMessage`);
    const token = url.searchParams.get('t')!;
    // Mesmo token em todos os eventos.
    for (const event of WEBHOOK_EVENTS) {
      expect(new URL(webhooks![event]!).searchParams.get('t')).toBe(token);
    }

    const [stored] = await db.select().from(agent).where(eq(agent.id, view.id));
    expect(stored).toMatchObject({
      tenantId: owner.tenantId,
      gptmakerAgentId: REMOTE_ID,
      name: 'Atendente',
      status: 'ACTIVE',
      modelId: defaultModel.id,
      webhookTokenHash: hashWebhookToken(token),
    });
    expect(stored!.webhookTokenHash).not.toBe(token);
    expect(view).toMatchObject({
      name: 'Atendente',
      status: 'ACTIVE',
      model: { code: 'GPT_5_MINI', creditsPerResponse: 1 },
    });
    expect(view).not.toHaveProperty('gptmakerAgentId');
  });

  it('usa o modelo escolhido quando o plano do tenant o libera', async () => {
    await stubGptMaker();
    await allowOnPlan(owner.tenantId, premiumModel.id);

    const view = await service.create(owner, form({ modelId: premiumModel.id }));

    expect(view.model.code).toBe('GPT_5');
    expect(await wiremock.bodies('PUT', `/v2/agent/${REMOTE_ID}/settings`)).toEqual([
      { prefferModel: 'GPT_5' },
    ]);
  });

  describe('recusa sem chamar o GPTMaker', () => {
    beforeEach(() => stubGptMaker());

    const expectNoRemoteCall = async () => {
      expect(await wiremock.count('POST', `/v2/workspace/${WS}/agents`)).toBe(0);
      expect(await db.select().from(agent)).toHaveLength(0);
    };

    it('modelo fora do plano: MODEL_NOT_ALLOWED', async () => {
      await allowOnPlan(owner.tenantId, defaultModel.id);
      const error = await errorOf(service.create(owner, form({ modelId: premiumModel.id })));
      expect(error).toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
      await expectNoRemoteCall();
    });

    it('tenant sem plano só pode usar o modelo padrão', async () => {
      const error = await errorOf(service.create(owner, form({ modelId: premiumModel.id })));
      expect(error).toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
      await expectNoRemoteCall();
    });

    it('modelo inativo, mesmo liberado no plano: MODEL_NOT_ALLOWED', async () => {
      await allowOnPlan(owner.tenantId, premiumModel.id);
      await db.update(aiModel).set({ active: false }).where(eq(aiModel.id, premiumModel.id));
      const error = await errorOf(service.create(owner, form({ modelId: premiumModel.id })));
      expect(error).toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
      await expectNoRemoteCall();
    });

    it('modelo inexistente: MODEL_NOT_ALLOWED', async () => {
      const error = await errorOf(service.create(owner, form({ modelId: randomUUID() })));
      expect(error).toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
      await expectNoRemoteCall();
    });

    it('limite de agentes atingido: TENANT_AGENT_LIMIT, contando inativos', async () => {
      for (let i = 0; i < 5; i++) {
        await repository.insert(owner.tenantId, {
          gptmakerAgentId: `gm-${randomUUID()}`,
          name: `Bot ${i}`,
          type: 'SUPPORT',
          communicationType: 'NORMAL',
          modelId: defaultModel.id,
          status: i === 0 ? 'INACTIVE' : 'ACTIVE',
          webhookTokenHash: randomUUID(),
        });
      }
      const error = await errorOf(service.create(owner, form()));
      expect(error).toMatchObject({ code: 'TENANT_AGENT_LIMIT', status: 409 });
      expect(await wiremock.count('POST', `/v2/workspace/${WS}/agents`)).toBe(0);
    });

    it('outra criação em andamento no tenant: AGENT_CREATION_IN_PROGRESS', async () => {
      await redis.set(`lock:agent-create:${owner.tenantId}`, 'outro', 'PX', 10_000);
      const error = await errorOf(service.create(owner, form()));
      expect(error).toMatchObject({ code: 'AGENT_CREATION_IN_PROGRESS', status: 409 });
      await expectNoRemoteCall();
    });
  });

  it('criações simultâneas no limite: só uma passa', async () => {
    await stubGptMaker();
    for (let i = 0; i < 4; i++) {
      await repository.insert(owner.tenantId, {
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: `Bot ${i}`,
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId: defaultModel.id,
        webhookTokenHash: randomUUID(),
      });
    }
    const results = await Promise.allSettled([
      service.create(owner, form()),
      service.create(owner, form()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await wiremock.count('POST', `/v2/workspace/${WS}/agents`)).toBe(1);
  });

  it('falha ao criar no GPTMaker: erro recuperável com traceId e nada gravado', async () => {
    await stubGptMaker({ create: 500 });
    const error = await runWithContext({ traceId: 'trace-123' }, () =>
      errorOf(service.create(owner, form())),
    );
    expect(error).toMatchObject({
      code: 'GPTMAKER_UNAVAILABLE',
      status: 503,
      details: { traceId: 'trace-123' },
    });
    expect(await db.select().from(agent)).toHaveLength(0);
  });

  it.each(['settings', 'webhooks'] as const)(
    'falha ao configurar %s: remove o agente criado no GPTMaker e não grava nada',
    async (step) => {
      await stubGptMaker({ [step]: 500 });
      const error = await errorOf(service.create(owner, form()));
      expect(error).toMatchObject({ code: 'GPTMAKER_UNAVAILABLE' });
      expect(await wiremock.count('DELETE', `/v2/agent/${REMOTE_ID}`)).toBe(1);
      expect(await db.select().from(agent)).toHaveLength(0);
    },
  );

  it('libera o lock depois da criação', async () => {
    await stubGptMaker();
    await service.create(owner, form());
    expect(await redis.exists(`lock:agent-create:${owner.tenantId}`)).toBe(0);
  });

  it('lista e busca só agentes do tenant; outro tenant recebe 404', async () => {
    await stubGptMaker();
    const view = await service.create(owner, form());
    const other = await newTenant();

    expect((await service.list(owner.tenantId)).map((row) => row.id)).toEqual([view.id]);
    expect(await service.list(other.tenantId)).toEqual([]);
    expect(await service.get(owner.tenantId, view.id)).toMatchObject({ id: view.id });
    const error = await errorOf(service.get(other.tenantId, view.id));
    expect(error).toMatchObject({ code: 'AGENT_NOT_FOUND', status: 404 });
  });

  describe('edição', () => {
    const PROFILE_PATH = `/v2/agent/${REMOTE_ID}`;
    const SETTINGS_PATH = `/v2/agent/${REMOTE_ID}/settings`;
    let existing: Awaited<ReturnType<AgentRepository['insert']>>;

    async function stubEdit(overrides: { profile?: number; settings?: number } = {}) {
      for (const [path, status, okBody] of [
        [PROFILE_PATH, overrides.profile ?? 200, { id: REMOTE_ID }],
        [SETTINGS_PATH, overrides.settings ?? 200, { success: true }],
      ] as const) {
        await wiremock.stub({
          request: { method: 'PUT', urlPath: path },
          response:
            status === 200
              ? { status, jsonBody: okBody }
              : { status, jsonBody: { error: 'recusado' } },
        });
      }
    }

    const remoteCalls = async () => ({
      profile: await wiremock.count('PUT', PROFILE_PATH),
      settings: await wiremock.count('PUT', SETTINGS_PATH),
    });

    const stored = async () => (await db.select().from(agent).where(eq(agent.id, existing.id)))[0]!;

    beforeEach(async () => {
      existing = await repository.insert(owner.tenantId, {
        gptmakerAgentId: REMOTE_ID,
        name: 'Atendente',
        behavior: 'Seja cordial',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        jobName: 'Loja Exemplo',
        modelId: defaultModel.id,
        settings: { timezone: 'America/Sao_Paulo', enabledEmoji: true },
        webhookTokenHash: randomUUID(),
      });
    });

    it('dados: envia o perfil completo com o prefixo e não mexe nas settings', async () => {
      await stubEdit();

      const view = await service.update(owner, existing.id, {
        name: 'Vendedor',
        behavior: null,
        type: 'SALE',
      });

      expect(await wiremock.bodies('PUT', PROFILE_PATH)).toEqual([
        {
          name: `[${owner.tenantCode}] Vendedor`,
          behavior: '',
          type: 'SALE',
          communicationType: 'NORMAL',
          jobName: 'Loja Exemplo',
          jobDescription: '',
        },
      ]);
      expect((await remoteCalls()).settings).toBe(0);
      expect(view).toMatchObject({ name: 'Vendedor', behavior: null, type: 'SALE' });
      expect(await stored()).toMatchObject({ name: 'Vendedor', behavior: null, type: 'SALE' });
    });

    it('settings: mescla com as atuais e reenvia o prefferModel do modelo atual', async () => {
      await stubEdit();

      const view = await service.update(owner, existing.id, {
        settings: { enabledEmoji: false, maxDailyMessages: 100 },
      });

      expect(await wiremock.bodies('PUT', SETTINGS_PATH)).toEqual([
        {
          timezone: 'America/Sao_Paulo',
          enabledEmoji: false,
          maxDailyMessages: 100,
          prefferModel: 'GPT_5_MINI',
        },
      ]);
      expect((await remoteCalls()).profile).toBe(0);
      expect(view.settings).toEqual({
        timezone: 'America/Sao_Paulo',
        enabledEmoji: false,
        maxDailyMessages: 100,
      });
    });

    it('troca de modelo liberado no plano: novo prefferModel e registro local', async () => {
      await stubEdit();
      await allowOnPlan(owner.tenantId, premiumModel.id);

      const view = await service.update(owner, existing.id, { modelId: premiumModel.id });

      expect(await wiremock.bodies('PUT', SETTINGS_PATH)).toEqual([
        { timezone: 'America/Sao_Paulo', enabledEmoji: true, prefferModel: 'GPT_5' },
      ]);
      expect(view.model.code).toBe('GPT_5');
      expect((await stored()).modelId).toBe(premiumModel.id);
    });

    it('troca para modelo fora do plano: MODEL_NOT_ALLOWED sem chamar o GPTMaker', async () => {
      await stubEdit();
      const error = await errorOf(service.update(owner, existing.id, { modelId: premiumModel.id }));
      expect(error).toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
      expect(await remoteCalls()).toEqual({ profile: 0, settings: 0 });
    });

    it('manter o modelo atual não passa pela regra do plano', async () => {
      await stubEdit();
      await db.update(agent).set({ modelId: premiumModel.id }).where(eq(agent.id, existing.id));

      const view = await service.update(owner, existing.id, {
        modelId: premiumModel.id,
        name: 'Outro nome',
      });
      expect(view.model.code).toBe('GPT_5');
      expect((await remoteCalls()).settings).toBe(0);
    });

    it('valores iguais aos atuais: nenhuma chamada ao GPTMaker', async () => {
      await stubEdit();
      await service.update(owner, existing.id, {
        name: 'Atendente',
        settings: { enabledEmoji: true },
      });
      expect(await remoteCalls()).toEqual({ profile: 0, settings: 0 });
    });

    it('falha nas settings depois dos dados: desfaz os dados e mantém o registro local', async () => {
      await stubEdit({ settings: 500 });

      const error = await errorOf(
        service.update(owner, existing.id, { name: 'Novo', settings: { enabledEmoji: false } }),
      );

      expect(error).toMatchObject({ code: 'GPTMAKER_UNAVAILABLE' });
      const profiles = (await wiremock.bodies('PUT', PROFILE_PATH)) as Array<{ name: string }>;
      expect(profiles.map((body) => body.name)).toEqual([
        `[${owner.tenantCode}] Novo`,
        `[${owner.tenantCode}] Atendente`,
      ]);
      expect(await stored()).toMatchObject({
        name: 'Atendente',
        settings: { timezone: 'America/Sao_Paulo', enabledEmoji: true },
      });
    });

    it('GPTMaker recusa os dados: GPTMAKER_REJECTED e nada alterado', async () => {
      await stubEdit({ profile: 400 });
      const error = await errorOf(service.update(owner, existing.id, { name: 'Novo' }));
      expect(error).toMatchObject({ code: 'GPTMAKER_REJECTED', status: 422 });
      expect((await stored()).name).toBe('Atendente');
    });

    it('agente de outro tenant: 404 sem chamar o GPTMaker', async () => {
      await stubEdit();
      const other = await newTenant();
      const error = await errorOf(service.update(other, existing.id, { name: 'Invadido' }));
      expect(error).toMatchObject({ code: 'AGENT_NOT_FOUND', status: 404 });
      expect(await remoteCalls()).toEqual({ profile: 0, settings: 0 });
    });

    it('agente fora de sincronia: AGENT_OUT_OF_SYNC', async () => {
      await db.update(agent).set({ status: 'OUT_OF_SYNC' }).where(eq(agent.id, existing.id));
      const error = await errorOf(service.update(owner, existing.id, { name: 'Novo' }));
      expect(error).toMatchObject({ code: 'AGENT_OUT_OF_SYNC', status: 409 });
    });

    it('outra alteração em andamento no agente: AGENT_BUSY', async () => {
      await redis.set(`lock:agent:${owner.tenantId}:${existing.id}`, 'outro', 'PX', 10_000);
      const error = await errorOf(service.update(owner, existing.id, { name: 'Novo' }));
      expect(error).toMatchObject({ code: 'AGENT_BUSY', status: 409 });
    });

    it('edição vazia é recusada pela validação', async () => {
      await expect(service.update(owner, existing.id, {})).rejects.toThrow(/ao menos um campo/);
    });
  });
});
