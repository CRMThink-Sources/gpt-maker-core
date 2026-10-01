import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../../src/api.module';
import { loadEnv } from '../../src/config/env';
import { InstallationEventsConsumer } from '../../src/modules/payments/installation-events.consumer';
import { contextMiddleware } from '../../src/shared/context/context.middleware';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { DB, type Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import { agent, aiModel, paymentEvent, tenant } from '../../src/shared/database/schema/index';
import { initMetrics } from '../../src/shared/metrics/metrics';
import { WireMock } from '../support/wiremock';

// Fluxo da seção 6 contra a API real (Postgres, Redis, RabbitMQ) com o WireMock fazendo o papel
// do crmthink-platform (tokens, instalação, JWKS), do portal Bitrix e do GPTMaker.
const SECRET = 'webhook-secret';
const INSTALLATION = 1001;
const MEMBER = 'member-acme';

function sign(body: string, secret = SECRET): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

describe('instalação, eventos e sessão via crmthink-platform', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let rabbit: StartedRabbitMQContainer;
  let wiremock: WireMock;
  let app: INestApplication;
  let db: Database;
  let privateKey: CryptoKey;

  const http = () => request(app.getHttpServer());

  function signed(path: string, payload: unknown, secret = SECRET) {
    const body = JSON.stringify(payload);
    return http()
      .post(path)
      .set('Content-Type', 'application/json')
      .set('X-Platform-Signature', sign(body, secret))
      .send(body);
  }

  const installer = (isReinstall: boolean) =>
    signed('/platform/installer', {
      installationId: INSTALLATION,
      memberId: MEMBER,
      domain: 'acme.bitrix24.com.br',
      appCode: 'crmthink.gptmaker',
      isReinstall,
    });

  const platformEvent = (type: string, data: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    type,
    appCode: 'crmthink.gptmaker',
    installationId: INSTALLATION,
    memberId: MEMBER,
    occurredAt: new Date().toISOString(),
    subscription: null,
    data,
  });

  async function deliver(event: ReturnType<typeof platformEvent>) {
    await signed('/platform/events', event).expect(200, { received: true, duplicate: false });
    // O worker consome da fila; aqui o processamento é chamado direto.
    await app.get(InstallationEventsConsumer).processEvent(event.eventId);
  }

  const currentTenant = async () =>
    (
      await db
        .select()
        .from(tenant)
        .where(eq(tenant.installationId, String(INSTALLATION)))
    )[0];

  async function jwt(claims: { sub: string; isAdmin: boolean; aud?: string }) {
    return new SignJWT({
      installationId: INSTALLATION,
      memberId: MEMBER,
      domain: 'acme.bitrix24.com.br',
      isAdmin: claims.isAdmin,
      name: `Usuário ${claims.sub}`,
      departmentIds: [],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(claims.sub)
      .setAudience(claims.aud ?? 'crmthink.gptmaker')
      .setIssuer(wiremock.baseUrl)
      .setExpirationTime('15m')
      .sign(privateKey);
  }

  beforeAll(async () => {
    [postgres, redis, rabbit, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new RabbitMQContainer('rabbitmq:4-alpine').start(),
      WireMock.start(),
    ]);
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const stubs = [
      {
        request: { method: 'GET', urlPath: '/.well-known/jwks.json' },
        response: { status: 200, jsonBody: { keys: [jwk] } },
      },
      {
        request: {
          method: 'GET',
          urlPath: `/v1/installations/${INSTALLATION}/token`,
          headers: { Authorization: { equalTo: 'Bearer api-key' } },
        },
        response: {
          status: 200,
          jsonBody: {
            accessToken: 'portal-token',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            domain: 'acme.bitrix24.com.br',
            clientEndpoint: `${wiremock.baseUrl}/rest/`,
          },
        },
      },
      {
        request: {
          method: 'POST',
          urlPath: '/rest/app.info.json',
          bodyPatterns: [{ matchesJsonPath: "$[?(@.auth == 'portal-token')]" }],
        },
        response: { status: 200, jsonBody: { result: { ID: 1, CODE: 'crmthink.gptmaker' } } },
      },
      {
        request: { method: 'GET', urlPath: '/v2/workspaces' },
        response: { status: 200, jsonBody: [{ id: 'ws-1', name: 'P' }] },
      },
      {
        request: { method: 'GET', urlPath: '/v2/workspace/ws-1/credits' },
        response: { status: 200, jsonBody: { credits: 1, status: 'ACTIVE' } },
      },
      {
        request: { method: 'PUT', urlPathPattern: '/v2/agent/[^/]+/(in)?active' },
        response: { status: 200, jsonBody: { success: true } },
      },
    ];
    for (const stub of stubs) await wiremock.stub(stub);

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
      PLATFORM_URL: wiremock.baseUrl,
      PLATFORM_API_KEY: 'api-key',
      PLATFORM_WEBHOOK_SECRETS: `novo,${SECRET}`,
      STORAGE_ENDPOINT: 'http://127.0.0.1:1',
      STORAGE_ACCESS_KEY: 'test',
      STORAGE_SECRET_KEY: 'test',
    });
    initMetrics(env.APP_ROLE);
    configureFieldCipher(env.DATA_ENCRYPTION_KEY);
    await runMigrations(env.DATABASE_URL);
    const moduleRef = await Test.createTestingModule({
      imports: [ApiModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(contextMiddleware);
    await app.init();
    db = app.get(DB);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop(), rabbit?.stop(), wiremock?.stop()]);
  });

  it('instalador recusa assinatura inválida sem criar tenant', async () => {
    await signed(
      '/platform/installer',
      {
        installationId: INSTALLATION,
        memberId: MEMBER,
        domain: 'x',
        appCode: 'crmthink.gptmaker',
        isReinstall: false,
      },
      'segredo-errado',
    ).expect(401);
    await http().post('/platform/installer').send({}).expect(401);
    expect(await currentTenant()).toBeUndefined();
  });

  let tenantCode: string;

  it('primeira instalação cria o tenant ACTIVE com tenantCode e confere o acesso ao portal', async () => {
    const res = await installer(false).expect(200);
    tenantCode = res.body.tenantCode;
    expect(tenantCode).toMatch(/^[a-z2-9]{6}$/);
    expect(await currentTenant()).toMatchObject({ status: 'ACTIVE', memberId: MEMBER, tenantCode });
    expect(await wiremock.count('POST', '/rest/app.info.json')).toBe(1);
  });

  it('nova chamada do instalador é idempotente e mantém o tenantCode', async () => {
    const res = await installer(true).expect(200);
    expect(res.body.tenantCode).toBe(tenantCode);
    expect(await db.select().from(tenant)).toHaveLength(1);
  });

  it('sessão: JWT da plataforma identifica tenant e usuário; outra audiência ⇒ 401', async () => {
    const res = await http()
      .get('/app/session')
      .set('Authorization', `Bearer ${await jwt({ sub: '1', isAdmin: true })}`)
      .expect(200);
    expect(res.body).toEqual({
      user: { id: '1', name: 'Usuário 1', isAdmin: true },
      tenant: { code: tenantCode, status: 'ACTIVE' },
      canManage: true,
    });
    await http()
      .get('/app/session')
      .set(
        'Authorization',
        `Bearer ${await jwt({ sub: '1', isAdmin: true, aud: 'crmthink.outro' })}`,
      )
      .expect(401);
    await http().get('/app/session').expect(401);
  });

  it('permissões: só admin concede; usuário autorizado passa a poder gerenciar', async () => {
    const admin = `Bearer ${await jwt({ sub: '1', isAdmin: true })}`;
    const user = `Bearer ${await jwt({ sub: '8', isAdmin: false })}`;
    await http()
      .post('/app/permissions')
      .set('Authorization', user)
      .send({ bitrixUserIds: ['8'] })
      .expect(403);

    const before = await http().get('/app/session').set('Authorization', user).expect(200);
    expect(before.body.canManage).toBe(false);

    await http()
      .post('/app/permissions')
      .set('Authorization', admin)
      .send({ bitrixUserIds: ['8', '8'] })
      .expect(204);
    const list = await http().get('/app/permissions').set('Authorization', admin).expect(200);
    expect(list.body.users).toEqual([
      expect.objectContaining({ bitrixUserId: '8', grantedBy: '1' }),
    ]);
    expect((await http().get('/app/session').set('Authorization', user)).body.canManage).toBe(true);

    await http().delete('/app/permissions/8').set('Authorization', admin).expect(204);
    expect((await http().get('/app/session').set('Authorization', user)).body.canManage).toBe(
      false,
    );
  });

  it('eventos: assinatura obrigatória e dedupe por eventId', async () => {
    const event = platformEvent('installation.created');
    await http().post('/platform/events').send(event).expect(401);
    await signed('/platform/events', event).expect(200, { received: true, duplicate: false });
    await signed('/platform/events', event).expect(200, { received: true, duplicate: true });
    const [row] = await db
      .select()
      .from(paymentEvent)
      .where(eq(paymentEvent.eventId, event.eventId));
    expect(row).toMatchObject({
      type: 'installation.created',
      tenantId: (await currentTenant())!.id,
    });
  });

  it('auth_error pausa (AUTH_ERROR) e auth_restored retoma', async () => {
    await deliver(
      platformEvent('installation.auth_error', { lastError: 'invalid_grant', failures: 3 }),
    );
    expect((await currentTenant())!.status).toBe('AUTH_ERROR');
    const session = await http()
      .get('/app/session')
      .set('Authorization', `Bearer ${await jwt({ sub: '1', isAdmin: true })}`);
    expect(session.body.tenant.status).toBe('AUTH_ERROR');

    await deliver(platformEvent('installation.auth_restored'));
    expect((await currentTenant())!.status).toBe('ACTIVE');
  });

  it('desinstalação inativa os agentes no GPTMaker; reinstalação reativa só esses', async () => {
    const current = (await currentTenant())!;
    const [model] = await db.select().from(aiModel).limit(1);
    const base = {
      tenantId: current.id,
      name: 'Bot',
      type: 'SUPPORT' as const,
      communicationType: 'NORMAL' as const,
      modelId: model!.id,
    };
    const [active, manual] = await db
      .insert(agent)
      .values([
        { ...base, gptmakerAgentId: 'gm-active', webhookTokenHash: randomUUID() },
        {
          ...base,
          gptmakerAgentId: 'gm-manual',
          webhookTokenHash: randomUUID(),
          status: 'INACTIVE',
          inactiveReason: 'MANUAL',
        },
      ])
      .returning();

    const removed = platformEvent('installation.removed');
    await deliver(removed);
    expect((await currentTenant())!.status).toBe('UNINSTALLED');
    expect(await wiremock.count('PUT', '/v2/agent/gm-active/inactive')).toBe(1);
    const [afterRemoval] = await db.select().from(agent).where(eq(agent.id, active!.id));
    expect(afterRemoval).toMatchObject({ status: 'INACTIVE', inactiveReason: 'UNINSTALLED' });
    const [event] = await db
      .select()
      .from(paymentEvent)
      .where(eq(paymentEvent.eventId, removed.eventId));
    expect(event!.status).toBe('PROCESSED');

    // Reprocessar o mesmo evento não repete o efeito.
    await app.get(InstallationEventsConsumer).processEvent(removed.eventId);
    expect(await wiremock.count('PUT', '/v2/agent/gm-active/inactive')).toBe(1);

    await http()
      .get('/app/session')
      .set('Authorization', `Bearer ${await jwt({ sub: '1', isAdmin: true })}`)
      .expect(403);

    const res = await installer(true).expect(200);
    expect(res.body.tenantCode).toBe(tenantCode);
    expect((await currentTenant())!.status).toBe('ACTIVE');
    expect(await wiremock.count('PUT', '/v2/agent/gm-active/active')).toBe(1);
    expect(await wiremock.count('PUT', '/v2/agent/gm-manual/active')).toBe(0);
    const [reactivated] = await db.select().from(agent).where(eq(agent.id, active!.id));
    expect(reactivated).toMatchObject({ status: 'ACTIVE', inactiveReason: null });
    const [stillManual] = await db.select().from(agent).where(eq(agent.id, manual!.id));
    expect(stillManual!.inactiveReason).toBe('MANUAL');
  });

  it('evento de outro app é recusado', async () => {
    await signed('/platform/events', {
      ...platformEvent('installation.created'),
      appCode: 'crmthink.outro',
    }).expect(400);
  });
});
