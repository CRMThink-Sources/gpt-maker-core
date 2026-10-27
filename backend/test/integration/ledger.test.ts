import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq, sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { balanceCacheKey, BalanceReader } from '../../src/modules/billing/balance.reader';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { creditLedger, tenant } = schema;

// Ledger de créditos e carteiras (spec credit-billing, design D8).
describe('ledger de créditos', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let ledger: LedgerService;
  let tenantId: string;

  // Chaves de idempotência são únicas na tabela inteira: no app levam o tenant (`msg:<tenant>:...`).
  const op = (key: string) => ({ tenantId, key: `${tenantId}:${key}`, createdBy: 'teste' });
  const fund = async (wallets: { TRIAL?: number; PLAN?: number; EXTRA?: number }) => {
    if (wallets.TRIAL)
      await ledger.credit({
        ...op('seed:trial'),
        wallet: 'TRIAL',
        type: 'GRANT',
        amount: wallets.TRIAL,
      });
    if (wallets.PLAN)
      await ledger.credit({
        ...op('seed:plan'),
        wallet: 'PLAN',
        type: 'GRANT',
        amount: wallets.PLAN,
      });
    if (wallets.EXTRA)
      await ledger.credit({
        ...op('seed:extra'),
        wallet: 'EXTRA',
        type: 'TOPUP',
        amount: wallets.EXTRA,
      });
  };
  const entriesOf = (key: string) =>
    db
      .select({ wallet: creditLedger.wallet, type: creditLedger.type, amount: creditLedger.amount })
      .from(creditLedger)
      .where(sql`${creditLedger.idempotencyKey} like ${`${tenantId}:${key}:%`}`)
      .orderBy(creditLedger.wallet);
  /** O saldo materializado tem de bater com a soma do ledger, carteira a carteira. */
  async function ledgerSums() {
    const rows = await db
      .select({ wallet: creditLedger.wallet, sum: sql<string>`sum(${creditLedger.amount})` })
      .from(creditLedger)
      .where(eq(creditLedger.tenantId, tenantId))
      .groupBy(creditLedger.wallet);
    return Object.fromEntries(rows.map((row) => [row.wallet, Number(row.sum)]));
  }

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri(), { max: 20 });
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    ledger = new LedgerService(db, redis);
  });

  beforeEach(async () => {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    tenantId = row!.id;
  });

  afterAll(async () => {
    await redis?.quit();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  describe('débito em cascata', () => {
    it('débito com saldo em mais de uma carteira: sai de PLAN', async () => {
      await fund({ PLAN: 10, EXTRA: 100 });
      const result = await ledger.debit({
        ...op('msg:1'),
        amount: 3,
        modelCode: 'GPT_5_MINI',
        unitCost: 3,
      });
      expect(result.balance).toMatchObject({ plan: 7, extra: 100, total: 107 });
      expect(await entriesOf('msg:1')).toEqual([{ wallet: 'PLAN', type: 'DEBIT', amount: -3 }]);
    });

    it('débito que atravessa as carteiras: um lançamento por carteira', async () => {
      await fund({ PLAN: 2, EXTRA: 100 });
      const result = await ledger.debit({
        ...op('msg:2'),
        amount: 3,
        modelCode: 'GPT_5_MINI',
        unitCost: 3,
      });
      expect(result.balance).toMatchObject({ plan: 0, extra: 99 });
      expect(await entriesOf('msg:2')).toEqual([
        { wallet: 'PLAN', type: 'DEBIT', amount: -2 },
        { wallet: 'EXTRA', type: 'DEBIT', amount: -1 },
      ]);
    });

    it('TRIAL primeiro', async () => {
      await fund({ TRIAL: 300, PLAN: 1000 });
      const result = await ledger.debit({ ...op('msg:3'), amount: 5, modelCode: 'M', unitCost: 5 });
      expect(result.balance).toMatchObject({ trial: 295, plan: 1000 });
    });

    it('saldo negativo: o excedente fica em PLAN; TRIAL e EXTRA não ficam negativas', async () => {
      await fund({ TRIAL: 1, EXTRA: 1 });
      const result = await ledger.debit({ ...op('msg:4'), amount: 5, modelCode: 'M', unitCost: 5 });
      expect(result.balance).toMatchObject({ trial: 0, plan: -3, extra: 0, total: -3 });
      expect(await ledgerSums()).toEqual({ TRIAL: 0, PLAN: -3, EXTRA: 0 });
    });

    it('reprocessar a mesma mensagem não debita de novo, mesmo com o saldo mudado', async () => {
      await fund({ PLAN: 2, EXTRA: 100 });
      await ledger.debit({ ...op('msg:5'), amount: 3, modelCode: 'M', unitCost: 3 });
      await ledger.credit({ ...op('grant:x'), wallet: 'PLAN', type: 'GRANT', amount: 50 });
      const again = await ledger.debit({ ...op('msg:5'), amount: 3, modelCode: 'M', unitCost: 3 });
      expect(again.applied).toBe(false);
      expect(again.balance).toMatchObject({ plan: 50, extra: 99 });
      expect(await entriesOf('msg:5')).toHaveLength(2);
    });

    it('guarda modelo, custo, agente e referência no lançamento', async () => {
      await fund({ PLAN: 10 });
      await ledger.debit({
        ...op('msg:6'),
        amount: 2,
        modelCode: 'CLAUDE_4_5_HAIKU',
        unitCost: 2,
        refType: 'message',
        refId: 't:456:6',
      });
      const [row] = await db
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.idempotencyKey, `${tenantId}:msg:6:PLAN`));
      expect(row).toMatchObject({
        modelCode: 'CLAUDE_4_5_HAIKU',
        unitCost: 2,
        refType: 'message',
        refId: 't:456:6',
      });
    });
  });

  describe('entradas, expiração, ajuste e estorno', () => {
    it('GRANT e TOPUP; TOPUP só em EXTRA', async () => {
      await ledger.credit({ ...op('grant:1'), wallet: 'PLAN', type: 'GRANT', amount: 1000 });
      const topup = await ledger.credit({
        ...op('purchase:1'),
        wallet: 'EXTRA',
        type: 'TOPUP',
        amount: 500,
      });
      expect(topup.balance).toMatchObject({ plan: 1000, extra: 500, total: 1500 });
      await expect(
        ledger.credit({ ...op('purchase:2'), wallet: 'PLAN', type: 'TOPUP', amount: 1 }),
      ).rejects.toMatchObject({ code: 'LEDGER_INVALID_WALLET' });
      await expect(
        ledger.credit({ ...op('grant:2'), wallet: 'PLAN', type: 'GRANT', amount: 0 }),
      ).rejects.toMatchObject({ code: 'LEDGER_INVALID_AMOUNT' });
    });

    it('início de ciclo: EXPIRE do positivo de PLAN e EXTRA', async () => {
      await fund({ PLAN: 300, EXTRA: 50 });
      const result = await ledger.expire({ ...op('expire:c1'), wallets: ['PLAN', 'EXTRA'] });
      expect(result.balance).toMatchObject({ plan: 0, extra: 0 });
      expect(await entriesOf('expire:c1')).toEqual([
        { wallet: 'PLAN', type: 'EXPIRE', amount: -300 },
        { wallet: 'EXTRA', type: 'EXPIRE', amount: -50 },
      ]);
    });

    it('saldo negativo não expira; GRANT seguinte o abate', async () => {
      await ledger.debit({ ...op('msg:neg'), amount: 20, modelCode: 'M', unitCost: 20 });
      const expired = await ledger.expire({ ...op('expire:c2'), wallets: ['PLAN', 'EXTRA'] });
      expect(expired.entries).toEqual([]);
      const granted = await ledger.credit({
        ...op('grant:c2'),
        wallet: 'PLAN',
        type: 'GRANT',
        amount: 1000,
      });
      expect(granted.balance.plan).toBe(980);
    });

    it('ajuste positivo vai para PLAN; negativo segue a cascata', async () => {
      await fund({ TRIAL: 5, EXTRA: 10 });
      expect(
        (await ledger.adjust({ ...op('adj:1'), amount: 7, reason: 'reconciliação' })).balance,
      ).toMatchObject({
        trial: 5,
        plan: 7,
        extra: 10,
      });
      expect((await ledger.adjust({ ...op('adj:2'), amount: -15 })).balance).toMatchObject({
        trial: 0,
        plan: 0,
        extra: 7,
      });
    });

    it('estorno limitado ao saldo positivo da carteira', async () => {
      await fund({ EXTRA: 200 });
      const result = await ledger.refund({ ...op('refund:ch1'), wallet: 'EXTRA', amount: 500 });
      expect(result.entries).toEqual([{ wallet: 'EXTRA', type: 'REFUND', amount: -200 }]);
      expect(result.balance.extra).toBe(0);
    });

    it('datas da carteira', async () => {
      const trialEndsAt = new Date('2026-10-15T00:00:00Z');
      await ledger.setDates(tenantId, { trialEndsAt });
      expect((await ledger.balance(tenantId)).trialEndsAt).toEqual(trialEndsAt);
    });
  });

  it('apaga o espelho do saldo no Redis; o leitor relê do banco', async () => {
    const reader = new BalanceReader(db, redis);
    await fund({ PLAN: 10 });
    expect(await reader.total(tenantId)).toBe(10);
    expect(await redis.get(balanceCacheKey(tenantId))).toBe('10');
    await ledger.debit({ ...op('msg:cache'), amount: 4, modelCode: 'M', unitCost: 4 });
    expect(await redis.get(balanceCacheKey(tenantId))).toBeNull();
    expect(await reader.total(tenantId)).toBe(6);
  });

  it('o ledger não aceita alteração nem remoção', async () => {
    await fund({ PLAN: 10 });
    await expect(
      db.update(creditLedger).set({ amount: 1 }).where(eq(creditLedger.tenantId, tenantId)),
    ).rejects.toThrow();
    await expect(
      db.delete(creditLedger).where(eq(creditLedger.tenantId, tenantId)),
    ).rejects.toThrow();
  });

  it('concorrência: débitos em paralelo não se perdem e o saldo bate com o ledger', async () => {
    await fund({ TRIAL: 5, PLAN: 10, EXTRA: 5 });
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        ledger.debit({ ...op(`msg:par:${i}`), amount: 1, modelCode: 'M', unitCost: 1 }),
      ),
    );
    // Reentregas concorrentes da mesma mensagem: só uma vale.
    const replays = await Promise.all(
      Array.from({ length: 5 }, () =>
        ledger.debit({ ...op('msg:par:0'), amount: 1, modelCode: 'M', unitCost: 1 }),
      ),
    );
    expect(replays.every((r) => !r.applied)).toBe(true);

    const balance = await ledger.balance(tenantId);
    expect(balance).toMatchObject({ trial: 0, plan: -10, extra: 0, total: -10 });
    expect(await ledgerSums()).toEqual({ TRIAL: 0, PLAN: -10, EXTRA: 0 });
  });
});
