import { randomBytes, randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  HttpCode,
  type INestApplication,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../../src/config/config.module';
import type { Env } from '../../src/config/env';
import { AdminAuthController } from '../../src/modules/backoffice/admin-auth.controller';
import { AdminAuth, AdminAuthGuard } from '../../src/modules/backoffice/admin-auth.guard';
import { AdminAuthService } from '../../src/modules/backoffice/admin-auth.service';
import { AuditController } from '../../src/modules/backoffice/audit.controller';
import { AuditQueryService } from '../../src/modules/backoffice/audit-query.service';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { totpCode } from '../../src/modules/backoffice/credentials';
import { OperatorService } from '../../src/modules/backoffice/operator.service';
import { OperatorsController } from '../../src/modules/backoffice/operators.controller';
import { contextMiddleware } from '../../src/shared/context/context.middleware';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { DB } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { ApiExceptionFilter } from '../../src/shared/http/api-exception.filter';
import { REDIS } from '../../src/shared/redis/redis.module';
import { testPool } from '../support/postgres';

const H = { 'X-Backoffice': '1' };
const currentStep = () => Math.floor(Date.now() / 30_000);

/** Escritas sem auditoria própria, para exercitar o registro genérico. */
@Controller('admin/tenants')
class FakeTenantsController {
  @Post(':id/notes')
  @AdminAuth('ADMIN')
  @HttpCode(200)
  note(@Param('id') id: string, @Body() body: unknown) {
    return { id, body };
  }

  @Post(':id/explode')
  @AdminAuth('ADMIN')
  explode() {
    throw new UnprocessableEntityException('não deu');
  }
}

// Trilha de auditoria do backoffice (spec admin-backoffice, "Auditoria de ações"; tarefa 15.8).
describe('backoffice: auditoria', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let app: INestApplication;
  let operators: OperatorService;
  let admin: { id: string; cookie: string };
  let tenantId: string;

  async function signIn(role: 'ADMIN' | 'SUPPORT') {
    const email = `op-${randomBytes(3).toString('hex')}@empresa.com`;
    const created = await operators.create({ email, name: `Op ${role}`, role });
    const first = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email, password: created.temporaryPassword })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/admin/auth/totp')
      .set(H)
      .send({ challenge: first.body.challenge, code: totpCode(first.body.secret, currentStep()) })
      .expect(200);
    return {
      id: created.operator.id,
      cookie: String(second.headers['set-cookie']).split(';')[0]!,
    };
  }

  const audit = (query: Record<string, string> = {}, cookie = admin.cookie) =>
    request(app.getHttpServer())
      .get(`/admin/audit?${new URLSearchParams(query)}`)
      .set('Cookie', cookie);

  /** O registro genérico é gravado depois da resposta: espera ele aparecer. */
  async function waitFor(query: Record<string, string>, count: number) {
    for (let i = 0; i < 50; i++) {
      const res = await audit(query).expect(200);
      if (res.body.items.length >= count) return res.body;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('auditoria não apareceu');
  }

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const env = {
      BACKOFFICE_SESSION_IDLE_MINUTES: 120,
      BACKOFFICE_SESSION_MAX_HOURS: 12,
      BACKOFFICE_TRUSTED_DEVICE_DAYS: 30,
      BACKOFFICE_COOKIE_SECURE: false,
      BACKOFFICE_TOTP_ISSUER: 'ThinkFlow AI Backoffice',
    } as Env;
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminAuthController,
        OperatorsController,
        AuditController,
        FakeTenantsController,
      ],
      providers: [
        AdminAuthService,
        AdminAuthGuard,
        AuditService,
        AuditQueryService,
        OperatorService,
        { provide: ENV, useValue: env },
        { provide: DB, useValue: db },
        { provide: REDIS, useValue: redis },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(contextMiddleware);
    await app.init();
    operators = moduleRef.get(OperatorService);
  }, 120_000);

  beforeEach(async () => {
    await redis.flushall();
    await db.delete(schema.auditLog);
    admin = await signIn('ADMIN');
    const code = randomBytes(3).toString('hex');
    const [t] = await db
      .insert(schema.tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    tenantId = t!.id;
  });

  afterAll(async () => {
    await app?.close();
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('escrita sem registro próprio: grava rota, portal e corpo sem campos sensíveis', async () => {
    await request(app.getHttpServer())
      .post(`/admin/tenants/${tenantId}/notes`)
      .set(H)
      .set('Cookie', admin.cookie)
      .send({ text: 'ligar amanhã', password: 'segredo', nested: { apiToken: 'x' } })
      .expect(200);

    const { items } = await waitFor({ tenantId }, 1);
    expect(items[0]).toMatchObject({
      actor: { type: 'OPERATOR', id: admin.id, name: 'Op ADMIN' },
      tenant: { id: tenantId },
      action: 'POST /admin/tenants/:id/notes',
      entityType: 'http_request',
      entityId: `/admin/tenants/${tenantId}/notes`,
      after: {
        ok: true,
        params: { id: tenantId },
        body: { text: 'ligar amanhã', password: '[oculto]', nested: { apiToken: '[oculto]' } },
      },
    });
    expect(items[0].traceId).toBeTruthy();
  });

  it('escrita que falha também fica, com o código do erro', async () => {
    await request(app.getHttpServer())
      .post(`/admin/tenants/${tenantId}/explode`)
      .set(H)
      .set('Cookie', admin.cookie)
      .expect(422);
    const { items } = await waitFor({ tenantId }, 1);
    expect(items[0].after).toMatchObject({ ok: false, status: 422, error: 'HTTP_422' });
  });

  it('ação com registro próprio não duplica; logout é registrado', async () => {
    await request(app.getHttpServer())
      .post('/admin/operators')
      .set(H)
      .set('Cookie', admin.cookie)
      .send({ email: `novo-${randomUUID()}@empresa.com`, name: 'Novo', role: 'SUPPORT' })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { items } = await waitFor({ actorId: admin.id }, 1);
    expect(items.map((i: { action: string }) => i.action)).toEqual([
      'operator.created',
      'operator.login',
      'operator.totp_configured',
    ]);

    await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .set(H)
      .set('Cookie', admin.cookie)
      .expect(204);
    const other = await signIn('ADMIN');
    const after = await audit({ actorId: admin.id, action: 'operator.logout' }, other.cookie);
    expect(after.body.items).toHaveLength(1);
  });

  it('filtro por prefixo da ação e paginação por cursor, mais novas primeiro', async () => {
    for (const text of ['a', 'b', 'c']) {
      await request(app.getHttpServer())
        .post(`/admin/tenants/${tenantId}/notes`)
        .set(H)
        .set('Cookie', admin.cookie)
        .send({ text })
        .expect(200);
      await waitFor({ tenantId }, ['a', 'b', 'c'].indexOf(text) + 1);
    }
    const first = await audit({ action: 'POST /admin/tenants', limit: '2' }).expect(200);
    expect(
      first.body.items.map((i: { after: { body: { text: string } } }) => i.after.body.text),
    ).toEqual(['c', 'b']);
    const second = await audit({
      action: 'POST /admin/tenants',
      limit: '2',
      cursor: first.body.nextCursor,
    }).expect(200);
    expect(
      second.body.items.map((i: { after: { body: { text: string } } }) => i.after.body.text),
    ).toEqual(['a']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('SUPPORT não consulta a auditoria', async () => {
    const support = await signIn('SUPPORT');
    await audit({}, support.cookie).expect(403);
  });
});
