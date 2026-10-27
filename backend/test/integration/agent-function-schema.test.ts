import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const {
  agent,
  agentFunctionConfig,
  agentFunctionTemplate,
  agentFunctionTemplateVersion,
  agentManagedResource,
  aiModel,
  tenant,
} = schema;

/** Migração das funções do agente (tarefa 2.1): tabelas, padrões e unicidades. */
describe('schema das funções do agente', () => {
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
    const [template] = await db
      .insert(agentFunctionTemplate)
      .values({
        code: `SDR_${code.toUpperCase()}`,
        name: 'SDR',
        description: 'Qualifica',
        draft: {} as never,
      })
      .returning();
    return { owner: owner!, agent: row!, template: template! };
  }

  it('aplica a migração com os padrões esperados', async () => {
    const { owner, agent: row, template } = await setup();
    const [config] = await db
      .insert(agentFunctionConfig)
      .values({ agentId: row.id, tenantId: owner.id, templateId: template.id })
      .returning();
    expect(config).toMatchObject({
      mode: 'SIMPLE',
      publicationStatus: 'IDLE',
      answers: {},
      versionId: null,
      publishedState: null,
    });
    expect(owner.isPartner).toBe(false);
  });

  it('não repete o número da versão do template', async () => {
    const { template } = await setup();
    await db
      .insert(agentFunctionTemplateVersion)
      .values({ templateId: template.id, version: 1, content: {} as never });
    await expect(
      db
        .insert(agentFunctionTemplateVersion)
        .values({ templateId: template.id, version: 1, content: {} as never }),
    ).rejects.toThrow();
  });

  it('não repete a chave do recurso gerenciado no agente', async () => {
    const { owner, agent: row } = await setup();
    const resource = {
      tenantId: owner.id,
      agentId: row.id,
      kind: 'TRAINING' as const,
      key: 'base.produtos:1',
      hash: 'h',
    };
    await db.insert(agentManagedResource).values(resource);
    await expect(db.insert(agentManagedResource).values(resource)).rejects.toThrow();
    // A mesma chave como intenção é outro recurso.
    await db.insert(agentManagedResource).values({ ...resource, kind: 'INTENTION' });
  });
});
