import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AgentEvents } from '../../src/modules/agents/agent-events';
import { BitrixClient } from '../../src/modules/bitrix/bitrix.client';
import { ChatbotSync } from '../../src/modules/channel/chatbot-sync';
import { botCodeFor, ChatbotService } from '../../src/modules/channel/chatbot.service';
import { TenantLifecycle } from '../../src/modules/tenancy/tenant-lifecycle';
import type { Tenant } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { type StubMapping, WireMock } from '../support/wiremock';

const { agent, agentBot, aiModel, tenant } = schema;
const API = 'https://api.gptmaker.test';
const REGISTER = '/rest/imbot.v2.Bot.register.json';
const UPDATE = '/rest/imbot.v2.Bot.update.json';
const UNREGISTER = '/rest/imbot.v2.Bot.unregister.json';
const PHOTO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

// Chatbot por agente (spec bitrix-chatbot-channel), com o WireMock no papel do portal Bitrix24.
describe('chatbot do Bitrix por agente', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let service: ChatbotService;
  let sync: ChatbotSync;
  let events: AgentEvents;
  let lifecycle: TenantLifecycle;
  let modelId: string;
  let env: Env;
  let owner: Tenant;

  const ok = (result: unknown) => ({ status: 200, jsonBody: { result } });
  const bitrixError = (code: string) => ({
    status: 400,
    jsonBody: { error: code, error_description: code },
  });

  async function stubBitrix(
    overrides: { update?: StubMapping['response']; unregister?: StubMapping['response'] } = {},
  ) {
    await wiremock.stub({
      request: { method: 'POST', urlPath: REGISTER },
      response: ok({ bot: { id: 456, code: 'x' }, users: [] }),
    });
    await wiremock.stub({
      request: { method: 'POST', urlPath: UPDATE },
      response: overrides.update ?? ok({ bot: { id: 456 }, users: [] }),
    });
    await wiremock.stub({
      request: { method: 'POST', urlPath: UNREGISTER },
      response: overrides.unregister ?? ok(true),
    });
  }

  async function newAgent(values: Partial<typeof agent.$inferInsert> = {}) {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner.id,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
        ...values,
      })
      .returning();
    return row!;
  }

  const botOf = async (agentId: string) =>
    (await db.select().from(agentBot).where(eq(agentBot.agentId, agentId)))[0];
  const bodies = (path: string) =>
    wiremock.bodies('POST', path) as Promise<Array<Record<string, unknown>>>;

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
    const bitrix = new BitrixClient(
      {
        get: async () => ({
          accessToken: 'portal-token',
          expiresAt: new Date(Date.now() + 3_600_000),
          endpoint: `${wiremock.baseUrl}/rest/`,
        }),
        refresh: async () => {
          throw new Error('não esperado');
        },
      },
      { timeoutMs: 5000, maxAttempts: 1, acquire: async () => {} },
    );
    env = { API_PUBLIC_URL: API, APP_ROLE: 'api' } as Env;
    service = new ChatbotService(bitrix, db, env);
    events = new AgentEvents();
    lifecycle = new TenantLifecycle();
    sync = new ChatbotSync(service, events, lifecycle, db, redis, env);
    sync.onModuleInit();
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await db.delete(agentBot);
    await db.delete(agent);
    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: String(Math.floor(Math.random() * 1_000_000)),
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    owner = row!;
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  it('registra bot de Linhas Abertas com webhook, aplica nome e foto e grava o botId', async () => {
    await stubBitrix();
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/img/ana.png' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
        base64Body: PHOTO.toString('base64'),
      },
    });
    const row = await newAgent({ avatarUrl: `${wiremock.baseUrl}/img/ana.png` });

    expect(await service.syncAgent(row.id)).toBe('registered');

    expect(await bodies(REGISTER)).toEqual([
      {
        auth: 'portal-token',
        fields: {
          code: botCodeFor(row.id),
          type: 'openline',
          isSupportOpenline: true,
          eventMode: 'webhook',
          webhookUrl: `${API}/bitrix/bots/events`,
          properties: { name: 'Ana', workPosition: 'Agente de IA' },
        },
      },
    ]);
    const updates = await bodies(UPDATE);
    expect(updates[0]).toMatchObject({
      botId: 456,
      fields: { properties: { name: 'Ana' }, webhookUrl: `${API}/bitrix/bots/events` },
    });
    expect(updates[1]).toMatchObject({
      botId: 456,
      fields: { properties: { personalPhoto: PHOTO.toString('base64') } },
    });
    expect(await botOf(row.id)).toMatchObject({
      botId: '456',
      botCode: botCodeFor(row.id),
      tenantId: owner.id,
    });
    expect((await botOf(row.id))!.profileHash).toBeTruthy();
  });

  it('repetir sem mudança não chama o Bitrix; renomear só atualiza', async () => {
    await stubBitrix();
    const row = await newAgent();
    await service.syncAgent(row.id);
    await wiremock.reset();
    await stubBitrix();

    expect(await service.syncAgent(row.id)).toBe('unchanged');
    expect(await wiremock.count('POST', UPDATE)).toBe(0);

    await db.update(agent).set({ name: 'Ana Paula' }).where(eq(agent.id, row.id));
    expect(await service.syncAgent(row.id)).toBe('updated');
    expect(await wiremock.count('POST', REGISTER)).toBe(0);
    expect((await bodies(UPDATE))[0]).toMatchObject({
      fields: { properties: { name: 'Ana Paula' } },
    });
  });

  it('API_PUBLIC_URL mudou (túnel novo): a reconciliação leva o webhook novo ao bot', async () => {
    await stubBitrix();
    const row = await newAgent();
    await service.syncAgent(row.id);
    await wiremock.reset();
    await stubBitrix();

    env.API_PUBLIC_URL = 'https://tunel-novo.trycloudflare.com';
    try {
      expect(await sync.reconcile()).toMatchObject({ pending: 1, synced: 1 });
      expect((await bodies(UPDATE))[0]).toMatchObject({
        botId: 456,
        fields: { webhookUrl: 'https://tunel-novo.trycloudflare.com/bitrix/bots/events' },
      });
      expect(await sync.reconcile()).toMatchObject({ pending: 0 });
    } finally {
      env.API_PUBLIC_URL = API;
    }
  });

  it('bot apagado no portal (BOT_NOT_FOUND): registra de novo', async () => {
    await stubBitrix();
    const row = await newAgent();
    await db.insert(agentBot).values({
      agentId: row.id,
      tenantId: owner.id,
      botId: '111',
      botCode: botCodeFor(row.id),
      profileHash: 'velho',
    });
    // Primeiro update falha (bot 111 sumiu); o do bot novo passa.
    await wiremock.stub({
      request: {
        method: 'POST',
        urlPath: UPDATE,
        bodyPatterns: [{ matchesJsonPath: '$[?(@.botId == 111)]' }],
      },
      response: bitrixError('BOT_NOT_FOUND'),
      priority: 1,
    });

    await service.syncAgent(row.id);

    expect(await wiremock.count('POST', REGISTER)).toBe(1);
    expect((await botOf(row.id))!.botId).toBe('456');
  });

  it('foto indisponível não impede o bot', async () => {
    await stubBitrix();
    const row = await newAgent({ avatarUrl: `${wiremock.baseUrl}/img/sumiu.png` });

    expect(await service.syncAgent(row.id)).toBe('registered');
    expect(await wiremock.count('POST', UPDATE)).toBe(1);
    expect((await botOf(row.id))!.profileHash).toBeTruthy();
  });

  it('agente removido: desregistra (já ausente no portal não é erro) e apaga o vínculo', async () => {
    await stubBitrix({ unregister: bitrixError('BOT_NOT_FOUND') });
    const row = await newAgent({ status: 'DELETED', deletedAt: new Date() });
    await db.insert(agentBot).values({
      agentId: row.id,
      tenantId: owner.id,
      botId: '456',
      botCode: botCodeFor(row.id),
    });

    expect(await service.syncAgent(row.id)).toBe('unregistered');
    expect(await bodies(UNREGISTER)).toEqual([{ auth: 'portal-token', botId: 456 }]);
    expect(await botOf(row.id)).toBeUndefined();
  });

  it('app desinstalado ou sem credencial: não chama o Bitrix', async () => {
    await stubBitrix();
    const row = await newAgent();
    for (const status of ['UNINSTALLED', 'AUTH_ERROR'] as const) {
      await db.update(tenant).set({ status }).where(eq(tenant.id, owner.id));
      expect(await service.syncAgent(row.id)).toBe('skipped');
    }
    expect(await wiremock.count('POST', REGISTER)).toBe(0);
  });

  it('mudança do agente avisada pelo módulo de agentes registra na hora', async () => {
    await stubBitrix();
    const row = await newAgent();

    await events.emit({ agentId: row.id, tenantId: owner.id, kind: 'created' });

    expect((await botOf(row.id))!.botId).toBe('456');
  });

  it('desinstalação esquece os bots; reinstalação registra os agentes de novo', async () => {
    await stubBitrix();
    const active = await newAgent();
    const removed = await newAgent({ status: 'DELETED', deletedAt: new Date() });
    await service.syncAgent(active.id);

    await lifecycle.emit('onUninstalled', { ...owner, status: 'UNINSTALLED' });
    expect(await botOf(active.id)).toBeUndefined();

    await wiremock.reset();
    await stubBitrix();
    await lifecycle.emit('onInstalled', owner, { reinstall: true });
    expect((await botOf(active.id))!.botId).toBe('456');
    expect(await botOf(removed.id)).toBeUndefined();
    expect(await wiremock.count('POST', REGISTER)).toBe(1);
  });

  it('reconciliação pega só os divergentes', async () => {
    await stubBitrix();
    const synced = await newAgent();
    await service.syncAgent(synced.id);
    // O portal falso devolve sempre o bot 456; no Bitrix cada código tem o seu.
    await db.update(agentBot).set({ botId: '100' }).where(eq(agentBot.agentId, synced.id));
    const missing = await newAgent({ name: 'Sem bot' });
    const removedWithBot = await newAgent({ status: 'DELETED', deletedAt: new Date() });
    await db.insert(agentBot).values({
      agentId: removedWithBot.id,
      tenantId: owner.id,
      botId: '789',
      botCode: botCodeFor(removedWithBot.id),
    });
    await wiremock.reset();
    await stubBitrix();

    expect(await sync.reconcile()).toEqual({ pending: 2, synced: 2, failed: 0 });
    expect(await botOf(missing.id)).toBeDefined();
    expect(await botOf(removedWithBot.id)).toBeUndefined();
    expect(await wiremock.count('POST', UNREGISTER)).toBe(1);
  });
});
