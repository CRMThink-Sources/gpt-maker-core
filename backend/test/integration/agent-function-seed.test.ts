import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FunctionCatalog } from '../../src/modules/agent-functions/function-catalog.service';
import { seedAgentFunctions } from '../../src/modules/agent-functions/function-seed';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

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
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    catalog = new FunctionCatalog(db);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('publica as quatro funções como versão 1 e não sobrescreve na segunda vez', async () => {
    // comum, crm, duvida, registro e transferir.
    expect(await seedAgentFunctions(db, catalog)).toEqual({
      blocks: 5,
      templates: 4,
      translated: 0,
    });
    const published = await catalog.listPublished(randomUUID());
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

    expect(await seedAgentFunctions(db, catalog)).toEqual({
      blocks: 0,
      templates: 0,
      translated: 0,
    });
    const sdr = await catalog.getTemplate('SDR');
    expect(sdr).toMatchObject({ name: 'SDR renomeado', latestVersion: 2 });
    expect(await db.select().from(agentFunctionTemplateVersion)).toHaveLength(5);
  });

  it('função padrão excluída não volta pelo seed', async () => {
    await catalog.remove('POST_SALES');
    expect(await seedAgentFunctions(db, catalog)).toEqual({
      blocks: 0,
      templates: 0,
      translated: 0,
    });
    expect((await catalog.listTemplates()).map((row) => row.code)).not.toContain('POST_SALES');
  });

  it('a versão 1 do seed já sai com as traduções em en e es', async () => {
    const sdr = await catalog.latestPublished('SDR', randomUUID());
    expect(sdr.content.translations?.en?.name).toBe('SDR / Qualification');
    expect(sdr.content.translations?.es?.fields?.['empresa.nome']?.label).toBe(
      'Nombre de la empresa',
    );
  });

  it('função e bloco existentes sem traduções recebem as do seed no rascunho, sem publicar', async () => {
    const [template] = await db
      .select()
      .from(agentFunctionTemplate)
      .where(eq(agentFunctionTemplate.code, 'SUPPORT'));
    const draft = { ...template!.draft, translations: undefined };
    await db
      .update(agentFunctionTemplate)
      .set({ draft })
      .where(eq(agentFunctionTemplate.id, template!.id));
    // Bloco sem traduções (rascunho e publicado): o seed preenche os dois.
    const [comum] = await db
      .select()
      .from(schema.agentFunctionBlock)
      .where(eq(schema.agentFunctionBlock.code, 'comum'));
    await db
      .update(schema.agentFunctionBlock)
      .set({
        draft: { ...comum!.draft, translations: undefined },
        content: { ...comum!.content!, translations: undefined },
      })
      .where(eq(schema.agentFunctionBlock.code, 'comum'));

    const result = await seedAgentFunctions(db, catalog);
    expect(result).toEqual({ blocks: 0, templates: 0, translated: 2 });

    const after = await catalog.getTemplate('SUPPORT');
    expect(after.draft.translations?.en?.name).toBe('Support');
    const [block] = await db
      .select()
      .from(schema.agentFunctionBlock)
      .where(eq(schema.agentFunctionBlock.code, 'comum'));
    expect(block!.draft.translations?.en?.fields?.['empresa.nome']?.label).toBe('Company name');
    expect(block!.content?.translations?.es?.fields?.['empresa.nome']?.label).toBe(
      'Nombre de la empresa',
    );
    // o publicado do template não mudou: o cliente só vê a tradução na próxima publicação
    expect(after.latestVersion).toBe(1);
    // o seed seguinte não repete
    expect(await seedAgentFunctions(db, catalog)).toEqual({
      blocks: 0,
      templates: 0,
      translated: 0,
    });
  });

  it('a versão do seed traz os blocos expandidos', async () => {
    const support = await catalog.latestPublished('SUPPORT', randomUUID());
    expect(support.content.fields[0]?.id).toBe('empresa.nome');
    expect(support.content.behavior).toContain('QUANDO NÃO SOUBER');
    expect(support.content.intentions.map((intention) => intention.key)).toEqual([
      'abrir_chamado',
      'registrar_duvida',
      'transferir_atendente',
    ]);
  });
});
