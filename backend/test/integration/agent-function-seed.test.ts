import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FunctionCatalog } from '../../src/modules/agent-functions/function-catalog.service';
import { seedAgentFunctions } from '../../src/modules/agent-functions/function-seed';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const { agentFunctionTemplate, agentFunctionTemplateVersion } = schema;

// Seed das funções iniciais (tarefa 4.4, design D10).
describe('seed das funções do agente', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let catalog: FunctionCatalog;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    catalog = new FunctionCatalog(db);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('publica as quatro funções como versão 1 e não sobrescreve na segunda vez', async () => {
    // comum, crm, duvida, registro e transferir.
    expect(await seedAgentFunctions(db, catalog)).toEqual({ blocks: 5, templates: 4 });
    const published = await catalog.listPublished();
    expect(published.map((fn) => [fn.code, fn.version])).toEqual([
      ['POST_SALES', 1],
      ['SCHEDULING', 1],
      ['SDR', 1],
      ['SUPPORT', 1],
    ]);

    // O backoffice publica a versão 2 do SDR; o seed seguinte não mexe.
    await catalog.publishTemplate('SDR', null);
    await db
      .update(agentFunctionTemplate)
      .set({ name: 'SDR renomeado' })
      .where(eq(agentFunctionTemplate.code, 'SDR'));

    expect(await seedAgentFunctions(db, catalog)).toEqual({ blocks: 0, templates: 0 });
    const sdr = await catalog.getTemplate('SDR');
    expect(sdr).toMatchObject({ name: 'SDR renomeado', latestVersion: 2 });
    expect(await db.select().from(agentFunctionTemplateVersion)).toHaveLength(5);
  });

  it('função padrão excluída não volta pelo seed', async () => {
    await catalog.remove('POST_SALES');
    expect(await seedAgentFunctions(db, catalog)).toEqual({ blocks: 0, templates: 0 });
    expect((await catalog.listTemplates()).map((row) => row.code)).not.toContain('POST_SALES');
  });

  it('a versão do seed traz os blocos expandidos', async () => {
    const support = await catalog.latestPublished('SUPPORT');
    expect(support.content.fields[0]?.id).toBe('empresa.nome');
    expect(support.content.behavior).toContain('QUANDO NÃO SOUBER');
    expect(support.content.intentions.map((intention) => intention.key)).toEqual([
      'abrir_chamado',
      'registrar_duvida',
      'transferir_atendente',
    ]);
  });
});
