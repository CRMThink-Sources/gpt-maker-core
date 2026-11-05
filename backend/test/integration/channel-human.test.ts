import { randomBytes, randomUUID } from 'node:crypto';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Tenant } from '../../src/modules/tenancy/tenant.service';
import { BitrixClient } from '../../src/modules/bitrix/bitrix.client';
import { BotEventsService } from '../../src/modules/channel/bot-events.service';
import { HumanAttendance, humanFlagKey } from '../../src/modules/channel/human-attendance';
import { gptmakerChatIdFor, HumanHandoff } from '../../src/modules/channel/human-handoff';
import { TransferConsumer } from '../../src/modules/channel/transfer.consumer';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { WireMock } from '../support/wiremock';
import { testPool } from '../support/postgres';

const { agent, agentBot, aiModel, dialogState, tenant } = schema;
const GM_AGENT = 'GM-AGENT-1';
const OPERATOR = '/rest/imopenlines.bot.session.operator.json';
const TRANSFER = '/rest/imopenlines.bot.session.transfer.json';

// Transferência para humano e volta do agente (spec bitrix-chatbot-channel).
describe('atendimento humano', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let human: HumanAttendance;
  let handoff: HumanHandoff;
  let owner: Tenant;
  let agentId: string;

  const ok = (result: unknown) => ({ status: 200, jsonBody: { result } });
  const chatPath = (dialogId: string, action: 'start-human' | 'stop-human') =>
    `/v2/chat/${encodeURIComponent(gptmakerChatIdFor(GM_AGENT, owner.id, dialogId))}/${action}`;

  async function stubAll(overrides: { operator?: { status: number; jsonBody: unknown } } = {}) {
    await wiremock.stub({
      request: { method: 'POST', urlPath: OPERATOR },
      response: overrides.operator ?? ok(true),
    });
    await wiremock.stub({ request: { method: 'POST', urlPath: TRANSFER }, response: ok(true) });
    await wiremock.stub({
      request: { method: 'PUT', urlPathPattern: '/v2/chat/.+/(start|stop)-human' },
      response: { status: 200, jsonBody: { success: true } },
    });
  }

  const stateOf = async (dialogId: string) =>
    (
      await db
        .select()
        .from(dialogState)
        .where(and(eq(dialogState.tenantId, owner.id), eq(dialogState.dialogId, dialogId)))
    )[0];

  beforeAll(async () => {
    [postgres, redisContainer, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      WireMock.start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
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
    const gptmaker = new GptMakerClient(
      {
        baseUrl: `${wiremock.baseUrl}/v2`,
        token: 't',
        workspaceId: 'ws',
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
    human = new HumanAttendance(db, redis);
    handoff = new HumanHandoff(human, bitrix, gptmaker, db);

    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({ installationId: '77', memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    owner = row!;
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    const [created] = await db
      .insert(agent)
      .values({
        tenantId: owner.id,
        gptmakerAgentId: GM_AGENT,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId: model!.id,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    agentId = created!.id;
    await db
      .insert(agentBot)
      .values({ agentId, tenantId: owner.id, botId: '456', botCode: 'gptmaker_agent_x' });
  });

  beforeEach(async () => {
    await wiremock.reset();
    await redis.flushall();
    await db.delete(dialogState);
  });

  afterAll(async () => {
    await redis?.quit();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  it('onTransfer: marca o diálogo, transfere ao operador e avisa o GPTMaker', async () => {
    await stubAll();
    await expect(
      handoff.start({ tenantId: owner.id, agentId, dialogId: 'chat9498' }),
    ).resolves.toBe('started');

    expect(await stateOf('chat9498')).toMatchObject({
      agentId,
      humanActive: true,
      gptmakerChatId: `public-api-${GM_AGENT}-${owner.id}:chat9498`,
    });
    expect(await redis.get(humanFlagKey(owner.id, 'chat9498'))).toBe('1');
    expect(await human.isActive(owner.id, 'chat9498')).toBe(true);
    expect(await wiremock.bodies('POST', OPERATOR)).toMatchObject([{ CHAT_ID: 9498 }]);
    expect(await wiremock.count('PUT', chatPath('chat9498', 'start-human'))).toBe(1);
    // O atendimento do agente é encerrado no GPTMaker (RESOLVED), para as métricas.
    expect(await wiremock.count('PUT', chatPath('chat9498', 'stop-human'))).toBe(1);
  });

  it('diálogo já com operador (recusa do Bitrix): segue para o GPTMaker', async () => {
    await stubAll({
      operator: { status: 400, jsonBody: { error: 'WRONG_CHAT', error_description: 'x' } },
    });
    await handoff.start({ tenantId: owner.id, agentId, dialogId: 'chat1' });
    expect(await wiremock.count('PUT', chatPath('chat1', 'start-human'))).toBe(1);
  });

  it('fim do atendimento humano: desmarca e o agente volta (stop-human)', async () => {
    await stubAll();
    await handoff.start({ tenantId: owner.id, agentId, dialogId: 'chat2' });
    await expect(handoff.stop({ tenantId: owner.id, dialogId: 'chat2' })).resolves.toBe('stopped');

    expect(await stateOf('chat2')).toMatchObject({ humanActive: false, humanStartedAt: null });
    expect(await human.isActive(owner.id, 'chat2')).toBe(false);
    // Um na transferência (encerra o atendimento do agente) e um no fim do atendimento humano.
    expect(await wiremock.count('PUT', chatPath('chat2', 'stop-human'))).toBe(2);

    // Repetir não chama o GPTMaker de novo.
    await expect(handoff.stop({ tenantId: owner.id, dialogId: 'chat2' })).resolves.toBe('skipped');
    expect(await wiremock.count('PUT', chatPath('chat2', 'stop-human'))).toBe(2);
  });

  it('diálogo que nunca teve humano: nada a encerrar', async () => {
    await stubAll();
    await expect(handoff.stop({ tenantId: owner.id, dialogId: 'chat3' })).resolves.toBe('skipped');
    expect(await wiremock.count('PUT', chatPath('chat3', 'stop-human'))).toBe(0);
  });

  it('canal aberto: transfere para a fila do canal (D16)', async () => {
    await stubAll();
    await handoff.start({ tenantId: owner.id, agentId, dialogId: 'chat10', lineId: 12 });
    expect(await wiremock.bodies('POST', TRANSFER)).toMatchObject([
      { CHAT_ID: 10, QUEUE_ID: 12, LEAVE: 'N' },
    ]);
    expect(await wiremock.count('POST', OPERATOR)).toBe(0);
  });

  it('intenção do agente de destino: usa o chat recebido e grava o agente de origem (D17)', async () => {
    await stubAll();
    const [destino] = await db
      .insert(agent)
      .values({
        tenantId: owner.id,
        gptmakerAgentId: 'GM-AGENT-2',
        name: 'Bia',
        type: 'SALE',
        communicationType: 'NORMAL',
        modelId: (await db.select().from(aiModel))[0]!.id,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    const chat = gptmakerChatIdFor(GM_AGENT, owner.id, 'chat11');
    await handoff.start({
      tenantId: owner.id,
      agentId: destino!.id,
      dialogId: 'chat11',
      gptmakerChatId: chat,
    });
    expect(await stateOf('chat11')).toMatchObject({ agentId, gptmakerChatId: chat });
    expect(await wiremock.count('PUT', chatPath('chat11', 'start-human'))).toBe(1);
  });

  it('chat recebido de agente desconhecido: usa o chat do agente da intenção', async () => {
    await stubAll();
    await handoff.start({
      tenantId: owner.id,
      agentId,
      dialogId: 'chat12',
      gptmakerChatId: 'formato-inesperado:chat12',
    });
    expect(await stateOf('chat12')).toMatchObject({
      agentId,
      gptmakerChatId: gptmakerChatIdFor(GM_AGENT, owner.id, 'chat12'),
    });
    expect(await wiremock.count('PUT', chatPath('chat12', 'start-human'))).toBe(1);
  });

  describe('consumidor do onTransfer', () => {
    const consumer = () => new TransferConsumer();
    const event = (dialogId: string | null) => ({
      agentEventId: randomUUID(),
      tenantId: owner.id,
      agentId,
      event: 'onTransfer' as const,
      dialogId,
    });

    it('troca de agente no GPTMaker: só registra, sem atendimento humano (D18)', async () => {
      await stubAll();
      await expect(consumer().process(event('chat4'))).resolves.toBeUndefined();
      expect(await stateOf('chat4')).toBeUndefined();
      expect(await wiremock.count('POST', OPERATOR)).toBe(0);
    });

    it('sem diálogo (payload sem contextId): não faz nada', async () => {
      await expect(consumer().process(event(null))).resolves.toBeUndefined();
      expect(await wiremock.count('POST', OPERATOR)).toBe(0);
    });
  });

  describe('bot entrando no chat (sessão nova)', () => {
    const service = () => new BotEventsService({} as AmqpConnection, db, redis, handoff);

    it('diálogo com humano: encerra o atendimento humano', async () => {
      await stubAll();
      await handoff.start({ tenantId: owner.id, agentId, dialogId: 'chat6' });
      await expect(
        service().handle(owner, {
          event: 'ONIMBOTV2JOINCHAT',
          data: { bot: { id: '456' }, dialogId: 'chat6', chat: { id: '6' } },
        }),
      ).resolves.toBe('human-stopped');
      expect(await human.isActive(owner.id, 'chat6')).toBe(false);
    });

    it('diálogo sem humano ou bot de outro portal', async () => {
      await stubAll();
      await expect(
        service().handle(owner, {
          event: 'ONIMBOTV2JOINCHAT',
          data: { bot: { id: '456' }, chat: { dialogId: 'chat7' } },
        }),
      ).resolves.toBe('joined');
      await expect(
        service().handle(owner, {
          event: 'ONIMBOTV2JOINCHAT',
          data: { bot: { id: '999' }, dialogId: 'chat7' },
        }),
      ).resolves.toBe('unknown-bot');
      await expect(
        service().handle(owner, { event: 'ONIMBOTV2JOINCHAT', data: { bot: { id: '456' } } }),
      ).resolves.toBe('ignored-invalid');
    });
  });
});
