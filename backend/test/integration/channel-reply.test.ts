import { randomBytes, randomUUID } from 'node:crypto';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BitrixClient } from '../../src/modules/bitrix/bitrix.client';
import { BitrixError } from '../../src/modules/bitrix/bitrix.errors';
import { isPermanentProcessingError } from '../../src/modules/channel/inbound.consumer';
import type { InboundMessage } from '../../src/modules/channel/inbound-message';
import type { UsageResponseEvent } from '../../src/modules/billing/usage-debit.consumer';
import { ReplyPublisher, sentMarkerKey } from '../../src/modules/channel/reply-publisher';
import { GptMakerError } from '../../src/modules/gptmaker/gptmaker.errors';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { EXCHANGES, USAGE_EVENTS } from '../../src/shared/messaging/topology';
import { WireMock } from '../support/wiremock';

const { agent, aiModel, messageLog, tenant } = schema;
const SEND = '/rest/imbot.v2.Chat.Message.send.json';

// Resposta do agente no diálogo do Bitrix e evento de consumo (spec bitrix-chatbot-channel).
describe('publicação da resposta no Bitrix', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let publisher: ReplyPublisher;
  let tenantId: string;
  let agentId: string;
  const events: Array<{ exchange: string; routingKey: string; body: UsageResponseEvent }> = [];
  let amqpFails = false;

  const amqp = {
    publish: async (exchange: string, routingKey: string, body: UsageResponseEvent) => {
      if (amqpFails) throw new Error('rabbit fora');
      events.push({ exchange, routingKey, body });
      return true;
    },
  } as unknown as AmqpConnection;

  const target = { gptmakerAgentId: 'gm-1', installationId: 77, modelCode: 'GPT_5_MINI' };

  const message = (): InboundMessage => ({
    tenantId,
    agentId,
    botId: 456,
    dialogId: 'chat9498',
    chatId: 9498,
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

  const sends = () => wiremock.bodies('POST', SEND) as Promise<Array<Record<string, unknown>>>;
  const logOf = (inbound: InboundMessage) =>
    db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.dialogId, inbound.dialogId)));

  async function stubSend(
    response: { status: number; jsonBody: unknown } = {
      status: 200,
      jsonBody: { result: { id: 5001 } },
    },
  ) {
    await wiremock.stub({ request: { method: 'POST', urlPath: SEND }, response });
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
    publisher = new ReplyPublisher(bitrix, amqp, db, redis);

    const code = randomBytes(3).toString('hex');
    const [owner] = await db
      .insert(tenant)
      .values({
        installationId: '77',
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
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
    await db.delete(messageLog);
    events.length = 0;
    amqpFails = false;
  });

  afterAll(async () => {
    await redis?.quit();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  it('envia pelo bot no diálogo, registra entrada e saída e emite usage.response', async () => {
    await stubSend();
    const inbound = message();
    const outcome = await publisher.publish(
      inbound,
      target,
      { message: '**Olá**, Maria!', images: ['https://cdn.gptmaker.ai/a.png'] },
      0,
      new Date('2026-10-01T12:00:00Z'),
    );
    expect(outcome).toBe('sent');

    expect(await sends()).toMatchObject([
      {
        botId: 456,
        dialogId: 'chat9498',
        fields: {
          message: '[B]Olá[/B], Maria!',
          attach: { BLOCKS: [{ IMAGE: { LINK: 'https://cdn.gptmaker.ai/a.png' } }] },
        },
      },
    ]);
    const logs = await logOf(inbound);
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'IN',
          bitrixMessageId: String(inbound.messageId),
          status: 'RESPONDED',
          modelCode: 'GPT_5_MINI',
          attempts: 1,
        }),
        expect.objectContaining({ direction: 'OUT', bitrixMessageId: '5001', status: 'RESPONDED' }),
      ]),
    );
    expect(events).toEqual([
      {
        exchange: EXCHANGES.usageEvents,
        routingKey: USAGE_EVENTS.response,
        body: {
          messageId: `${tenantId}:456:${inbound.messageId}`,
          tenantId,
          agentId,
          dialogId: 'chat9498',
          modelCode: 'GPT_5_MINI',
          replyMessageId: 5001,
          respondedAt: '2026-10-01T12:00:00.000Z',
        },
      },
    ]);
  });

  it('falha depois do envio: a retentativa não manda de novo ao cliente', async () => {
    await stubSend();
    const inbound = message();
    amqpFails = true;
    await expect(publisher.publish(inbound, target, { message: 'Oi' }, 0)).rejects.toThrow(
      'rabbit fora',
    );
    expect(await redis.get(sentMarkerKey(inbound))).toBe('5001');

    amqpFails = false;
    await expect(publisher.publish(inbound, target, { message: 'Oi' }, 1)).resolves.toBe(
      'already-sent',
    );
    expect(await sends()).toHaveLength(1);
    expect(events).toHaveLength(1);
    const logs = await logOf(inbound);
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.attempts === 2)).toBe(true);
  });

  it('resposta sem texto nem mídia não é enviada nem debitada', async () => {
    await stubSend();
    await expect(
      publisher.publish(message(), target, { message: '', images: [] }, 0),
    ).resolves.toBe('empty');
    expect(await sends()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('erro do Bitrix no envio: nada registrado nem debitado', async () => {
    await stubSend({
      status: 400,
      jsonBody: { error: 'ERROR_INVALID_DIALOG', error_description: 'x' },
    });
    const inbound = message();
    const error = await publisher
      .publish(inbound, target, { message: 'Oi' }, 0)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BitrixError);
    expect(isPermanentProcessingError(error)).toBe(true);
    expect(await redis.get(sentMarkerKey(inbound))).toBeNull();
    expect(await logOf(inbound)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('quais erros vão direto para a DLQ', () => {
    expect(
      isPermanentProcessingError(new BitrixError('API_ERROR', 'm', 'ERROR_ACCESS_DENIED', '')),
    ).toBe(true);
    expect(isPermanentProcessingError(new BitrixError('UNAVAILABLE', 'm', 'x', ''))).toBe(false);
    expect(isPermanentProcessingError(new BitrixError('RATE_LIMITED', 'm', 'x', ''))).toBe(false);
    expect(isPermanentProcessingError(new GptMakerError('VALIDATION', 'op', 'x'))).toBe(true);
    expect(isPermanentProcessingError(new Error('x'))).toBe(false);
  });
});
