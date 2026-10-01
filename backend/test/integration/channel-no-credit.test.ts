import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BitrixClient } from '../../src/modules/bitrix/bitrix.client';
import type { InboundMessage } from '../../src/modules/channel/inbound-message';
import {
  NO_CREDIT_NOTICE,
  NoCreditHandler,
  noCreditMarkerKey,
} from '../../src/modules/channel/no-credit.handler';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { WireMock } from '../support/wiremock';

const { agent, aiModel, messageLog, tenant } = schema;
const SEND = '/rest/imbot.v2.Chat.Message.send.json';
const OPERATOR = '/rest/imopenlines.bot.session.operator.json';

// Tenant sem saldo (spec bitrix-chatbot-channel: saldo insuficiente), WireMock no papel do portal.
describe('mensagem de tenant sem créditos', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let handler: NoCreditHandler;
  let tenantId: string;
  let agentId: string;

  const ok = (result: unknown) => ({ status: 200, jsonBody: { result } });
  const bitrixError = (code: string, status = 400) => ({
    status,
    jsonBody: { error: code, error_description: code },
  });

  const message = (dialogId = `chat${Math.floor(Math.random() * 100_000)}`): InboundMessage => ({
    tenantId,
    agentId,
    botId: 456,
    dialogId,
    chatId: Number(dialogId.replace('chat', '')),
    messageId: Math.floor(Math.random() * 1_000_000),
    text: 'Oi',
    params: null,
    user: { id: 12, name: 'Maria', connector: true },
    chat: {
      type: 'lines',
      entityType: 'LINES',
      entityId: '',
      entityData1: '',
      entityData2: '',
      entityData3: '',
    },
    language: 'br',
    receivedAt: new Date().toISOString(),
  });

  async function stubPortal(
    overrides: {
      send?: { status: number; jsonBody: unknown };
      operator?: { status: number; jsonBody: unknown };
    } = {},
  ) {
    await wiremock.stub({
      request: { method: 'POST', urlPath: SEND },
      response: overrides.send ?? ok({ id: 7001 }),
    });
    await wiremock.stub({
      request: { method: 'POST', urlPath: OPERATOR },
      response: overrides.operator ?? ok(true),
    });
  }

  const logOf = (inbound: InboundMessage) =>
    db
      .select()
      .from(messageLog)
      .where(
        and(
          eq(messageLog.tenantId, tenantId),
          eq(messageLog.bitrixMessageId, String(inbound.messageId)),
        ),
      );

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
    handler = new NoCreditHandler(bitrix, db, redis);

    const code = randomBytes(3).toString('hex');
    const [owner] = await db
      .insert(tenant)
      .values({ installationId: '77', memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner!.id,
        gptmakerAgentId: 'gm-1',
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId: model!.id,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    tenantId = owner!.id;
    agentId = row!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await redis.flushall();
  });

  afterAll(async () => {
    await redis?.quit();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  it('avisa com mensagem de sistema, transfere ao operador e registra BLOCKED_NO_CREDIT', async () => {
    await stubPortal();
    const inbound = message('chat9498');
    await expect(handler.handle(inbound, 77, 0)).resolves.toBe('notified');

    expect(await wiremock.bodies('POST', SEND)).toMatchObject([
      {
        botId: 456,
        dialogId: 'chat9498',
        fields: { message: NO_CREDIT_NOTICE, system: true },
      },
    ]);
    expect(await wiremock.bodies('POST', OPERATOR)).toMatchObject([{ CHAT_ID: 9498 }]);
    expect(await logOf(inbound)).toMatchObject([
      { direction: 'IN', status: 'BLOCKED_NO_CREDIT', attempts: 1, dialogId: 'chat9498' },
    ]);
  });

  it('mensagens seguidas no mesmo diálogo: um aviso só, todas registradas', async () => {
    await stubPortal();
    const first = message('chat100');
    const second = { ...message('chat100'), messageId: first.messageId + 1 };
    await handler.handle(first, 77, 0);
    await expect(handler.handle(second, 77, 0)).resolves.toBe('already-notified');

    expect(await wiremock.count('POST', SEND)).toBe(1);
    expect(await wiremock.count('POST', OPERATOR)).toBe(1);
    expect(await logOf(second)).toMatchObject([{ status: 'BLOCKED_NO_CREDIT' }]);
  });

  it('transferência fora do ar: a retentativa transfere sem repetir o aviso', async () => {
    await stubPortal({ operator: bitrixError('INTERNAL', 503) });
    const inbound = message();
    await expect(handler.handle(inbound, 77, 0)).rejects.toThrow();
    expect(await redis.get(noCreditMarkerKey(inbound))).toBe('notified');

    await wiremock.reset();
    await stubPortal();
    await expect(handler.handle(inbound, 77, 1)).resolves.toBe('notified');
    expect(await wiremock.count('POST', SEND)).toBe(0);
    expect(await wiremock.count('POST', OPERATOR)).toBe(1);
    expect(await logOf(inbound)).toHaveLength(1);
  });

  it('diálogo já com operador (recusa do Bitrix): não impede, só registra', async () => {
    await stubPortal({ operator: bitrixError('WRONG_CHAT') });
    const inbound = message();
    await expect(handler.handle(inbound, 77, 0)).resolves.toBe('notified');
    expect(await redis.get(noCreditMarkerKey(inbound))).toBe('transferred');
  });
});
