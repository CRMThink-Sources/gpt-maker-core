import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../../src/config/config.module';
import type { Env } from '../../src/config/env';
import { AdminAuthController } from '../../src/modules/backoffice/admin-auth.controller';
import { AdminAuthGuard } from '../../src/modules/backoffice/admin-auth.guard';
import { AdminAuthService } from '../../src/modules/backoffice/admin-auth.service';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { totpCode } from '../../src/modules/backoffice/credentials';
import { CrmGuidanceAdminController } from '../../src/modules/backoffice/crm-guidance-admin.controller';
import { CrmGuidanceAdminService } from '../../src/modules/backoffice/crm-guidance-admin.service';
import { OperatorService } from '../../src/modules/backoffice/operator.service';
import { CRM_GUIDANCE_DEFAULTS } from '../../src/modules/crm-tools/crm-guidance.defaults';
import { CrmGuidanceService } from '../../src/modules/crm-tools/crm-guidance.service';
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

// Orientações das ferramentas do CRM no backoffice (spec agent-crm-tools).
describe('backoffice: orientações do CRM', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let app: INestApplication;
  let operators: OperatorService;
  let guidance: CrmGuidanceService;
  let admin: { id: string; cookie: string };

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

  const put = (key: string, body: object, cookie = admin.cookie) =>
    request(app.getHttpServer())
      .put(`/admin/crm-guidance/${key}`)
      .set(H)
      .set('Cookie', cookie)
      .send(body);

  const audits = () =>
    db.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, 'crm_guidance'));

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
      controllers: [AdminAuthController, CrmGuidanceAdminController],
      providers: [
        AdminAuthService,
        AdminAuthGuard,
        AuditService,
        OperatorService,
        CrmGuidanceService,
        CrmGuidanceAdminService,
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
    guidance = moduleRef.get(CrmGuidanceService);
  }, 120_000);

  beforeEach(async () => {
    await redis.flushall();
    await db.delete(schema.auditLog);
    await db.delete(schema.crmToolGuidance);
    admin = await signIn('ADMIN');
  });

  afterAll(async () => {
    await app?.close();
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('lista os quatro textos com o padrão quando ninguém editou', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/crm-guidance')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(res.body).toHaveLength(4);
    expect(res.body[0]).toMatchObject({
      key: 'cliente_identificado',
      text: CRM_GUIDANCE_DEFAULTS.cliente_identificado,
      edited: false,
      updatedBy: null,
    });
  });

  it('ADMIN edita: vale na próxima leitura e fica na auditoria com antes e depois', async () => {
    await guidance.current(); // aquece o cache com o padrão
    const res = await put('negocios_do_cliente', {
      text: '  Responda só com estes negócios. ',
    }).expect(200);
    const saved = res.body.find((item: { key: string }) => item.key === 'negocios_do_cliente');
    expect(saved).toMatchObject({
      text: 'Responda só com estes negócios.',
      edited: true,
      updatedBy: 'Op ADMIN',
    });
    expect((await guidance.current()).negocios_do_cliente).toBe('Responda só com estes negócios.');

    const [entry] = await audits();
    expect(entry).toMatchObject({
      actorId: admin.id,
      action: 'crm_guidance.updated',
      entityId: 'negocios_do_cliente',
      before: { text: null },
      after: { text: 'Responda só com estes negócios.' },
    });
  });

  it('restaurar o padrão apaga a edição e audita o texto descartado', async () => {
    await put('escopo_dados', { text: 'Escopo novo.' }).expect(200);
    await request(app.getHttpServer())
      .delete('/admin/crm-guidance/escopo_dados')
      .set(H)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect((await guidance.current()).escopo_dados).toBe(CRM_GUIDANCE_DEFAULTS.escopo_dados);
    const reset = (await audits()).find((item) => item.action === 'crm_guidance.reset');
    expect(reset).toMatchObject({ before: { text: 'Escopo novo.' }, after: { text: null } });
  });

  it('SUPPORT consulta, mas não edita', async () => {
    const support = await signIn('SUPPORT');
    await request(app.getHttpServer())
      .get('/admin/crm-guidance')
      .set('Cookie', support.cookie)
      .expect(200);
    await put('escopo_dados', { text: 'Escopo novo.' }, support.cookie).expect(403);
    expect(await db.select().from(schema.crmToolGuidance)).toHaveLength(0);
  });

  it('recusa chave desconhecida e texto inválido', async () => {
    await put('outra_chave', { text: 'x' }).expect(404);
    await put('escopo_dados', { text: '   ' }).expect(400);
    await put('escopo_dados', { text: 'a'.repeat(1001) }).expect(400);
    expect(await db.select().from(schema.crmToolGuidance)).toHaveLength(0);
  });
});
