import { randomBytes, randomUUID } from 'node:crypto';
import type { PlatformEvent } from '@crmthink-sources/platform-sdk';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreditCycleService, TRIAL_CREDITS } from '../../src/modules/billing/credit-cycle.service';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import { PaymentsOutbox } from '../../src/modules/payments/payments-outbox';
import { SubscriptionEventsService } from '../../src/modules/payments/subscription-events.service';
import { TenantLifecycle } from '../../src/modules/tenancy/tenant-lifecycle';
import { TenantService, type Tenant } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const {
  agent,
  aiModel,
  creditDeduction,
  paymentsOutbox,
  planEntitlement,
  subscriptionState,
  tenant,
} = schema;
const PLAN = 1134;
const PACKAGE = 1200;
const DAY = 86_400_000;

// Eventos de assinatura e compra ⇒ projeção e créditos (specs payments-integration e credit-billing).
describe('ciclo de vida da assinatura', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let cycles: CreditCycleService;
  let service: SubscriptionEventsService;
  let owner: Tenant;
  let installationId: number;
  let subscriptionId: number;
  let version: number;
  const accessChanged: string[] = [];

  /** Evento no formato do contrato da plataforma; `version` cresce a cada chamada. */
  function event(
    type: string,
    sub: Partial<{
      status: string;
      planId: number;
      periodStart: string;
      periodEnd: string;
      version: number;
      id: number;
    }>,
    data: Record<string, unknown> = {},
  ): PlatformEvent {
    version += 1;
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
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
        version,
        ...sub,
      },
      data,
    } as unknown as PlatformEvent;
  }
  const balance = () => ledger.balance(owner.id);
  const projection = async () =>
    (await db.select().from(subscriptionState).where(eq(subscriptionState.tenantId, owner.id)))[0];

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    const redis = new Redis(redisContainer.getConnectionUrl());
    ledger = new LedgerService(db, redis);
    cycles = new CreditCycleService(ledger, db, redis);
    const lifecycle = new TenantLifecycle();
    lifecycle.register({
      name: 'teste',
      onAccessChanged: async (row: Tenant) => {
        accessChanged.push(row.id);
      },
    } as never);
    service = new SubscriptionEventsService(
      new TenantService(db),
      lifecycle,
      cycles,
      new PaymentsOutbox(db),
      db,
    );
    await db.insert(planEntitlement).values([
      { planSpaId: String(PLAN), planType: 'subscription', creditsPerCycle: 1000 },
      { planSpaId: String(PACKAGE), planType: 'one_time', creditsPerPackage: 500 },
    ]);
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
  });

  afterAll(async () => {
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('trial: 500 créditos em TRIAL até o fim do trial, projeção e acesso avisado', async () => {
    const trialEndsAt = '2026-10-15T00:00:00.000Z';
    await service.handle(
      event('subscription.trial_started', { status: 'trialing' }, { trialEndsAt, trialDays: 14 }),
    );
    expect(await balance()).toMatchObject({
      trial: TRIAL_CREDITS,
      plan: 0,
      trialEndsAt: new Date(trialEndsAt),
    });
    expect(await projection()).toMatchObject({
      subscriptionId: String(subscriptionId),
      status: 'trialing',
      planId: String(PLAN),
    });
    expect(accessChanged).toEqual([owner.id]);
  });

  it('plano contratado durante o trial: GRANT do plano e TRIAL intocada', async () => {
    await service.handle(
      event(
        'subscription.trial_started',
        { status: 'trialing' },
        { trialEndsAt: '2026-10-15T00:00:00Z', trialDays: 14 },
      ),
    );
    await ledger.debit({
      tenantId: owner.id,
      key: `msg:${owner.id}:x`,
      amount: 200,
      modelCode: 'M',
      unitCost: 200,
      createdBy: 't',
    });
    await service.handle(
      event('subscription.activated', {}, { effectiveAt: '2026-10-05T00:00:00Z' }),
    );
    expect(await balance()).toMatchObject({
      trial: 300,
      plan: 1000,
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('início de ciclo: EXPIRE de PLAN e EXTRA e GRANT; repetição não concede de novo', async () => {
    await service.handle(event('subscription.activated', {}));
    await ledger.debit({
      tenantId: owner.id,
      key: `msg:${owner.id}:a`,
      amount: 700,
      modelCode: 'M',
      unitCost: 700,
      createdBy: 't',
    });
    await ledger.credit({
      tenantId: owner.id,
      key: `purchase:${owner.id}:x`,
      wallet: 'EXTRA',
      type: 'TOPUP',
      amount: 50,
      createdBy: 't',
    });
    expect(await balance()).toMatchObject({ plan: 300, extra: 50 });

    const renewal = event('subscription.renewed', {
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
    });
    await service.handle(renewal);
    expect(await balance()).toMatchObject({
      plan: 1000,
      extra: 0,
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    });

    // Mesma virada de novo (reentrega com versão nova): nada muda.
    await service.handle(
      event('subscription.renewed', {
        periodStart: '2026-11-01T00:00:00.000Z',
        periodEnd: '2026-12-01T00:00:00.000Z',
      }),
    );
    expect(await balance()).toMatchObject({ plan: 1000, extra: 0 });
  });

  it('ciclo anterior negativo: o GRANT abate', async () => {
    await service.handle(event('subscription.activated', {}));
    await ledger.debit({
      tenantId: owner.id,
      key: `msg:${owner.id}:b`,
      amount: 1020,
      modelCode: 'M',
      unitCost: 1020,
      createdBy: 't',
    });
    await service.handle(
      event('subscription.renewed', {
        periodStart: '2026-11-01T00:00:00.000Z',
        periodEnd: '2026-12-01T00:00:00.000Z',
      }),
    );
    expect((await balance()).plan).toBe(980);
  });

  it('dedução de estorno pendente é abatida no novo ciclo, e o que sobra fica para o seguinte', async () => {
    const [deduction] = await db
      .insert(creditDeduction)
      .values({
        tenantId: owner.id,
        amount: 1300,
        remaining: 1300,
        refChargeId: `ch_${randomUUID()}`,
      })
      .returning();
    await service.handle(event('subscription.activated', {}));
    expect((await balance()).plan).toBe(0);
    let [row] = await db
      .select()
      .from(creditDeduction)
      .where(eq(creditDeduction.id, deduction!.id));
    expect(row!.remaining).toBe(300);

    await service.handle(
      event('subscription.renewed', {
        periodStart: '2026-11-01T00:00:00.000Z',
        periodEnd: '2026-12-01T00:00:00.000Z',
      }),
    );
    expect((await balance()).plan).toBe(700);
    [row] = await db.select().from(creditDeduction).where(eq(creditDeduction.id, deduction!.id));
    expect(row!.remaining).toBe(0);
  });

  it('evento com versão antiga é obsoleto e não tem efeito', async () => {
    await service.handle(event('subscription.activated', {}));
    const stale = event('subscription.renewed', {
      version: 1,
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
    });
    await service.handle(event('subscription.past_due', { status: 'past_due' }));
    await expect(service.handle(stale)).resolves.toEqual({ kind: 'obsolete' });
    expect(await projection()).toMatchObject({ status: 'past_due' });
    expect((await balance()).plan).toBe(1000);
  });

  it('assinatura encerrada: expira trial, plano e adicional', async () => {
    await service.handle(
      event(
        'subscription.trial_started',
        { status: 'trialing' },
        { trialEndsAt: '2026-10-15T00:00:00Z', trialDays: 14 },
      ),
    );
    await service.handle(event('subscription.activated', {}));
    await service.handle(event('subscription.ended', { status: 'cancelled' }));
    expect(await balance()).toMatchObject({
      trial: 0,
      plan: 0,
      extra: 0,
      expiresAt: null,
      trialEndsAt: null,
    });
    expect(await projection()).toMatchObject({ status: 'cancelled' });
  });

  it('pacote pago: TOPUP em EXTRA (créditos × quantidade), uma vez só', async () => {
    await service.handle(event('subscription.activated', {}));
    const paid = event(
      'purchase.paid',
      {},
      { purchaseId: 77, planId: PACKAGE, quantity: 2, chargeId: 'ch_1' },
    );
    await service.handle(paid);
    await service.handle({ ...paid, eventId: randomUUID() } as PlatformEvent);
    expect((await balance()).extra).toBe(1000);
  });

  it('pacote sem créditos cadastrados: falha para tratamento manual', async () => {
    await expect(
      service.handle(
        event('purchase.paid', {}, { purchaseId: 78, planId: 9999, quantity: 1, chargeId: null }),
      ),
    ).rejects.toThrow('sem créditos cadastrados');
  });

  it('plano sem direitos cadastrados: ciclo sem créditos, datas atualizadas', async () => {
    await service.handle(event('subscription.activated', { planId: 4242 }));
    expect(await balance()).toMatchObject({
      plan: 0,
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('assinatura nova agenda o espelho dos agentes não removidos', async () => {
    const [model] = await db
      .insert(aiModel)
      .values({
        code: `M_${randomBytes(3).toString('hex')}`,
        displayName: 'M',
        creditsPerResponse: 1,
      })
      .returning();
    const base = {
      tenantId: owner.id,
      name: 'Ana',
      type: 'SUPPORT' as const,
      communicationType: 'NORMAL' as const,
      modelId: model!.id,
    };
    const [live] = await db
      .insert(agent)
      .values({ ...base, gptmakerAgentId: `gm-${randomUUID()}`, webhookTokenHash: randomUUID() })
      .returning();
    await db.insert(agent).values({
      ...base,
      gptmakerAgentId: `gm-${randomUUID()}`,
      webhookTokenHash: randomUUID(),
      status: 'DELETED',
    });

    await service.handle(event('subscription.activated', {}));
    const queued = await db
      .select()
      .from(paymentsOutbox)
      .where(and(eq(paymentsOutbox.tenantId, owner.id)));
    expect(queued.map((row) => row.aggregateRef)).toEqual([live!.id]);

    // Renovação da mesma assinatura não agenda de novo.
    await service.handle(
      event('subscription.renewed', {
        periodStart: '2026-11-01T00:00:00.000Z',
        periodEnd: '2026-12-01T00:00:00.000Z',
      }),
    );
    expect(
      await db.select().from(paymentsOutbox).where(eq(paymentsOutbox.tenantId, owner.id)),
    ).toHaveLength(1);
  });

  it('job do trial: expira TRIAL vencida mesmo com plano ativo', async () => {
    await service.handle(
      event(
        'subscription.trial_started',
        { status: 'trialing' },
        { trialEndsAt: '2026-10-15T00:00:00Z', trialDays: 14 },
      ),
    );
    await service.handle(event('subscription.activated', {}));
    expect(await cycles.expireTrials(new Date('2026-10-14T00:00:00Z'))).toBe(0);
    await cycles.expireTrials(new Date(Date.parse('2026-10-15T00:00:00Z') + DAY));
    expect(await balance()).toMatchObject({ trial: 0, plan: 1000 });
  });

  it('mesmo período ativado de novo com outro eventId: não expira o que acabou de conceder', async () => {
    // Sem saldo antes da ativação, o EXPIRE do início do ciclo não grava lançamento.
    await service.handle(event('subscription.activated', {}));
    await service.handle(event('subscription.activated', {}));
    expect(await balance()).toMatchObject({ plan: 1000, total: 1000 });
  });
});
