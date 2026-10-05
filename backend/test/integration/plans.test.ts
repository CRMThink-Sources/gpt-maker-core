import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlansService } from '../../src/modules/payments/plans.service';
import { TenantService } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import { DomainError } from '../../src/shared/http/api-exception.filter';
import { PlatformApiClient } from '../../src/shared/platform/platform-api.client';
import * as schema from '../../src/shared/database/schema/index';

const { creditLedger, planEntitlement, subscriptionState, tenant } = schema;

const PLATFORM_PLANS = [
  {
    id: 9,
    productId: 1,
    productName: 'ThinkFlow',
    name: 'Trial ThinkFlow',
    amount: 0,
    interval: 'monthly',
    type: 'subscription',
    trial: true,
  },
  {
    id: 11,
    productId: 1,
    productName: 'ThinkFlow',
    name: 'ThinkFlow 5000',
    amount: 49900,
    interval: 'monthly',
    type: 'subscription',
    trial: false,
  },
  {
    id: 13,
    productId: 1,
    productName: 'ThinkFlow',
    name: 'ThinkFlow 10000',
    amount: 89900,
    interval: 'monthly',
    type: 'subscription',
    trial: false,
  },
  {
    id: 12,
    productId: 1,
    productName: 'ThinkFlow',
    name: 'Sem direitos',
    amount: 9900,
    interval: 'monthly',
    type: 'subscription',
    trial: false,
  },
  {
    id: 7,
    productId: 2,
    productName: 'Créditos',
    name: '1000 Créditos',
    amount: 12900,
    interval: null,
    type: 'one_time',
    trial: false,
  },
];

interface Reply {
  status: number;
  body: unknown;
}

