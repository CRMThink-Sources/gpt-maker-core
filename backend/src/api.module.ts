import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { ConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { DOMAIN_MODULES } from './modules/domain.modules';
import { ApiExceptionFilter } from './shared/http/api-exception.filter';
import { HealthModule } from './shared/health/health.module';
import { MetricsModule } from './shared/metrics/metrics.module';
import { SharedModule } from './shared/shared.module';

/** Papel `api`: HTTP (frontend, backoffice) e webhooks (Bitrix, GPTMaker, crmthink-platform). */
@Module({})
export class ApiModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        ConfigModule.forRoot(env),
        SharedModule,
        HealthModule,
        MetricsModule,
        ...DOMAIN_MODULES,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}
