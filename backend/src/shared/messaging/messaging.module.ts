import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { channelInboundQueue, EXCHANGES } from './topology';

/**
 * Conexão RabbitMQ compartilhada. A API só publica; handlers (`@RabbitSubscribe`) são
 * registrados apenas no papel `worker`. Exchanges e filas ficam em `topology.ts`.
 */
@Global()
@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        uri: env.RABBITMQ_URL,
        exchanges: [
          { name: EXCHANGES.paymentsEvents, type: 'topic' },
          { name: EXCHANGES.channelInbound, type: 'x-consistent-hash' },
        ],
        // Partições declaradas pelos dois papéis: a API publica sem perder mensagem mesmo antes
        // do worker subir. Peso "1" por fila (routing key do consistent hash).
        queues: Array.from({ length: env.CHANNEL_INBOUND_PARTITIONS }, (_, index) => ({
          name: channelInboundQueue(index),
          createQueueIfNotExists: true,
          options: { durable: true },
          exchange: EXCHANGES.channelInbound,
          routingKey: '1',
        })),
        connectionInitOptions: { wait: false },
        registerHandlers: env.APP_ROLE === 'worker',
        enableControllerDiscovery: true,
      }),
    }),
  ],
  exports: [RabbitMQModule],
})
export class MessagingModule {}
