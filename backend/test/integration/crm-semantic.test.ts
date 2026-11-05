import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldSettingsService } from '../../src/modules/semantic/field-settings.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import type { Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { tenant } = schema;

// Escolhas de campos do CRM por tenant (spec crm-semantic-layer; tarefas 2.1 e 3.2).
describe('camada semântica: escolhas por tenant', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let settings: FieldSettingsService;

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
    pool = testPool(container.getConnectionUri());
    db = drizzle(pool, { schema });
    settings = new FieldSettingsService(db as unknown as Database);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('sem escolha vale o padrão; a escolha gravada vale só para o tenant', async () => {
    const a = await newTenant();
    const b = await newTenant();

    expect((await settings.forTenant(a.id)).exposed('contact', 'NAME')).toBe(true);
    expect((await settings.forTenant(a.id)).exposed('contact', 'UF_CRM_ORIGEM')).toBe(false);

    await settings.save(a.id, 'contact', 'UF_CRM_ORIGEM', {
      exposed: true,
      description: 'Canal de chegada',
    });
    await settings.save(a.id, 'contact', 'NAME', { exposed: false, description: '' });

    const choicesA = await settings.forTenant(a.id);
    expect(choicesA.exposed('contact', 'UF_CRM_ORIGEM')).toBe(true);
    expect(choicesA.description('contact', 'UF_CRM_ORIGEM')).toBe('Canal de chegada');
    expect(choicesA.exposed('contact', 'NAME')).toBe(false);

    const choicesB = await settings.forTenant(b.id);
    expect(choicesB.exposed('contact', 'UF_CRM_ORIGEM')).toBe(false);
    expect(choicesB.exposed('contact', 'NAME')).toBe(true);
  });

  it('regravar atualiza a mesma linha', async () => {
    const a = await newTenant();
    await settings.save(a.id, 'deal', 'UF_CRM_PLANO', { exposed: true, description: 'v1' });
    await settings.save(a.id, 'deal', 'UF_CRM_PLANO', { exposed: false, description: 'v2' });
    const entries = (await settings.forTenant(a.id)).entries();
    expect(entries).toEqual([
      { entity: 'deal', code: 'UF_CRM_PLANO', exposed: false, description: 'v2' },
    ]);
  });
});
