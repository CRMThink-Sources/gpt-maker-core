import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../src/config/config.module';
import { loadEnv } from '../../src/config/env';
import { DeadLetterInspector } from '../../src/modules/backoffice/dead-letter-inspector';
import { MessagingModule } from '../../src/shared/messaging/messaging.module';
import { CHANNEL_HEADERS, EXCHANGES, QUEUES } from '../../src/shared/messaging/topology';
import { startRabbitMQ } from '../support/rabbitmq';

// DLQs do canal no backoffice (tarefa 15.7), num RabbitMQ real.
describe('DLQ: inspeção e descarte', () => {
  let rabbit: StartedRabbitMQContainer;
  let app: INestApplicationContext;
  let amqp: AmqpConnection;
  let inspector: DeadLetterInspector;
  const tenantId = randomUUID();

  async function waitSize(key: 'inbound' | 'transfer', size: number) {
    for (let i = 0; i < 100; i++) {
      if ((await inspector.size(key)) === size) return;
      await sleep(30);
    }
    throw new Error(`fila ${key} não chegou a ${size}`);
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
    });
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(env), MessagingModule],
      providers: [DeadLetterInspector],
    }).compile();
    app = await moduleRef.init();
    amqp = app.get(AmqpConnection);
    await amqp.managedConnection.connect();
    inspector = app.get(DeadLetterInspector);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await rabbit?.stop();
  });

  it('espia sem consumir, só metadados, e descarta', async () => {
    for (const messageId of [101, 102]) {
      await amqp.publish(
        EXCHANGES.channelDeadLetter,
        `${tenantId}:chat1`,
        {
          tenantId,
          agentId: 'agente-1',
          dialogId: 'chat1',
          messageId,
          text: 'dado do cliente',
          receivedAt: '2026-10-04T12:00:00.000Z',
        },
        { headers: { [CHANNEL_HEADERS.attempt]: 4, [CHANNEL_HEADERS.lastError]: 'GPTMaker fora' } },
      );
    }
    await waitSize('inbound', 2);

    const peeked = await inspector.peek('inbound', 10);
    expect(peeked).toEqual([
      {
        tenantId,
        agentId: 'agente-1',
        dialogId: 'chat1',
        reference: '101',
        attempts: 4,
        lastError: 'GPTMaker fora',
        receivedAt: '2026-10-04T12:00:00.000Z',
      },
      expect.objectContaining({ reference: '102' }),
    ]);
    expect(JSON.stringify(peeked)).not.toContain('dado do cliente');
    // Continuam lá, na mesma ordem.
    await waitSize('inbound', 2);
    expect((await inspector.peek('inbound', 1))[0]?.reference).toBe('101');

    expect(await inspector.purge('inbound')).toBe(2);
    expect(await inspector.size('inbound')).toBe(0);
  });

  it('DLQ da transferência: referência do evento e tentativas pelo x-death', async () => {
    await amqp.channel.sendToQueue(
      QUEUES.channelTransferDeadLetter,
      Buffer.from(JSON.stringify({ tenantId, agentId: 'a', agentEventId: 'ev-1', dialogId: null })),
      { headers: { 'x-death': [{ count: 1, queue: QUEUES.channelTransfer }] } },
    );
    await waitSize('transfer', 1);
    expect(await inspector.peek('transfer', 5)).toEqual([
      expect.objectContaining({ tenantId, reference: 'ev-1', attempts: 1, lastError: null }),
    ]);
    await inspector.purge('transfer');
  });
});
