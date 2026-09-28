import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ApiModule } from './api.module';
import { loadEnv } from './config/env';
import { contextMiddleware } from './shared/context/context.middleware';
import { configureFieldCipher } from './shared/crypto/field-cipher';
import { runMigrations } from './shared/database/migrate';
import { initMetrics } from './shared/metrics/metrics';

async function bootstrap(): Promise<void> {
  const env = loadEnv({ ...process.env, APP_ROLE: 'api' });
  initMetrics(env.APP_ROLE);
  configureFieldCipher(env.DATA_ENCRYPTION_KEY);
  if (env.RUN_MIGRATIONS) await runMigrations(env.DATABASE_URL);

  // rawBody: webhooks assinados (crmthink-platform) validam HMAC sobre o corpo original.
  const app = await NestFactory.create(ApiModule.forRoot(env), { bufferLogs: true, rawBody: true });
  app.use(contextMiddleware);
  // Frontend (app.) chama a API (api.) com o JWT da sessão no header; sem cookies.
  app.enableCors({
    origin: env.FRONTEND_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['x-trace-id'],
    maxAge: 600,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}

void bootstrap();
