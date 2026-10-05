import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../../src/api.module';
import { loadEnv } from '../../src/config/env';
import { contextMiddleware } from '../../src/shared/context/context.middleware';
import { runMigrations } from '../../src/shared/database/migrate';
import { initMetrics } from '../../src/shared/metrics/metrics';
import { startRabbitMQ } from '../support/rabbitmq';
import { WireMock } from '../support/wiremock';

describe('api: health e métricas', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let rabbit: StartedRabbitMQContainer;
  let wiremock: WireMock;
  let app: INestApplication;

  beforeAll(async () => {
    [postgres, redis, rabbit, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      startRabbitMQ(),
      WireMock.start(),
    ]);
    // Workspace GPTMaker saudável, verificado em segundo plano no boot da API.
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/workspaces' },
      response: { status: 200, jsonBody: [{ id: 'ws-1', name: 'Partner' }] },
    });
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/workspace/ws-1/credits' },
      response: { status: 200, jsonBody: { credits: 500, status: 'ACTIVE' } },
    });
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL: postgres.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
      RABBITMQ_URL: rabbit.getAmqpUrl(),
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      GPTMAKER_API_URL: `${wiremock.baseUrl}/v2`,
      GPTMAKER_API_TOKEN: 'test-token',
      GPTMAKER_WORKSPACE_ID: 'ws-1',
      PLATFORM_URL: 'http://127.0.0.1:1',
      APP_CODE: 'crmthink.thinkflow',
      PLATFORM_API_KEY: 'test-key',
      PLATFORM_WEBHOOK_SECRETS: 'test-secret',
      STORAGE_ENDPOINT: 'http://127.0.0.1:1',
      STORAGE_ACCESS_KEY: 'test',
      STORAGE_SECRET_KEY: 'test',
    });
    initMetrics(env.APP_ROLE);
    await runMigrations(env.DATABASE_URL);
    const moduleRef = await Test.createTestingModule({
      imports: [ApiModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(contextMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop(), rabbit?.stop(), wiremock?.stop()]);
  });

  it('GET /health/live', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('GET /health/ready com todas as dependências', async () => {
    // A conexão AMQP é aberta em segundo plano (wait: false); aguarda ficar pronta.
    await expect
      .poll(async () => (await request(app.getHttpServer()).get('/health/ready')).status, {
        timeout: 20_000,
      })
      .toBe(200);
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.body.info).toMatchObject({
      postgres: { status: 'up' },
      redis: { status: 'up' },
      rabbitmq: { status: 'up' },
    });
  });

  it('GET /health inclui o workspace GPTMaker', async () => {
    await expect
      .poll(async () => (await request(app.getHttpServer()).get('/health')).status, {
        timeout: 20_000,
      })
      .toBe(200);
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.body.info.gptmaker).toMatchObject({
      status: 'up',
      subscriptionStatus: 'ACTIVE',
      credits: 500,
    });
  });

  it('devolve o trace id recebido', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'trace-abc-123');
    expect(res.headers['x-trace-id']).toBe('trace-abc-123');
  });

  it('GET /metrics', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('rota inexistente usa o envelope de erro', async () => {
    const res = await request(app.getHttpServer()).get('/nao-existe').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