// Planos à venda, checkout embutido e portal (spec payments-integration, credit-billing).
describe('planos e checkout', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let plans: PlansService;
  let tenantId: string;
  let installationId: number;
  let domain: string;
  let checkoutReply: Reply;
  const sent: Array<{ path: string; body: unknown }> = [];

  async function rejection(promise: Promise<unknown>): Promise<DomainError> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }

  async function subscription(
    status: 'trialing' | 'active' | 'past_due',
    modality: 'stripe' | 'manual' = 'stripe',
  ): Promise<void> {
    await db.insert(subscriptionState).values({
      tenantId,
      subscriptionId: String(installationId),
      status,
      modality,
      planId: status === 'trialing' ? '9' : '11',
      version: 1,
    });
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
    const platform = new PlatformApiClient(
      { baseUrl: 'https://platform.test', apiKey: 'k', timeoutMs: 1000, maxAttempts: 1 },
      async (input, init) => {
        const path = new URL(String(input)).pathname;
        sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const reply: Reply =
          path === '/v1/plans' ? { status: 200, body: { items: PLATFORM_PLANS } } : checkoutReply;
        return new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    plans = new PlansService(platform, new TenantService(db), db, redis);
    await db.insert(planEntitlement).values([
      { planSpaId: '9', planType: 'subscription', creditsPerCycle: 0 },
      { planSpaId: '11', planType: 'subscription', creditsPerCycle: 5000 },
      { planSpaId: '13', planType: 'subscription', creditsPerCycle: 10000 },
      { planSpaId: '7', planType: 'one_time', creditsPerPackage: 1000 },
    ]);
  });

  beforeEach(async () => {
    sent.length = 0;
    await redis.flushall();
    installationId = Math.floor(Math.random() * 1_000_000);
    const code = randomBytes(4).toString('hex');
    domain = `${code}.bitrix24.com.br`;
    const [row] = await db
      .insert(tenant)
      .values({ installationId: String(installationId), memberId: code, domain, tenantCode: code })
      .returning();
    tenantId = row!.id;
    checkoutReply = { status: 201, body: { clientSecret: 'cs_secret', sessionId: 'cs_1' } };
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('só vende planos com direitos; sem o trial, com os créditos do app', async () => {
    expect(await plans.offers()).toEqual({
      subscriptions: [
        { id: 11, name: 'ThinkFlow 5000', amount: 49900, interval: 'monthly', credits: 5000 },
        { id: 13, name: 'ThinkFlow 10000', amount: 89900, interval: 'monthly', credits: 10000 },
      ],
      packages: [{ id: 7, name: '1000 Créditos', amount: 12900, interval: null, credits: 1000 }],
    });
    // Segunda leitura vem do cache.
    await plans.offers();
    expect(sent.filter((s) => s.path === '/v1/plans')).toHaveLength(1);
  });

  it('assinatura durante o trial: checkout subscribe', async () => {
    await subscription('trialing');
    expect(await plans.checkout(tenantId, installationId, 11)).toEqual({
      clientSecret: 'cs_secret',
      intent: 'subscribe',
      purchaseId: null,
    });
    expect(sent.at(-1)).toEqual({
      path: '/v1/checkout-sessions',
      body: { installationId, planId: 11, intent: 'subscribe' },
    });
  });

  it('assinatura com plano pago vigente: 409 sem chamar a plataforma', async () => {
    await subscription('past_due');
    const error = await rejection(plans.checkout(tenantId, installationId, 11));
    expect(error.code).toBe('SUBSCRIPTION_ALREADY_EXISTS');
    expect(sent.some((s) => s.path === '/v1/checkout-sessions')).toBe(false);
  });

  it('pacote durante o trial: recusado (exige plano ativo)', async () => {
    await subscription('trialing');
    const error = await rejection(plans.checkout(tenantId, installationId, 7));
    expect(error.code).toBe('PACKAGE_REQUIRES_PLAN');
    expect(sent.some((s) => s.path === '/v1/checkout-sessions')).toBe(false);
  });

  it('pacote com plano ativo: checkout purchase e acompanhamento pelo crédito', async () => {
    await subscription('active');
    checkoutReply = {
      status: 201,
      body: { clientSecret: 'cs_secret', sessionId: 'cs_2', purchaseId: 321 },
    };
    expect(await plans.checkout(tenantId, installationId, 7)).toEqual({
      clientSecret: 'cs_secret',
      intent: 'purchase',
      purchaseId: 321,
    });
    expect(await plans.purchaseStatus(tenantId, 321)).toEqual({ credited: false });

    await db.insert(creditLedger).values({
      tenantId,
      wallet: 'EXTRA',
      type: 'TOPUP',
      amount: 1000,
      refType: 'purchase',
      refId: '321',
      idempotencyKey: `purchase:321:${randomUUID()}`,
      createdBy: 'teste',
    });
    expect(await plans.purchaseStatus(tenantId, 321)).toEqual({ credited: true });
  });

  it('plano fora da oferta: 404', async () => {
    expect((await rejection(plans.checkout(tenantId, installationId, 12))).code).toBe(
      'PLAN_NOT_AVAILABLE',
    );
    expect((await rejection(plans.checkout(tenantId, installationId, 9))).code).toBe(
      'PLAN_NOT_AVAILABLE',
    );
  });

  it('plano sem preço Stripe no ambiente: indisponível', async () => {
    checkoutReply = {
      status: 422,
      body: { error: { code: 'PLAN_NOT_PURCHASABLE', message: 'sem preço' } },
    };
    const error = await rejection(plans.checkout(tenantId, installationId, 11));
    expect(error.code).toBe('PLAN_NOT_AVAILABLE');
  });

  it('Stripe fora: pagamentos indisponíveis', async () => {
    checkoutReply = {
      status: 503,
      body: { error: { code: 'PAYMENTS_UNAVAILABLE', message: 'x' } },
    };
    const error = await rejection(plans.checkout(tenantId, installationId, 11));
    expect(error.code).toBe('PAYMENTS_UNAVAILABLE');
    expect(error.getStatus()).toBe(503);
  });

  it('portal de pagamento: volta para o portal Bitrix24 do cliente', async () => {
    checkoutReply = { status: 201, body: { url: 'https://billing.stripe.com/p/session' } };
    expect(await plans.billingPortal(tenantId, installationId)).toEqual({
      url: 'https://billing.stripe.com/p/session',
    });
    expect(sent.at(-1)).toEqual({
      path: '/v1/billing-portal-sessions',
      body: { installationId, returnUrl: `https://${domain}/` },
    });
  });

  it('portal sem cobrança Stripe (trial ou manual): 409', async () => {
    checkoutReply = {
      status: 409,
      body: { error: { code: 'NO_GATEWAY_SUBSCRIPTION', message: 'x' } },
    };
    const error = await rejection(plans.billingPortal(tenantId, installationId));
    expect(error.code).toBe('NO_GATEWAY_SUBSCRIPTION');
  });

  describe('troca de plano', () => {
    it('upgrade imediato: chama a plataforma com a assinatura e o plano novo', async () => {
      await subscription('active');
      checkoutReply = {
        status: 200,
        body: {
          subscriptionId: installationId,
          planId: 13,
          effective: 'immediate',
          remainingFraction: 0.5,
        },
      };
      expect(await plans.changePlan(tenantId, 13)).toEqual({
        effective: 'immediate',
        effectiveAt: null,
      });
      expect(sent.at(-1)).toEqual({
        path: `/v1/subscriptions/${installationId}/change-plan`,
        body: { planId: 13 },
      });
    });

    it('downgrade: vale na renovação', async () => {
      await subscription('active');
      await db
        .update(subscriptionState)
        .set({ planId: '13' })
        .where(eq(subscriptionState.tenantId, tenantId));
      checkoutReply = {
        status: 200,
        body: {
          subscriptionId: installationId,
          planId: 11,
          effective: 'next_period',
          effectiveAt: '2026-11-03T23:59:59.999Z',
        },
      };
      expect(await plans.changePlan(tenantId, 11)).toEqual({
        effective: 'next_period',
        effectiveAt: '2026-11-03T23:59:59.999Z',
      });
    });

    it('assinatura manual: fala com o comercial, sem chamar a plataforma', async () => {
      await subscription('active', 'manual');
      expect((await rejection(plans.changePlan(tenantId, 13))).code).toBe('MANUAL_SUBSCRIPTION');
      expect(sent.some((x) => x.path.includes('change-plan'))).toBe(false);
    });

    it('trial ou sem assinatura: contratar primeiro', async () => {
      expect((await rejection(plans.changePlan(tenantId, 13))).code).toBe(
        'NO_GATEWAY_SUBSCRIPTION',
      );
      await subscription('trialing');
      expect((await rejection(plans.changePlan(tenantId, 13))).code).toBe(
        'NO_GATEWAY_SUBSCRIPTION',
      );
    });

    it('mesmo plano ou plano fora da oferta', async () => {
      await subscription('active');
      expect((await rejection(plans.changePlan(tenantId, 11))).code).toBe('SAME_PLAN');
      expect((await rejection(plans.changePlan(tenantId, 12))).code).toBe('PLAN_NOT_AVAILABLE');
    });

    it('recusa da plataforma traduzida', async () => {
      await subscription('active');
      checkoutReply = {
        status: 422,
        body: { error: { code: 'MANUAL_SUBSCRIPTION', message: 'x' } },
      };
      expect((await rejection(plans.changePlan(tenantId, 13))).code).toBe('MANUAL_SUBSCRIPTION');
    });
  });
});
