import { randomBytes, randomUUID } from 'node:crypto';
import type { PlatformEvent } from '@crmthink-sources/platform-sdk';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreditCycleService, TRIAL_CREDITS } from '../../src/modules/billing/credit-cycle.service';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import { PaymentsOutbox } from '../../src/modules/payments/payments-outbox';
import { PlatformEventStore } from '../../src/modules/payments/platform-event.store';
import { SubscriptionConsistencyService } from '../../src/modules/payments/subscription-consistency.service';
import { SubscriptionEventsService } from '../../src/modules/payments/subscription-events.service';
import { TenantLifecycle } from '../../src/modules/tenancy/tenant-lifecycle';
import { TenantService, type Tenant } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import { PlatformApiClient } from '../../src/shared/platform/platform-api.client';
import * as schema from '../../src/shared/database/schema/index';

const { paymentEvent, planEntitlement, subscriptionState, tenant } = schema;
const PLAN = 11;
const TRIAL_PLAN = 9;

// Job de consistência (spec payments-integration, "Consistência da projeção local").
describe('consistência da projeção da assinatura', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let events: SubscriptionEventsService;
  let consistency: SubscriptionConsistencyService;
  let owner: Tenant;
  let installationId: number;
  let subscriptionId: number;
  /** Resposta de `GET /v1/installations/{id}/subscription`; `null` = `NO_SUBSCRIPTION`. */
  let remote: Record<string, unknown> | null;

  const balance = () => ledger.balance(owner.id);
  const projection = async () =>
    (await db.select().from(subscriptionState).where(eq(subscriptionState.tenantId, owner.id)))[0];
  const corrections = () =>
    db.select().from(paymentEvent).where(eq(paymentEvent.tenantId, owner.id));

  function current(values: Record<string, unknown>): Record<string, unknown> {
    return {
      subscriptionId,
      status: 'active',
      modality: 'stripe',
      plan: {
        id: PLAN,
        name: 'ThinkFlow 5000',
        interval: 'monthly',
        type: 'subscription',
        amount: 10000,
      },
      periodStart: '2026-10-03T00:00:00.000Z',
      periodEnd: '2026-11-03T23:59:59.999Z',
      cancelAtPeriodEnd: false,
      trial: { used: true, endsAt: null },
      version: 2,
      ...values,
    };
  }

  /** Evento real da plataforma (para conferir que chegar depois da correção não duplica). */
  function realEvent(type: string, data: Record<string, unknown>, version: number): PlatformEvent {
    return {
      eventId: randomUUID(),
      type,
      appCode: 'crmthink.gptmaker',
      installationId,
      memberId: owner.memberId,
      occurredAt: new Date().toISOString(),
      subscription: {
        id: subscriptionId,
        status: 'active',
        modality: 'stripe',
        planId: PLAN,
        periodStart: '2026-10-03T00:00:00.000Z',
        periodEnd: '2026-11-03T23:59:59.999Z',
        version,
      },
      data,
    } as unknown as PlatformEvent;
  }

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    ledger = new LedgerService(db, redis);
    events = new SubscriptionEventsService(
      new TenantService(db),
      new TenantLifecycle(),
      new CreditCycleService(ledger, db, redis),
      new PaymentsOutbox(db),
      { notify: async () => true } as never,
      db,
    );
    const platform = new PlatformApiClient(
      { baseUrl: 'https://platform.test', apiKey: 'k', timeoutMs: 1000, maxAttempts: 1 },
      async () =>
        remote
          ? new Response(JSON.stringify(remote), { status: 200 })
          : new Response(
              JSON.stringify({ error: { code: 'NO_SUBSCRIPTION', message: 'sem assinatura' } }),
              { status: 404 },
            ),
    );
    consistency = new SubscriptionConsistencyService(
      platform,
      new PlatformEventStore(db),
      events,
      db,
      redis,
    );
    await db.insert(planEntitlement).values([
      { planSpaId: String(PLAN), planType: 'subscription', creditsPerCycle: 5000 },
      { planSpaId: String(TRIAL_PLAN), planType: 'subscription', creditsPerCycle: 0 },
    ]);
  });

  beforeEach(async () => {
    installationId = Math.floor(Math.random() * 1_000_000);
    subscriptionId = Math.floor(Math.random() * 1_000_000);
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: String(installationId),
        memberId: code,
        domain: `${code}.b24.com`,
        tenantCode: code,
      })
      .returning();
    owner = row!;
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('trial perdido: aplica o trial_started, registra a correção e não repete', async () => {
    remote = current({
      status: 'trialing',
      plan: { id: TRIAL_PLAN },
      periodEnd: '2026-10-17T23:59:59.999Z',
      trial: { used: true, endsAt: '2026-10-17T23:59:59.999Z' },
      version: 1,
    });
    expect(await consistency.check(owner)).toBe('corrected');
    expect(await balance()).toMatchObject({
      trial: TRIAL_CREDITS,
      trialEndsAt: new Date('2026-10-17T23:59:59.999Z'),
    });
    expect(await projection()).toMatchObject({ status: 'trialing', version: 1 });
    const [record] = await corrections();
    expect(record).toMatchObject({ type: 'subscription.trial_started', status: 'PROCESSED' });
    expect((record!.payload as { data: { correction: unknown } }).data.correction).toMatchObject({
      source: 'consistency',
    });

    expect(await consistency.check(owner)).toBe('ok');
    expect((await balance()).trial).toBe(TRIAL_CREDITS);
  });

  it('ativação perdida e evento real chegando depois: créditos do ciclo uma vez só', async () => {
    remote = current({});
    expect(await consistency.check(owner)).toBe('corrected');
    expect(await balance()).toMatchObject({ plan: 5000 });
    expect(await projection()).toMatchObject({
      subscriptionId: String(subscriptionId),
      status: 'active',
      version: 2,
    });

    await events.handle(realEvent('subscription.activated', {}, 2));
    expect((await balance()).plan).toBe(5000);
  });

  it('renovação perdida: novo ciclo com os créditos do plano', async () => {
    remote = current({});
    await consistency.check(owner);
    await ledger.debit({
      tenantId: owner.id,
      key: `msg:${owner.id}:1`,
      amount: 300,
      modelCode: 'M',
      unitCost: 300,
      createdBy: 't',
    });

    remote = current({
      periodStart: '2026-11-03T00:00:00.000Z',
      periodEnd: '2026-12-03T23:59:59.999Z',
      version: 4,
    });
    expect(await consistency.check(owner)).toBe('corrected');
    expect(await balance()).toMatchObject({
      plan: 5000,
      expiresAt: new Date('2026-12-03T23:59:59.999Z'),
    });
    expect(await projection()).toMatchObject({ version: 4 });
  });

  it('plataforma sem assinatura depois do fim do período: encerra e expira', async () => {
    remote = current({});
    await consistency.check(owner);
    remote = null;
    expect(await consistency.check(owner, new Date('2026-11-06T00:00:00Z'))).toBe('corrected');
    expect(await projection()).toMatchObject({ status: 'cancelled' });
    expect(await balance()).toMatchObject({ plan: 0, total: 0 });
  });

  it('plataforma sem assinatura antes do fim do período: só alerta', async () => {
    remote = current({});
    await consistency.check(owner);
    remote = null;
    expect(await consistency.check(owner, new Date('2026-10-20T00:00:00Z'))).toBe('alert');
    expect(await projection()).toMatchObject({ status: 'active' });
    expect((await balance()).plan).toBe(5000);
  });

  it('checkAll percorre os tenants instalados', async () => {
    remote = null;
    const report = await consistency.checkAll();
    expect(report.checked).toBeGreaterThan(0);
  });

  it('cancelamento agendado e retomada (sem evento) sincronizados com a plataforma', async () => {
    remote = current({});
    await consistency.check(owner);
    remote = current({ cancelAtPeriodEnd: true });
    expect(await consistency.check(owner)).toBe('corrected');
    expect(await projection()).toMatchObject({
      cancelAt: new Date('2026-11-03T23:59:59.999Z'),
    });
    expect(await consistency.check(owner)).toBe('ok');

    remote = current({ cancelAtPeriodEnd: false });
    expect(await consistency.check(owner)).toBe('corrected');
    expect(await projection()).toMatchObject({ cancelAt: null });
  });
});
