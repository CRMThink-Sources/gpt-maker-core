import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
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
import { AdminAuthGuard } from '../../src/modules/backoffice/admin-auth.guard';
import { AdminAuthService } from '../../src/modules/backoffice/admin-auth.service';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { totpCode } from '../../src/modules/backoffice/credentials';
import { OperatorService } from '../../src/modules/backoffice/operator.service';
import { OperatorsController } from '../../src/modules/backoffice/operators.controller';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { DB } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { ApiExceptionFilter } from '../../src/shared/http/api-exception.filter';
import { REDIS } from '../../src/shared/redis/redis.module';
import { testPool } from '../support/postgres';

const H = { 'X-Backoffice': '1' };
const currentStep = () => Math.floor(Date.now() / 30_000);

// Login do backoffice (spec admin-backoffice, design D17): senha + TOTP, perfis, sessão em cookie.
describe('backoffice: autenticação', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let app: INestApplication;
  let operators: OperatorService;
  let auth: AdminAuthService;
  let email: string;
  let password: string;

  /** Login completo; devolve o cookie e o segredo TOTP. */
  async function signIn(
    who = email,
    pass = password,
    secret?: string,
    step = currentStep(),
  ): Promise<{ cookie: string; secret: string }> {
    const first = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email: who, password: pass })
      .expect(200);
    const totpSecret = secret ?? first.body.secret;
    const second = await request(app.getHttpServer())
      .post('/admin/auth/totp')
      .set(H)
      .send({ challenge: first.body.challenge, code: totpCode(totpSecret, step) })
      .expect(200);
    const cookie = String(second.headers['set-cookie']).split(';')[0]!;
    return { cookie, secret: totpSecret };
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
      controllers: [AdminAuthController, OperatorsController],
      providers: [
        AdminAuthService,
        AdminAuthGuard,
        AuditService,
        OperatorService,
        { provide: ENV, useValue: env },
        { provide: DB, useValue: db },
        { provide: REDIS, useValue: redis },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    operators = moduleRef.get(OperatorService);
    auth = moduleRef.get(AdminAuthService);
  }, 120_000);

  beforeEach(async () => {
    await redis.flushall();
    email = `ana-${randomBytes(3).toString('hex')}@empresa.com`;
    ({ temporaryPassword: password } = await operators.create({
      email,
      name: 'Ana',
      role: 'ADMIN',
    }));
  });

  afterAll(async () => {
    await app?.close();
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('primeiro acesso: configura o TOTP, abre a sessão e /me responde', async () => {
    const first = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email: email.toUpperCase(), password })
      .expect(200);
    expect(first.body).toMatchObject({ step: 'totp-setup' });
    expect(first.body.otpauthUrl).toContain('otpauth://totp/');

    const second = await request(app.getHttpServer())
      .post('/admin/auth/totp')
      .set(H)
      .send({ challenge: first.body.challenge, code: totpCode(first.body.secret, currentStep()) })
      .expect(200);
    const setCookie = String(second.headers['set-cookie']);
    expect(setCookie).toContain('gm_admin=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    const me = await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Cookie', setCookie.split(';')[0]!)
      .expect(200);
    expect(me.body.operator).toMatchObject({ email, role: 'ADMIN' });
    expect((await operators.findByEmail(email))?.totpSecret).toBeTruthy();
  });

  it('segundo acesso pede só o código; o mesmo código não vale duas vezes', async () => {
    // Um passo fixo para o teste todo: a virada dos 30 s no meio não muda o código repetido.
    const step = currentStep();
    const { secret } = await signIn(email, password, undefined, step);
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email, password })
      .expect(200);
    expect(login.body).toEqual({ step: 'totp', challenge: expect.any(String) });
    // Código do mesmo passo já usado: recusado.
    await request(app.getHttpServer())
      .post('/admin/auth/totp')
      .set(H)
      .send({ challenge: login.body.challenge, code: totpCode(secret, step) })
      .expect(401);
    await request(app.getHttpServer())
      .post('/admin/auth/totp')
      .set(H)
      .send({ challenge: login.body.challenge, code: totpCode(secret, step + 1) })
      .expect(200);
  });

  it('senha errada: mensagem genérica; 5 erros bloqueiam o e-mail', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .set(H)
        .send({ email, password: 'errada-123456' })
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email, password })
      .expect(429);
    expect(locked.body.error.code).toBe('LOGIN_LOCKED');
    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email: 'ninguem@empresa.com', password })
      .expect(401);
  });

  it('sem o cabeçalho do backoffice: 403 (CSRF)', async () => {
    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password })
      .expect(403);
    const { cookie } = await signIn();
    await request(app.getHttpServer())
      .post('/admin/operators')
      .set('Cookie', cookie)
      .send({ email: 'x@empresa.com', name: 'X', role: 'SUPPORT' })
      .expect(403);
  });

  it('SUPPORT consulta mas não altera; ADMIN cria operador com senha temporária', async () => {
    const { cookie } = await signIn();
    const created = await request(app.getHttpServer())
      .post('/admin/operators')
      .set(H)
      .set('Cookie', cookie)
      .send({
        email: `bia-${randomBytes(3).toString('hex')}@empresa.com`,
        name: 'Bia',
        role: 'SUPPORT',
      })
      .expect(201);
    expect(created.body.temporaryPassword).toHaveLength(20);
    expect(created.body.operator).toMatchObject({ role: 'SUPPORT', totpConfigured: false });

    const support = await signIn(created.body.operator.email, created.body.temporaryPassword);
    await request(app.getHttpServer())
      .get('/admin/operators')
      .set('Cookie', support.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post('/admin/operators')
      .set(H)
      .set('Cookie', support.cookie)
      .send({ email: 'z@empresa.com', name: 'Z', role: 'ADMIN' })
      .expect(403);
  });

  it('desativar encerra as sessões; o último ADMIN não pode ser desativado', async () => {
    const admin = await signIn();
    const other = await operators.create({
      email: `caio-${randomBytes(3).toString('hex')}@empresa.com`,
      name: 'Caio',
      role: 'SUPPORT',
    });
    const otherSession = await signIn(other.operator.email, other.temporaryPassword);
    await request(app.getHttpServer())
      .patch(`/admin/operators/${other.operator.id}`)
      .set(H)
      .set('Cookie', admin.cookie)
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Cookie', otherSession.cookie)
      .expect(401);

    const self = (await operators.findByEmail(email))!;
    // Pode haver outros ADMIN de testes anteriores: deixa só este ativo.
    const all = await operators.list();
    for (const op of all) {
      if (op.role === 'ADMIN' && op.id !== self.id)
        await operators.update(op.id, { active: false });
    }
    const res = await request(app.getHttpServer())
      .patch(`/admin/operators/${self.id}`)
      .set(H)
      .set('Cookie', admin.cookie)
      .send({ active: false })
      .expect(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });

  it('trocar a senha derruba as sessões; a nova senha entra', async () => {
    // Passos crescentes (o servidor recusa repetir um passo) e dentro da janela de ±1 mesmo se
    // os 30 s virarem entre gerar o código e o servidor conferir.
    const { cookie, secret } = await signIn(email, password, undefined, currentStep());
    await request(app.getHttpServer())
      .post('/admin/auth/password')
      .set(H)
      .set('Cookie', cookie)
      .send({ current: password, next: 'uma-senha-bem-longa' })
      .expect(204);
    await request(app.getHttpServer()).get('/admin/auth/me').set('Cookie', cookie).expect(401);
    await signIn(email, 'uma-senha-bem-longa', secret, currentStep() + 1);
  });

  /** Login completo pedindo para lembrar o navegador; devolve o cookie do navegador lembrado. */
  async function signInRemembering(
    step = currentStep(),
  ): Promise<{ device: string; secret: string }> {
    const first = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email, password })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post('/admin/auth/totp')
      .set(H)
      .send({
        challenge: first.body.challenge,
        code: totpCode(first.body.secret, step),
        rememberDevice: true,
      })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const device = cookies.find((c) => c.startsWith('gm_admin_device='))!;
    expect(device).toContain('HttpOnly');
    return { device: device.split(';')[0]!, secret: first.body.secret };
  }

  it('navegador lembrado: o próximo login pede só a senha; senha errada continua recusada', async () => {
    const { device } = await signInRemembering();
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .set('Cookie', device)
      .send({ email, password })
      .expect(200);
    expect(login.body).toMatchObject({ step: 'authenticated', operator: { email } });
    const session = String(login.headers['set-cookie']).split(';')[0]!;
    expect(session).toMatch(/^gm_admin=/);
    await request(app.getHttpServer()).get('/admin/auth/me').set('Cookie', session).expect(200);

    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .set('Cookie', device)
      .send({ email, password: 'errada-123456' })
      .expect(401);
    // Sem o cookie (outro navegador), o código volta a ser pedido.
    const other = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email, password })
      .expect(200);
    expect(other.body.step).toBe('totp');
  });

  it('navegador lembrado não vale para outro operador nem depois de revogar as sessões', async () => {
    const { device } = await signInRemembering();
    const other = await operators.create({
      email: `duda-${randomBytes(3).toString('hex')}@empresa.com`,
      name: 'Duda',
      role: 'SUPPORT',
    });
    const asOther = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .set('Cookie', device)
      .send({ email: other.operator.email, password: other.temporaryPassword })
      .expect(200);
    expect(asOther.body.step).toBe('totp-setup');

    const self = (await operators.findByEmail(email))!;
    await auth.revokeAll(self.id);
    const again = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .set('Cookie', device)
      .send({ email, password })
      .expect(200);
    expect(again.body.step).toBe('totp');
  });

  it('logout encerra a sessão', async () => {
    const { cookie } = await signIn();
    await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .set(H)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer()).get('/admin/auth/me').set('Cookie', cookie).expect(401);
  });
});
