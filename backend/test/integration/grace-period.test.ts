import { randomBytes, randomUUID } from 'node:crypto';
import type { PlatformEvent } from '@crmthink-sources/platform-sdk';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentAccessPolicy } from '../../src/modules/agents/agent-access.policy';
import { CreditCycleService } from '../../src/modules/billing/credit-cycle.service';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import { GraceExpiryJob } from '../../src/modules/payments/grace-expiry.job';
import { PaymentsOutbox } from '../../src/modules/payments/payments-outbox';
import { SubscriptionEventsService } from '../../src/modules/payments/subscription-events.service';
import { TenantLifecycle } from '../../src/modules/tenancy/tenant-lifecycle';
import { TenantService, type Tenant } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const { planEntitlement, subscriptionState, tenant } = schema;
const PLAN = 11;
/** Horário de Brasília (UTC-3) ⇒ instante. */
const brt = (local: string) => new Date(`${local}-03:00`);

// Carência de pagamento (spec payments-integration: 1 dia, fim de semana empurra para segunda).
describe('carência de pagamento', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let events: SubscriptionEventsService;
  let job: GraceExpiryJob;
  let policy: AgentAccessPolicy;
  let owner: Tenant;
  let installationId: number;
  let subscriptionId: number;
  let version: number;
  const accessChanged: string[] = [];

  function event(type: string, status: string, occurredAt: Date): PlatformEvent {
    version += 1;
    return {
      eventId: randomUUID(),
      type,
      appCode: 'crmthink.gptmaker',
      installationId,
      memberId: owner.memberId,
      occurredAt: occurredAt.toISOString(),
      subscription: {
        id: subscriptionId,
        status,
        modality: 'stripe',
        planId: PLAN,
        periodStart: '2026-10-03T00:00:00.000Z',
        periodEnd: '2026-11-03T23:59:59.999Z',
        version,
      },
      data: {},
    } as unknown as PlatformEvent;
  }

  const graceUntil = async () =>
    (
      await db
        .select({ graceUntil: subscriptionState.graceUntil })
        .from(subscriptionState)
        .where(eq(subscriptionState.tenantId, owner.id))
    )[0]?.graceUntil;

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
    const ledger = new LedgerService(db, redis);
    const lifecycle = new TenantLifecycle();
    lifecycle.register({
      name: 'teste',
      onAccessChanged: async (row: Tenant) => {
        accessChanged.push(row.id);
      },
    } as never);
    const tenants = new TenantService(db);
    events = new SubscriptionEventsService(
      tenants,
      lifecycle,
      new CreditCycleService(ledger, db, redis),
      new PaymentsOutbox(db),
      db,
    );
    job = new GraceExpiryJob(tenants, lifecycle, db, redis);
    policy = new AgentAccessPolicy(db);
    await db
      .insert(planEntitlement)
      .values({ planSpaId: String(PLAN), planType: 'subscription', creditsPerCycle: 5000 });
  });

  beforeEach(async () => {
    accessChanged.length = 0;
    version = 0;
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
    await events.handle(event('subscription.activated', 'active', brt('2026-10-03T10:00:00')));
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('falha na sexta: carência até segunda no mesmo horário; nova falha não estende', async () => {
    await events.handle(event('subscription.past_due', 'past_due', brt('2026-10-09T10:00:00')));
    expect(await graceUntil()).toEqual(brt('2026-10-12T10:00:00'));

    await events.handle(event('subscription.past_due', 'past_due', brt('2026-10-10T08:00:00')));
    expect(await graceUntil()).toEqual(brt('2026-10-12T10:00:00'));
  });

  it('job: dentro da carência nada; vencida avisa uma vez e a política bloqueia', async () => {
    await events.handle(event('subscription.past_due', 'past_due', brt('2026-10-07T15:00:00')));
    accessChanged.length = 0;
    const before = brt('2026-10-08T14:59:00');
    expect(await job.expire(before)).toBe(0);
    expect(await policy.blockingReason(owner.id, 'ACTIVE', before)).toBeNull();

    const after = brt('2026-10-08T15:00:00');
    expect(await job.expire(after)).toBe(1);
    expect(accessChanged).toEqual([owner.id]);
    expect(await policy.blockingReason(owner.id, 'ACTIVE', after)).toBe('SUBSCRIPTION_EXPIRED');

    // Rodadas seguintes não repetem o aviso.
    expect(await job.expire(brt('2026-10-08T15:15:00'))).toBe(0);
    expect(accessChanged).toHaveLength(1);
  });

  it('pagamento regularizado: limpa a carência, avisa (reativa) e o job não age', async () => {
    await events.handle(event('subscription.past_due', 'past_due', brt('2026-10-07T15:00:00')));
    accessChanged.length = 0;
    await events.handle(event('subscription.recovered', 'active', brt('2026-10-07T18:00:00')));
    expect(await graceUntil()).toBeNull();
    expect(accessChanged).toEqual([owner.id]);
    expect(await job.expire(brt('2026-10-09T00:00:00'))).toBe(0);
    expect(await policy.blockingReason(owner.id, 'ACTIVE', brt('2026-10-09T00:00:00'))).toBeNull();
  });

  it('renovação paga depois da falha também limpa a carência', async () => {
    await events.handle(event('subscription.past_due', 'past_due', brt('2026-10-07T15:00:00')));
    await events.handle(event('subscription.renewed', 'active', brt('2026-10-07T16:00:00')));
    expect(await graceUntil()).toBeNull();
  });
});
