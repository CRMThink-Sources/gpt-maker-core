import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const {
  aiModel,
  backofficeUser,
  creditLedger,
  planEntitlement,
  tenant,
  tenantBalance,
  workspaceSyncFinding,
} = schema;

describe('schema e migrações', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  /** Código de erro do Postgres da falha (drizzle embrulha o erro do driver em `cause`). */
  async function pgError(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      const err = error as { code?: string; cause?: { code?: string } };
      return err.cause?.code ?? err.code;
    }
    throw new Error('era esperado erro do Postgres');
  }

  async function newTenant() {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: `member-${code}`,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    return row!;
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(container.getConnectionUri());
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('reaplicar migrações não faz nada', async () => {
    await expect(runMigrations(container.getConnectionUri())).resolves.toBeUndefined();
  });

  it('migrações concorrentes são serializadas', async () => {
    const url = container.getConnectionUri();
    await expect(Promise.all([runMigrations(url), runMigrations(url)])).resolves.toBeDefined();
  });

  describe('credit_ledger', () => {
    const entry = (
      tenantId: string,
      overrides: Partial<typeof creditLedger.$inferInsert> = {},
    ) => ({
      tenantId,
      wallet: 'PLAN' as const,
      type: 'GRANT' as const,
      amount: 1000,
      idempotencyKey: `grant:${randomUUID()}`,
      createdBy: 'test',
      ...overrides,
    });

    it('bloqueia UPDATE, DELETE e TRUNCATE', async () => {
      const t = await newTenant();
      const [row] = await db.insert(creditLedger).values(entry(t.id)).returning();
      const where = eq(creditLedger.id, row!.id);
      expect(await pgError(db.update(creditLedger).set({ amount: 1 }).where(where))).toBe('23001');
      expect(await pgError(db.delete(creditLedger).where(where))).toBe('23001');
      expect(await pgError(db.execute(sql`truncate credit_ledger cascade`))).toBe('23001');
    });

    it('recusa idempotency key repetida', async () => {
      const t = await newTenant();
      const key = `msg:${randomUUID()}:PLAN`;
      await db.insert(creditLedger).values(entry(t.id, { idempotencyKey: key }));
      expect(
        await pgError(db.insert(creditLedger).values(entry(t.id, { idempotencyKey: key }))),
      ).toBe('23505');
    });

    it('exige sinal coerente com o tipo', async () => {
      const t = await newTenant();
      expect(await pgError(db.insert(creditLedger).values(entry(t.id, { amount: -5 })))).toBe(
        '23514',
      );
      expect(
        await pgError(
          db
            .insert(creditLedger)
            .values(
              entry(t.id, { type: 'DEBIT', amount: 3, modelCode: 'GPT_5_MINI', unitCost: 3 }),
            ),
        ),
      ).toBe('23514');
      await db.insert(creditLedger).values(entry(t.id, { type: 'ADJUSTMENT', amount: -300 }));
    });

    it('débito exige modelo e custo', async () => {
      const t = await newTenant();
      expect(
        await pgError(db.insert(creditLedger).values(entry(t.id, { type: 'DEBIT', amount: -3 }))),
      ).toBe('23514');
      await db
        .insert(creditLedger)
        .values(entry(t.id, { type: 'DEBIT', amount: -3, modelCode: 'GPT_5_MINI', unitCost: 3 }));
    });
  });

  describe('tenant_balance', () => {
    it('só a carteira PLAN pode ficar negativa', async () => {
      const t = await newTenant();
      await db.insert(tenantBalance).values({ tenantId: t.id, planBalance: -20 });
      const where = eq(tenantBalance.tenantId, t.id);
      expect(await pgError(db.update(tenantBalance).set({ trialBalance: -1 }).where(where))).toBe(
        '23514',
      );
      expect(await pgError(db.update(tenantBalance).set({ extraBalance: -1 }).where(where))).toBe(
        '23514',
      );
    });
  });

  describe('ai_model', () => {
    const model = (code: string, overrides: Partial<typeof aiModel.$inferInsert> = {}) => ({
      code,
      displayName: code,
      creditsPerResponse: 2,
      ...overrides,
    });

    it('código único entre modelos não removidos', async () => {
      const code = `M_${randomBytes(3).toString('hex')}`;
      const [first] = await db.insert(aiModel).values(model(code)).returning();
      expect(await pgError(db.insert(aiModel).values(model(code)))).toBe('23505');
      await db.update(aiModel).set({ deletedAt: new Date() }).where(eq(aiModel.id, first!.id));
      await db.insert(aiModel).values(model(code));
    });

    it('no máximo um modelo padrão', async () => {
      await db
        .insert(aiModel)
        .values(model(`D_${randomBytes(3).toString('hex')}`, { isDefault: true }));
      expect(
        await pgError(
          db
            .insert(aiModel)
            .values(model(`D_${randomBytes(3).toString('hex')}`, { isDefault: true })),
        ),
      ).toBe('23505');
    });

    it('custo por resposta positivo', async () => {
      expect(
        await pgError(db.insert(aiModel).values(model('ZERO', { creditsPerResponse: 0 }))),
      ).toBe('23514');
    });
  });

  it('plan_entitlement exige créditos conforme o tipo', async () => {
    expect(
      await pgError(
        db.insert(planEntitlement).values({ planSpaId: 'p1', planType: 'subscription' }),
      ),
    ).toBe('23514');
    expect(
      await pgError(
        db
          .insert(planEntitlement)
          .values({ planSpaId: 'p2', planType: 'one_time', creditsPerCycle: 10 }),
      ),
    ).toBe('23514');
    await db.insert(planEntitlement).values([
      { planSpaId: 'p3', planType: 'subscription', creditsPerCycle: 1000 },
      { planSpaId: 'p4', planType: 'one_time', creditsPerPackage: 500 },
    ]);
  });

  it('coluna cifrada guarda só o texto cifrado', async () => {
    const [user] = await db
      .insert(backofficeUser)
      .values({
        email: 'Op@Exemplo.com',
        name: 'Op',
        role: 'ADMIN',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      })
      .returning();
    const raw = await pool.query('select totp_secret from backoffice_user where id = $1', [
      user!.id,
    ]);
    expect(raw.rows[0].totp_secret).toMatch(/^v1:/);
    expect(raw.rows[0].totp_secret).not.toContain('JBSWY3DPEHPK3PXP');
    const [read] = await db.select().from(backofficeUser).where(eq(backofficeUser.id, user!.id));
    expect(read!.totpSecret).toBe('JBSWY3DPEHPK3PXP');
    // E-mail único sem diferenciar maiúsculas.
    expect(
      await pgError(
        db.insert(backofficeUser).values({ email: 'op@exemplo.com', name: 'x', role: 'SUPPORT' }),
      ),
    ).toBe('23505');
  });

  it('uma divergência aberta por agente e tipo', async () => {
    const finding = { kind: 'ORPHAN' as const, gptmakerAgentId: `gm-${randomUUID()}` };
    const [open] = await db.insert(workspaceSyncFinding).values(finding).returning();
    expect(await pgError(db.insert(workspaceSyncFinding).values(finding))).toBe('23505');
    await db
      .update(workspaceSyncFinding)
      .set({ resolvedAt: new Date(), resolvedBy: 'op', resolution: 'removido' })
      .where(eq(workspaceSyncFinding.id, open!.id));
    await db.insert(workspaceSyncFinding).values(finding);
  });
});
