import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreditStatementService } from '../../src/modules/billing/credit-statement.service';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import { CreditSummaryService } from '../../src/modules/payments/credit-summary.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const { agent, aiModel, creditLedger, subscriptionState, tenant } = schema;

// Saldo, consumo por dia e movimentações (spec credit-billing: "Consulta de saldo" e "Extrato").
describe('saldo e extrato do tenant', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let statement: CreditStatementService;
  let summaries: CreditSummaryService;
  let modelId: string;
  let tenantId: string;
  let ana: string;
  let bia: string;

  async function newAgent(name: string): Promise<string> {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name,
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return row!.id;
  }

  /** Lançamento com data fixa (o ledger aceita INSERT; só bloqueia UPDATE e DELETE). */
  async function entry(values: {
    at: string;
    type: 'GRANT' | 'TOPUP' | 'DEBIT' | 'ADJUSTMENT' | 'EXPIRE';
    wallet?: 'TRIAL' | 'PLAN' | 'EXTRA';
    amount: number;
    agentId?: string;
    refId?: string;
    reason?: string;
  }): Promise<void> {
    await db.insert(creditLedger).values({
      tenantId,
      wallet: values.wallet ?? 'PLAN',
      type: values.type,
      amount: values.amount,
      agentId: values.agentId,
      modelCode: values.type === 'DEBIT' ? 'GPT_5_MINI' : undefined,
      unitCost: values.type === 'DEBIT' ? -values.amount : undefined,
      refType: values.type === 'DEBIT' ? 'message' : 'subscription',
      refId: values.refId,
      reason: values.reason,
      idempotencyKey: randomUUID(),
      createdBy: 'teste',
      createdAt: new Date(values.at),
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
    ledger = new LedgerService(db, redis);
    statement = new CreditStatementService(db);
    summaries = new CreditSummaryService(ledger, statement, db);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: String(Math.floor(Math.random() * 1_000_000)),
        memberId: code,
        domain: `${code}.b24.com`,
        tenantCode: code,
      })
      .returning();
    tenantId = row!.id;
    ana = await newAgent('Ana');
    bia = await newAgent('Bia');
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  describe('consumo por dia', () => {
    beforeEach(async () => {
      // 03/10 no Brasil (UTC-3): 12:00Z e 02:59Z do dia 04 ainda são dia 03.
      await entry({
        at: '2026-10-03T12:00:00Z',
        type: 'DEBIT',
        amount: -1,
        agentId: ana,
        refId: 'm1',
      });
      // Débito que atravessou carteiras: dois lançamentos, uma resposta.
      await entry({
        at: '2026-10-04T02:59:00Z',
        type: 'DEBIT',
        wallet: 'TRIAL',
        amount: -2,
        agentId: ana,
        refId: 'm2',
      });
      await entry({
        at: '2026-10-04T02:59:00Z',
        type: 'DEBIT',
        wallet: 'PLAN',
        amount: -3,
        agentId: ana,
        refId: 'm2',
      });
      // 04/10 no Brasil.
      await entry({
        at: '2026-10-04T03:00:00Z',
        type: 'DEBIT',
        amount: -7,
        agentId: bia,
        refId: 'm3',
      });
      // Fora do período e outro tipo: não entram.
      await entry({
        at: '2026-10-01T12:00:00Z',
        type: 'DEBIT',
        amount: -9,
        agentId: ana,
        refId: 'm0',
      });
      await entry({ at: '2026-10-03T13:00:00Z', type: 'GRANT', amount: 500 });
    });

    it('agrupa por dia do Brasil e agente; débito em duas carteiras conta uma resposta', async () => {
      expect(await statement.usage(tenantId, { from: '2026-10-02', to: '2026-10-04' })).toEqual({
        rows: [
          { day: '2026-10-04', agentId: bia, agentName: 'Bia', responses: 1, credits: 7 },
          { day: '2026-10-03', agentId: ana, agentName: 'Ana', responses: 2, credits: 6 },
        ],
        totals: { responses: 3, credits: 13 },
      });
    });

    it('filtra por agente', async () => {
      const view = await statement.usage(tenantId, {
        from: '2026-10-01',
        to: '2026-10-04',
        agentId: ana,
      });
      expect(view.rows.map((r) => [r.day, r.credits])).toEqual([
        ['2026-10-03', 6],
        ['2026-10-01', 9],
      ]);
    });

    it('não mistura tenants', async () => {
      const other = tenantId;
      const code = randomBytes(4).toString('hex');
      const [row] = await db
        .insert(tenant)
        .values({
          installationId: code,
          memberId: code,
          domain: `${code}.b24.com`,
          tenantCode: code,
        })
        .returning();
      tenantId = row!.id;
      expect(
        (await statement.usage(tenantId, { from: '2026-10-01', to: '2026-10-04' })).rows,
      ).toEqual([]);
      tenantId = other;
    });
  });

  it('movimentações: sem débitos, mais recentes primeiro, com cursor', async () => {
    await entry({ at: '2026-10-01T10:00:00Z', type: 'GRANT', wallet: 'TRIAL', amount: 500 });
    await entry({
      at: '2026-10-02T10:00:00Z',
      type: 'DEBIT',
      amount: -1,
      agentId: ana,
      refId: 'm1',
    });
    await entry({ at: '2026-10-03T10:00:00Z', type: 'TOPUP', wallet: 'EXTRA', amount: 1000 });
    await entry({
      at: '2026-10-04T10:00:00Z',
      type: 'ADJUSTMENT',
      amount: -5,
      reason: 'reconciliação',
    });

    const first = await statement.entries(tenantId, { limit: 2 });
    expect(first.entries.map((e) => [e.type, e.amount])).toEqual([
      ['ADJUSTMENT', -5],
      ['TOPUP', 1000],
    ]);
    expect(first.entries[0]!.reason).toBe('reconciliação');
    expect(first.nextBefore).toBe('2026-10-03T10:00:00.000Z');

    const second = await statement.entries(tenantId, { limit: 2, before: first.nextBefore! });
    expect(second.entries.map((e) => [e.type, e.wallet, e.amount])).toEqual([
      ['GRANT', 'TRIAL', 500],
    ]);
    expect(second.nextBefore).toBeNull();
  });

  describe('resumo', () => {
    it('sem nada: tudo zerado', async () => {
      expect(await summaries.summary(tenantId)).toEqual({
        trial: { balance: 0, endsAt: null },
        plan: { balance: 0 },
        extra: { balance: 0 },
        total: 0,
        expiresAt: null,
        renewsAt: null,
        cancelAt: null,
        graceUntil: null,
        subscription: null,
        cycleStart: null,
        consumedInCycle: 0,
      });
    });

    it('plano ativo: saldos, renovação no fim do ciclo e consumo desde o início', async () => {
      const periodStart = new Date(Date.now() - 2 * 86_400_000);
      const periodEnd = new Date(Date.now() + 28 * 86_400_000);
      await db.insert(subscriptionState).values({
        tenantId,
        subscriptionId: '42',
        status: 'active',
        modality: 'stripe',
        planId: '11',
        periodStart,
        periodEnd,
        version: 1,
      });
      await ledger.credit({
        tenantId,
        key: 'g',
        createdBy: 't',
        wallet: 'PLAN',
        type: 'GRANT',
        amount: 5000,
      });
      await ledger.credit({
        tenantId,
        key: 'p',
        createdBy: 't',
        wallet: 'EXTRA',
        type: 'TOPUP',
        amount: 1000,
      });
      await ledger.setDates(tenantId, { expiresAt: periodEnd });
      await ledger.debit({
        tenantId,
        key: 'm',
        createdBy: 't',
        amount: 4,
        modelCode: 'GPT_5_MINI',
        unitCost: 4,
        agentId: ana,
      });
      // Débito anterior ao ciclo não conta.
      await entry({
        at: new Date(periodStart.getTime() - 3_600_000).toISOString(),
        type: 'DEBIT',
        amount: -9,
        agentId: ana,
        refId: 'antigo',
      });

      expect(await summaries.summary(tenantId)).toMatchObject({
        plan: { balance: 4996 },
        extra: { balance: 1000 },
        total: 5996,
        expiresAt: periodEnd.toISOString(),
        renewsAt: periodEnd.toISOString(),
        subscription: { status: 'active', planId: '11' },
        cycleStart: periodStart.toISOString(),
        consumedInCycle: 4,
      });
    });

    it('cancelamento agendado: sem renovação', async () => {
      await db.insert(subscriptionState).values({
        tenantId,
        subscriptionId: '43',
        status: 'active',
        modality: 'stripe',
        planId: '11',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 86_400_000),
        cancelAt: new Date(Date.now() + 86_400_000),
        version: 1,
      });
      const view = await summaries.summary(tenantId);
      expect(view.renewsAt).toBeNull();
      expect(view.cancelAt).not.toBeNull();
    });

    it('trial: saldo e fim do trial, sem renovação', async () => {
      const trialEndsAt = new Date(Date.now() + 14 * 86_400_000);
      await db.insert(subscriptionState).values({
        tenantId,
        subscriptionId: '44',
        status: 'trialing',
        modality: 'manual',
        planId: '9',
        periodStart: new Date(Date.now() - 60_000),
        periodEnd: trialEndsAt,
        version: 1,
      });
      await ledger.credit({
        tenantId,
        key: 't',
        createdBy: 't',
        wallet: 'TRIAL',
        type: 'GRANT',
        amount: 500,
      });
      await ledger.setDates(tenantId, { trialEndsAt });
      await ledger.debit({
        tenantId,
        key: 'm1',
        createdBy: 't',
        amount: 1,
        modelCode: 'GPT_5_MINI',
        unitCost: 1,
        agentId: bia,
      });

      expect(await summaries.summary(tenantId)).toMatchObject({
        trial: { balance: 499, endsAt: trialEndsAt.toISOString() },
        total: 499,
        renewsAt: null,
        subscription: { status: 'trialing' },
        consumedInCycle: 1,
      });
    });
  });
});
