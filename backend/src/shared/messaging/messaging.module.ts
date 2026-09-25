import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Conexão RabbitMQ compartilhada. A API só publica; handlers (`@RabbitSubscribe`) são
 * registrados apenas no papel `worker`. Exchanges e filas entram nas seções 9, 10 e 12.
 */
@Global()
@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        uri: env.RABBITMQ_URL,
        connectionInitOptions: { wait: false },
        registerHandlers: env.APP_ROLE === 'worker',
        enableControllerDiscovery: true,
      }),
    }),
  ],
  exports: [RabbitMQModule],
})
export class MessagingModule {}
