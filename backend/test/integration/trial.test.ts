import { randomBytes, randomUUID } from 'node:crypto';
import type { PlatformEvent } from '@crmthink-sources/platform-sdk';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreditCycleService, TRIAL_CREDITS } from '../../src/modules/billing/credit-cycle.service';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import { PaymentsOutbox } from '../../src/modules/payments/payments-outbox';
import { SubscriptionEventsService } from '../../src/modules/payments/subscription-events.service';
import { TrialService } from '../../src/modules/payments/trial.service';
import { TenantLifecycle } from '../../src/modules/tenancy/tenant-lifecycle';
import { TenantService, type Tenant } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import { DomainError } from '../../src/shared/http/api-exception.filter';
import { PlatformApiClient } from '../../src/shared/platform/platform-api.client';
import * as schema from '../../src/shared/database/schema/index';

const { subscriptionState, tenant } = schema;

const CONTACT = {
  name: 'Ana Souza',
  email: 'ana@cliente.com',
  phone: '+55 11 99999-0000',
  company: 'Cliente Ltda',
  role: 'Diretora comercial',
};
const TRIAL_ENDS_AT = '2026-10-17T12:00:00.000Z';

interface PlatformReply {
  status: number;
  body: unknown;
}

// Trial liberado por cadastro (spec payments-integration): oferta, solicitação à plataforma e
// créditos só pelo `subscription.trial_started`.
describe('trial por cadastro', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let trials: TrialService;
  let events: SubscriptionEventsService;
  let owner: Tenant;
  let installationId: number;
  let subscriptionId: number;
  let reply: PlatformReply;
  const sent: Array<{ url: string; method: string; body: unknown }> = [];

  const ok = (status: number): PlatformReply => ({
    status,
    body: { subscriptionId, trialEndsAt: TRIAL_ENDS_AT },
  });
  const fail = (status: number, code: string, details?: unknown): PlatformReply => ({
    status,
    body: { error: { code, message: code, details } },
  });

  async function rejection(promise: Promise<unknown>): Promise<DomainError> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }

  function trialStarted(): PlatformEvent {
    return {
      eventId: randomUUID(),
      type: 'subscription.trial_started',
      appCode: 'crmthink.gptmaker',
      installationId,
      memberId: owner.memberId,
      occurredAt: new Date().toISOString(),
      subscription: {
        id: subscriptionId,
        status: 'trialing',
        modality: 'stripe',
        planId: 9,
        periodStart: '2026-10-03T12:00:00.000Z',
        periodEnd: TRIAL_ENDS_AT,
        version: 1,
      },
      data: { trialEndsAt: TRIAL_ENDS_AT, trialDays: 14 },
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
    const platform = new PlatformApiClient(
      { baseUrl: 'https://platform.test', apiKey: 'k', timeoutMs: 1000, maxAttempts: 1 },
      async (input, init) => {
        sent.push({
          url: String(input),
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    trials = new TrialService(platform, ledger, db, redis);
    events = new SubscriptionEventsService(
      new TenantService(db),
      new TenantLifecycle(),
      new CreditCycleService(ledger, db, redis),
      new PaymentsOutbox(db),
      { notify: async () => true } as never,
      db,
    );
  });

  beforeEach(async () => {
    sent.length = 0;
    installationId = Math.floor(Math.random() * 1_000_000);
    subscriptionId = Math.floor(Math.random() * 1_000_000);
    reply = ok(201);
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

  it('oferece o trial ao tenant que nunca teve assinatura', async () => {
    expect(await trials.status(owner.id)).toEqual({ state: 'available', trialEndsAt: null });
  });

  it('não oferece a quem já teve assinatura', async () => {
    await db.insert(subscriptionState).values({
      tenantId: owner.id,
      subscriptionId: '5',
      status: 'trial_expired',
      modality: 'stripe',
      version: 3,
    });
    expect((await trials.status(owner.id)).state).toBe('unavailable');
  });

  it('cadastro aceito: repassa o contato, fica em ativação e os créditos chegam com o evento', async () => {
    expect(await trials.request(owner.id, installationId, CONTACT)).toEqual({
      state: 'activating',
      trialEndsAt: TRIAL_ENDS_AT,
    });
    expect(sent).toEqual([
      {
        url: `https://platform.test/v1/installations/${installationId}/trial`,
        method: 'POST',
        body: CONTACT,
      },
    ]);
    // Sem evento, nada de crédito.
    expect((await ledger.balance(owner.id)).trial).toBe(0);

    await events.handle(trialStarted());
    expect(await trials.status(owner.id)).toEqual({
      state: 'trialing',
      trialEndsAt: TRIAL_ENDS_AT,
    });
    expect((await ledger.balance(owner.id)).trial).toBe(TRIAL_CREDITS);
  });

  it('envio repetido: o 200 com o trial vigente também fica em ativação, sem crédito extra', async () => {
    await trials.request(owner.id, installationId, CONTACT);
    reply = ok(200);
    expect((await trials.request(owner.id, installationId, CONTACT)).state).toBe('activating');
    await events.handle(trialStarted());
    expect((await ledger.balance(owner.id)).trial).toBe(TRIAL_CREDITS);
  });

  it('trial já usado: 409 e a oferta continua sem crédito', async () => {
    reply = fail(409, 'TRIAL_ALREADY_USED');
    const error = await rejection(trials.request(owner.id, installationId, CONTACT));
    expect(error.code).toBe('TRIAL_ALREADY_USED');
    expect(error.getStatus()).toBe(409);
    expect((await ledger.balance(owner.id)).trial).toBe(0);
  });

  it('cadastro recusado: 400 com os campos apontados pela plataforma', async () => {
    const details = [{ path: 'phone', message: 'obrigatório' }];
    reply = fail(400, 'VALIDATION_ERROR', details);
    const error = await rejection(trials.request(owner.id, installationId, CONTACT));
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.getStatus()).toBe(400);
    expect(error.details).toEqual(details);
    expect((await trials.status(owner.id)).state).toBe('available');
  });

  it('assinatura que a projeção não conhece: 409', async () => {
    reply = fail(409, 'SUBSCRIPTION_ALREADY_EXISTS');
    const error = await rejection(trials.request(owner.id, installationId, CONTACT));
    expect(error.code).toBe('SUBSCRIPTION_ALREADY_EXISTS');
  });

  it('plataforma fora: erro recuperável e nada muda', async () => {
    reply = { status: 503, body: {} };
    const error = await rejection(trials.request(owner.id, installationId, CONTACT));
    expect(error.code).toBe('PLATFORM_UNAVAILABLE');
    expect(error.getStatus()).toBe(503);
    expect((await trials.status(owner.id)).state).toBe('available');
  });

  it('trial não configurado na plataforma: indisponível', async () => {
    reply = fail(422, 'TRIAL_NOT_CONFIGURED');
    const error = await rejection(trials.request(owner.id, installationId, CONTACT));
    expect(error.code).toBe('TRIAL_UNAVAILABLE');
  });
});
