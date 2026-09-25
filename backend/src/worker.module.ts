import { DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { DOMAIN_MODULES } from './modules/domain.modules';
import { SharedModule } from './shared/shared.module';

/** Papel `worker`: consumidores RabbitMQ e jobs agendados. Sem servidor HTTP do Nest. */
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(env),
        SharedModule,
        ScheduleModule.forRoot(),
        ...DOMAIN_MODULES,
      ],
    };
  }
}
