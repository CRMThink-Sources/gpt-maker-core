import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { SubscriptionAdminService } from '../../src/modules/backoffice/subscription-admin.service';
import type { SubscriptionConsistencyService } from '../../src/modules/payments';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import {
  PLATFORM_UNAVAILABLE,
  type PlatformApiClient,
  PlatformError,
} from '../../src/shared/platform/platform-api.client';

const { auditLog, paymentEvent, subscriptionState, tenant } = schema;

// Assinatura do portal no backoffice (spec admin-backoffice, "Visão de assinaturas"; tarefa 15.5).
describe('backoffice: assinatura do portal', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: SubscriptionAdminService;
  let tenantId: string;
  let installationId: string;
  let plansFail = false;
  let checkResult: 'ok' | 'corrected' | 'alert' | Error = 'ok';
  const checked: string[] = [];
  const actor = randomUUID();

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    const platform = {
      listPlans: async () => {
        if (plansFail) throw new Error('fora');
        return [
          { id: 9, name: 'ThinkFlow 1000' },
          { id: 11, name: 'ThinkFlow 5000' },
        ];
      },
    } as unknown as PlatformApiClient;
    const consistency = {
      check: async (row: { id: string }) => {
        checked.push(row.id);
        if (checkResult instanceof Error) throw checkResult;
        return checkResult;
      },
    } as unknown as SubscriptionConsistencyService;
    const env = {
      CRMTHINK_PORTAL_URL: 'https://crmthink.bitrix24.com.br',
      CRMTHINK_SPA_SUBSCRIPTIONS: 1142,
      CRMTHINK_SPA_INSTALLATIONS: 1060,
    } as Env;
    service = new SubscriptionAdminService(platform, consistency, new AuditService(db), env, db);
  });

  beforeEach(async () => {
    plansFail = false;
    checkResult = 'ok';
    checked.length = 0;
    const code = randomBytes(3).toString('hex');
    installationId = String(Math.floor(Math.random() * 1e9));
    const [t] = await db
      .insert(tenant)
      .values({ installationId, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    tenantId = t!.id;
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('sem assinatura: só o link da instalação, sem eventos', async () => {
    expect(await service.view(tenantId)).toEqual({
      projection: null,
      links: {
        subscription: null,
        installation: `https://crmthink.bitrix24.com.br/crm/type/1060/details/${installationId}/`,
      },
      events: [],
      platformError: false,
    });
  });

  it('projeção com nomes dos planos, link do SPA e eventos (correção marcada), mais novos primeiro', async () => {
    await db.insert(subscriptionState).values({
      tenantId,
      subscriptionId: '345',
      status: 'past_due',
      modality: 'stripe',
      planId: '11',
      nextPlanId: '9',
      periodStart: new Date('2026-10-01T00:00:00Z'),
      periodEnd: new Date('2026-11-01T00:00:00Z'),
      graceUntil: new Date('2026-10-05T12:00:00Z'),
      version: 4,
    });
    const event = (type: string, receivedAt: string, extra: object = {}) => ({
      eventId: randomUUID(),
      type,
      installationId,
      tenantId,
      status: 'PROCESSED' as const,
      receivedAt: new Date(receivedAt),
      payload: { type, occurredAt: receivedAt, data: {}, ...extra },
    });
    await db.insert(paymentEvent).values([
      event('subscription.activated', '2026-10-01T10:00:00Z'),
      event('subscription.past_due', '2026-10-04T10:00:00Z', {
        data: { correction: { source: 'consistency', reason: 'faltou' } },
      }),
    ]);

    const view = await service.view(tenantId);
    expect(view.projection).toMatchObject({
      subscriptionId: '345',
      status: 'past_due',
      plan: { id: '11', name: 'ThinkFlow 5000' },
      nextPlan: { id: '9', name: 'ThinkFlow 1000' },
      graceUntil: '2026-10-05T12:00:00.000Z',
      version: 4,
    });
    expect(view.links.subscription).toBe(
      'https://crmthink.bitrix24.com.br/crm/type/1142/details/345/',
    );
    expect(view.events.map((e) => [e.type, e.correction])).toEqual([
      ['subscription.past_due', true],
      ['subscription.activated', false],
    ]);

    plansFail = true;
    const offline = await service.view(tenantId);
    expect(offline.platformError).toBe(true);
    expect(offline.projection?.plan).toEqual({ id: '11', name: null });
  });

  it('conferir com a plataforma: roda a consistência do portal e audita', async () => {
    checkResult = 'corrected';
    expect((await service.check(tenantId, actor)).outcome).toBe('corrected');
    expect(checked).toEqual([tenantId]);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.tenantId, tenantId));
    expect(audit).toMatchObject({
      action: 'subscription.checked',
      actorId: actor,
      after: { outcome: 'corrected' },
    });
  });

  it('plataforma fora: erro recuperável', async () => {
    checkResult = new PlatformError(503, PLATFORM_UNAVAILABLE, 'fora');
    const code = await service.check(tenantId, actor).catch((e: { code: string }) => e.code);
    expect(code).toBe('PAYMENTS_UNAVAILABLE');
  });

  it('portal inexistente', async () => {
    const code = await service.view(randomUUID()).catch((e: { code: string }) => e.code);
    expect(code).toBe('TENANT_NOT_FOUND');
  });
});
