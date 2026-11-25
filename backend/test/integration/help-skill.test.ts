import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { strFromU8, unzipSync } from 'fflate';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../../src/config/config.module';
import { FunctionCatalog } from '../../src/modules/agent-functions/function-catalog.service';
import { seedAgentFunctions } from '../../src/modules/agent-functions/function-seed';
import { HelpSkillController } from '../../src/modules/help-skill/help-skill.controller';
import { HelpSkillService } from '../../src/modules/help-skill/help-skill.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agentFunctionTemplate, agentFunctionTemplateTenant, tenant } = schema;

// Rotas públicas da skill de ajuda (spec customer-help-skill).
describe('skill de ajuda do cliente', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let catalog: FunctionCatalog;
  let app: INestApplication;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    catalog = new FunctionCatalog(db);
    await seedAgentFunctions(db, catalog);

    const moduleRef = await Test.createTestingModule({
      controllers: [HelpSkillController],
      providers: [
        HelpSkillService,
        { provide: FunctionCatalog, useValue: catalog },
        { provide: ENV, useValue: { API_PUBLIC_URL: 'https://api.exemplo.com' } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await postgres?.stop();
  });

  const content = () => request(app.getHttpServer()).get('/public/help-skill/content');

  async function templateId(code: string): Promise<string> {
    const [row] = await db
      .select({ id: agentFunctionTemplate.id })
      .from(agentFunctionTemplate)
      .where(eq(agentFunctionTemplate.code, code));
    return row!.id;
  }

  it('entrega sem sessão o guia e as funções publicadas, com cache curto', async () => {
    const response = await content().expect(200);
    expect(response.headers['content-type']).toContain('text/markdown');
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.text).toContain('Conteúdo gerado em ');
    expect(response.text).toContain('## Criar um agente');
    expect(response.text).toContain('### Suporte');
    expect(response.text).toContain('Nome da empresa');
  });

  it('deixa de fora função restrita, inativa, excluída e nunca publicada', async () => {
    const tenantId = randomUUID();
    await db.insert(tenant).values({
      id: tenantId,
      installationId: 'i-1',
      memberId: 'm-1',
      domain: 'a.bitrix24.com.br',
      tenantCode: 'a',
    });
    await db
      .insert(agentFunctionTemplateTenant)
      .values({ templateId: await templateId('SDR'), tenantId });
    await catalog.setActive('SCHEDULING', false);
    await catalog.remove('POST_SALES');
    await catalog.createTemplate({
      code: 'RASCUNHO',
      name: 'Função em rascunho',
      description: 'Ainda não publicada',
      copyFrom: 'SUPPORT',
    });

    const { text } = await content().expect(200);
    expect(text).toContain('### Suporte');
    expect(text).not.toContain('### SDR');
    expect(text).not.toContain('### Agendamento');
    expect(text).not.toContain('### Pós-venda');
    expect(text).not.toContain('Função em rascunho');
  });

  it('baixa o .zip como anexo, com a cópia do conteúdo e a URL do ambiente', async () => {
    const response = await request(app.getHttpServer())
      .get('/public/help-skill/download')
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="gptthink-ajuda.zip"',
    );
    const files = unzipSync(new Uint8Array(response.body as Buffer));
    expect(strFromU8(files['gptthink-ajuda/SKILL.md']!)).toContain(
      'https://api.exemplo.com/public/help-skill/content',
    );
    expect(strFromU8(files['gptthink-ajuda/referencia/conteudo.md']!)).toContain('### Suporte');
  });
});
