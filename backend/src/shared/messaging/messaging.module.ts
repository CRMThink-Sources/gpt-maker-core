import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import {
  AMQP_CHANNELS,
  channelInboundQueue,
  channelRetryName,
  EXCHANGES,
  QUEUES,
  USAGE_EVENTS,
} from './topology';

/** Topologia de `channel.inbound` (design D5): partições, esperas de retentativa e DLQ. */
function channelTopology(env: Env) {
  const partitions = Array.from({ length: env.CHANNEL_INBOUND_PARTITIONS }, (_, index) => ({
    name: channelInboundQueue(index),
    createQueueIfNotExists: true,
    options: { durable: true },
    exchange: EXCHANGES.channelInbound,
    // Peso da partição no consistent hash.
    routingKey: '1',
  }));
  // Sem `x-dead-letter-routing-key`: ao vencer, volta com a routing key original (o diálogo).
  const retries = env.CHANNEL_RETRY_DELAYS_MS.map((delayMs) => ({
    name: channelRetryName(delayMs),
    createQueueIfNotExists: true,
    options: {
      durable: true,
      arguments: {
        'x-message-ttl': delayMs,
        'x-dead-letter-exchange': EXCHANGES.channelInbound,
      },
    },
    exchange: channelRetryName(delayMs),
    routingKey: '',
  }));
  return {
    exchanges: [
      { name: EXCHANGES.channelInbound, type: 'x-consistent-hash' },
      { name: EXCHANGES.channelDeadLetter, type: 'fanout' },
      ...env.CHANNEL_RETRY_DELAYS_MS.map((delayMs) => ({
        name: channelRetryName(delayMs),
        type: 'fanout',
      })),
    ],
    queues: [
      ...partitions,
      ...retries,
      {
        name: QUEUES.channelDeadLetter,
        createQueueIfNotExists: true,
        options: { durable: true },
        exchange: EXCHANGES.channelDeadLetter,
        routingKey: '',
      },
    ],
  };
}

/**
 * Conexão RabbitMQ compartilhada. A API só publica; handlers (`@RabbitSubscribe`) são
 * registrados apenas no papel `worker`. Exchanges e filas ficam em `topology.ts` e são declaradas
 * pelos dois papéis: a API publica sem perder mensagem mesmo antes do worker subir.
 */
@Global()
@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => {
        const channel = channelTopology(env);
        return {
          uri: env.RABBITMQ_URL,
          exchanges: [
            { name: EXCHANGES.paymentsEvents, type: 'topic' },
            { name: EXCHANGES.usageEvents, type: 'topic' },
            { name: EXCHANGES.triggersEvents, type: 'topic' },
            ...channel.exchanges,
          ],
          queues: [
            ...channel.queues,
            {
              name: QUEUES.usageResponse,
              createQueueIfNotExists: true,
              options: { durable: true },
              exchange: EXCHANGES.usageEvents,
              routingKey: USAGE_EVENTS.response,
            },
            {
              name: QUEUES.triggerEvaluation,
              createQueueIfNotExists: true,
              options: { durable: true },
              exchange: EXCHANGES.triggersEvents,
              routingKey: '#',
            },
            {
              name: QUEUES.channelTransferDeadLetter,
              createQueueIfNotExists: true,
              options: { durable: true },
            },
            {
              name: QUEUES.channelTransfer,
              createQueueIfNotExists: true,
              // Nack sem requeue vai para a DLQ pela exchange padrão.
              options: {
                durable: true,
                arguments: {
                  'x-dead-letter-exchange': '',
                  'x-dead-letter-routing-key': QUEUES.channelTransferDeadLetter,
                },
              },
              exchange: EXCHANGES.triggersEvents,
              routingKey: 'onTransfer',
            },
          ],
          channels: { [AMQP_CHANNELS.channelInbound]: { prefetchCount: 1 } },
          connectionInitOptions: { wait: false },
          registerHandlers: env.APP_ROLE === 'worker',
          enableControllerDiscovery: true,
        };
      },
    }),
  ],
  exports: [RabbitMQModule],
})
export class MessagingModule {}
