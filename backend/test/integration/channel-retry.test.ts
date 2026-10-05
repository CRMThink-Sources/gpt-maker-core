import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../src/config/config.module';
import { loadEnv } from '../../src/config/env';
import { dialogKey, type InboundMessage } from '../../src/modules/channel/inbound-message';
import { attemptOf, InboundRetry } from '../../src/modules/channel/inbound-retry';
import { MessagingModule } from '../../src/shared/messaging/messaging.module';
import {
  channelInboundQueue,
  channelRetryName,
  EXCHANGES,
  QUEUES,
} from '../../src/shared/messaging/topology';
import { startRabbitMQ } from '../support/rabbitmq';

const PARTITIONS = 4;
const DELAYS = [300, 600];

// Topologia de retentativa de `channel.inbound` (design D5) num RabbitMQ real.
describe('retentativa e DLQ das mensagens do chatbot', () => {
  let rabbit: StartedRabbitMQContainer;
  let app: INestApplicationContext;
  let amqp: AmqpConnection;
  let retry: InboundRetry;

  const message = (dialogId = `chat${randomBytes(3).toString('hex')}`): InboundMessage => ({
    tenantId: randomUUID(),
    agentId: randomUUID(),
    botId: 456,
    dialogId,
    chatId: 5,
    messageId: Math.floor(Math.random() * 1_000_000),
    text: 'Oi',
    params: null,
    user: { id: 12, name: 'Maria', connector: true },
    chat: {
      type: 'openChannel',
      entityType: 'LINES',
      entityId: '',
      entityData1: '',
      entityData2: '',
      entityData3: '',
    },
    language: 'br',
    receivedAt: new Date().toISOString(),
  });

  type Delivered = { queue: string; body: InboundMessage; headers: Record<string, unknown> };

  /** Tudo o que estiver nas filas indicadas agora (consome). */
  async function drain(queues: string[]): Promise<Delivered[]> {
    const found: Delivered[] = [];
    for (const queue of queues) {
      for (;;) {
        const got = await amqp.channel.get(queue, { noAck: true });
        if (!got) break;
        found.push({
          queue,
          body: JSON.parse(got.content.toString()) as InboundMessage,
          headers: (got.properties.headers ?? {}) as Record<string, unknown>,
        });
      }
    }
    return found;
  }

  const partitions = Array.from({ length: PARTITIONS }, (_, index) => channelInboundQueue(index));

  /** Espera a mensagem chegar a alguma partição (a fila de espera devolve sozinha). */
  async function waitInPartitions(timeoutMs: number): Promise<Delivered[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = await drain(partitions);
      if (found.length || Date.now() > deadline) return found;
      await sleep(50);
    }
  }

  beforeAll(async () => {
    rabbit = await startRabbitMQ();
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL: 'postgres://u:p@localhost:1/db',
      REDIS_URL: 'redis://localhost:1',
      RABBITMQ_URL: rabbit.getAmqpUrl(),
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      GPTMAKER_API_TOKEN: 't',
      GPTMAKER_WORKSPACE_ID: 'ws',
      PLATFORM_URL: 'http://127.0.0.1:1',
      APP_CODE: 'crmthink.thinkflow',
      PLATFORM_API_KEY: 'k',
      PLATFORM_WEBHOOK_SECRETS: 's',
      STORAGE_ENDPOINT: 'http://127.0.0.1:1',
      STORAGE_ACCESS_KEY: 'k',
      STORAGE_SECRET_KEY: 's',
      CHANNEL_INBOUND_PARTITIONS: String(PARTITIONS),
      CHANNEL_RETRY_DELAYS_MS: DELAYS.join(','),
    });
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(env), MessagingModule],
      providers: [InboundRetry],
    }).compile();
    app = await moduleRef.init();
    amqp = app.get(AmqpConnection);
    await amqp.managedConnection.connect();
    // A topologia é declarada no canal gerenciado; espera ficar pronta.
    for (let i = 0; i < 100; i++) {
      try {
        await amqp.channel.checkQueue(QUEUES.channelDeadLetter);
        break;
      } catch {
        await sleep(100);
      }
    }
    retry = app.get(InboundRetry);
  }, 120_000);

  beforeEach(async () => {
    await drain([...partitions, QUEUES.channelDeadLetter]);
  });

  afterAll(async () => {
    await app?.close();
    await rabbit?.stop();
  });

  it('declara partições, filas de espera com TTL e a DLQ', async () => {
    for (const queue of [...partitions, QUEUES.channelDeadLetter]) {
      await expect(amqp.channel.checkQueue(queue)).resolves.toMatchObject({ queue });
    }
    for (const delay of DELAYS) {
      await expect(amqp.channel.checkQueue(channelRetryName(delay))).resolves.toBeDefined();
    }
  });

  it('retentativa espera e volta à mesma partição do diálogo, com a tentativa no cabeçalho', async () => {
    const original = message();
    await amqp.publish(EXCHANGES.channelInbound, dialogKey(original), original);
    const [first] = await waitInPartitions(2000);
    expect(first).toBeDefined();

    const outcome = await retry.retryOrDeadLetter(first!.body, 0, new Error('GPTMaker fora do ar'));
    expect(outcome).toEqual({ kind: 'retry', attempt: 1, delayMs: 300 });
    // Ainda na espera.
    expect(await drain(partitions)).toEqual([]);

    const [back] = await waitInPartitions(3000);
    expect(back).toMatchObject({
      queue: first!.queue,
      body: { messageId: original.messageId, dialogId: original.dialogId },
      headers: { 'x-attempt': 1, 'x-last-error': 'GPTMaker fora do ar' },
    });
    expect(attemptOf(back!.headers)).toBe(1);
  });

  it('cada tentativa usa a espera seguinte', async () => {
    const outcome = await retry.retryOrDeadLetter(message(), 1, new Error('timeout'));
    expect(outcome).toEqual({ kind: 'retry', attempt: 2, delayMs: 600 });
    const started = Date.now();
    const [back] = await waitInPartitions(3000);
    expect(back!.headers['x-attempt']).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });

  it('esgotadas as tentativas, vai para a DLQ e não volta', async () => {
    const outcome = await retry.retryOrDeadLetter(message('chat-dlq'), 2, new Error('ainda fora'));
    expect(outcome).toEqual({ kind: 'dead-letter', attempts: 3 });

    await sleep(800);
    expect(await drain(partitions)).toEqual([]);
    expect(await drain([QUEUES.channelDeadLetter])).toMatchObject([
      { body: { dialogId: 'chat-dlq' }, headers: { 'x-attempt': 3, 'x-last-error': 'ainda fora' } },
    ]);
  });

  it('primeira entrega não tem tentativa anterior', () => {
    expect(attemptOf(undefined)).toBe(0);
    expect(attemptOf({})).toBe(0);
    expect(attemptOf({ 'x-attempt': '2' })).toBe(2);
  });
});
