import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ApiModule } from './api.module';
import { loadEnv } from './config/env';
import { contextMiddleware } from './shared/context/context.middleware';
import { initMetrics } from './shared/metrics/metrics';

async function bootstrap(): Promise<void> {
  const env = loadEnv({ ...process.env, APP_ROLE: 'api' });
  initMetrics(env.APP_ROLE);

  // rawBody: webhooks assinados (crmthink-platform) validam HMAC sobre o corpo original.
  const app = await NestFactory.create(ApiModule.forRoot(env), { bufferLogs: true, rawBody: true });
  app.use(contextMiddleware);
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}

void bootstrap();
