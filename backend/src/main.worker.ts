import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadEnv } from './config/env';
import { initMetrics } from './shared/metrics/metrics';
import { startWorkerHttpServer } from './shared/metrics/worker-http-server';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const env = loadEnv({ ...process.env, APP_ROLE: 'worker' });
  initMetrics(env.APP_ROLE);

  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const server = startWorkerHttpServer(env.WORKER_HTTP_PORT);
  process.once('SIGTERM', () => server.close());
  logger.log(`worker iniciado; métricas em :${env.WORKER_HTTP_PORT}/metrics`);
}

void bootstrap();
