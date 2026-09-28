import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { EXCHANGES } from './topology';

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
        exchanges: [{ name: EXCHANGES.paymentsEvents, type: 'topic' }],
        connectionInitOptions: { wait: false },
        registerHandlers: env.APP_ROLE === 'worker',
        enableControllerDiscovery: true,
      }),
    }),
  ],
  exports: [RabbitMQModule],
})
export class MessagingModule {}
