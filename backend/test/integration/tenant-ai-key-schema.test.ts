import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { tenant, tenantAiKey } = schema;

/** Migração da chave de IA do cliente (tarefa 4.3): uma por tenant, cifrada em repouso. */
describe('schema da chave de IA do tenant', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  async function newTenant() {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    return row!;
  }

  const key = (tenantId: string, apiKey = 'vibe_api_segredo123456') => ({
    tenantId,
    apiKey,
    last4: apiKey.slice(-4),
    model: 'bitrix/bitrixgpt-5.5',
    verifiedAt: new Date(),
  });

  it('grava a chave cifrada e devolve o valor em claro à aplicação', async () => {
    const owner = await newTenant();
    await db.insert(tenantAiKey).values(key(owner.id));

    const [row] = await db.select().from(tenantAiKey).where(eq(tenantAiKey.tenantId, owner.id));
    expect(row).toMatchObject({
      tenantId: owner.id,
      apiKey: 'vibe_api_segredo123456',
      last4: '3456',
    });
    expect(row!.createdAt).toBeInstanceOf(Date);

    const raw = await pool.query<{ api_key: string }>(
      'select api_key from tenant_ai_key where tenant_id = $1',
      [owner.id],
    );
    expect(raw.rows[0]!.api_key).toMatch(/^v1:/);
    expect(raw.rows[0]!.api_key).not.toContain('segredo');
  });

  it('aceita uma chave por tenant', async () => {
    const owner = await newTenant();
    await db.insert(tenantAiKey).values(key(owner.id));
    await expect(
      db.insert(tenantAiKey).values(key(owner.id, 'vibe_api_outra000000')),
    ).rejects.toThrow();
    // Trocar a chave é atualizar a linha do tenant.
    await db
      .update(tenantAiKey)
      .set({ apiKey: 'vibe_api_nova1111111', last4: '1111' })
      .where(eq(tenantAiKey.tenantId, owner.id));
    const [row] = await db.select().from(tenantAiKey).where(eq(tenantAiKey.tenantId, owner.id));
    expect(row).toMatchObject({ apiKey: 'vibe_api_nova1111111', last4: '1111' });
  });

  it('recusa chave de um tenant que não existe', async () => {
    await expect(
      db.insert(tenantAiKey).values(key('00000000-0000-4000-8000-000000000000')),
    ).rejects.toThrow();
  });
});
