import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agent, aiModel, tenant, training } = schema;

/** Migração de tags e expiração em `training` (spec training-tags, training-expiration). */
describe('schema de treinamentos: tags e expiração', () => {
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

  async function setup() {
    const code = randomBytes(4).toString('hex');
    const [owner] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    const [model] = await db
      .insert(aiModel)
      .values({ code: `M_${code}`, displayName: 'Modelo', creditsPerResponse: 1 })
      .returning();
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner!.id,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Bot',
        type: 'SALE',
        communicationType: 'NORMAL',
        modelId: model!.id,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return { tenantId: owner!.id, agentId: row!.id };
  }

  it('treinamento sem tags nem expiração fica com os padrões', async () => {
    const base = await setup();
    const [row] = await db
      .insert(training)
      .values({ ...base, type: 'TEXT', content: 'Preços' })
      .returning();
    expect(row).toMatchObject({ tags: [], expiresAt: null, expiredAt: null, status: 'PROCESSING' });
  });

  it('aceita o estado EXPIRED, tags e datas', async () => {
    const base = await setup();
    const now = new Date();
    const [row] = await db
      .insert(training)
      .values({
        ...base,
        type: 'WEBSITE',
        url: 'https://exemplo.com',
        status: 'EXPIRED',
        tags: ['preços', '2026'],
        expiresAt: now,
        expiredAt: now,
      })
      .returning();
    expect(row).toMatchObject({ status: 'EXPIRED', tags: ['preços', '2026'] });
  });

  it('cria os índices de varredura da expiração e de tags', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'training'",
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining(['training_expiry_scan_idx', 'training_tags_gin_idx']),
    );
  });
});
