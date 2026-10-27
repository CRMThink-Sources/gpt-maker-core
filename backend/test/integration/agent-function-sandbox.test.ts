import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { FunctionCatalog } from '../../src/modules/agent-functions/function-catalog.service';
import {
  FunctionSandbox,
  SandboxIntentionController,
} from '../../src/modules/agent-functions/function-sandbox';
import { seedAgentFunctions } from '../../src/modules/agent-functions/function-seed';
import type { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { WorkspaceSyncService } from '../../src/modules/gptmaker/workspace-sync.service';
import { ModelCatalogService } from '../../src/modules/models/model-catalog.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { FakeGptMaker } from '../support/fake-gptmaker';

const { agent, aiModel, workspaceReservedAgent } = schema;

const ANSWERS = {
  'empresa.nome': 'Loja X',
  'empresa.descricao': 'Roupas femininas.',
  'comum.tom': 'normal',
  'comum.emojis': 'nao',
  'registro.onde': 'conversa',
  'duvida.depois': 'retorno',
  'suporte.identificacao': ['nome'],
  'suporte.escalonamento': 'transferir',
  'suporte.insatisfeito': 'tentar',
  'suporte.vendas': 'transferir',
  'base.faq': [
    {
      itemKey: '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b',
      values: { pergunta: 'Qual o prazo de entrega?', resposta: 'Até 5 dias úteis.' },
    },
  ],
};

// Agente de sandbox dos templates (spec agent-function-templates, "Teste em sandbox"; 3.3).
describe('sandbox dos templates de função', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  const fake = new FakeGptMaker();
  let sandbox: FunctionSandbox;
  let sync: WorkspaceSyncService;

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
    const client = fake as unknown as GptMakerClient;
    const catalog = new FunctionCatalog(db);
    sandbox = new FunctionSandbox(catalog, client, new ModelCatalogService(db, client), db, {
      API_PUBLIC_URL: 'https://api.test',
    } as Env);
    sync = new WorkspaceSyncService(client, db, redis);
    await db.insert(aiModel).values({
      code: 'GPT_5_MINI',
      displayName: 'GPT-5 Mini',
      creditsPerResponse: 1,
      isDefault: true,
    });
    await seedAgentFunctions(db, catalog);
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('cria o agente reservado, aplica a prévia e substitui tudo na seguinte', async () => {
    const first = await sandbox.publish('SUPPORT', { answers: ANSWERS, agentName: 'Ana' });

    const [reserved] = await db.select().from(workspaceReservedAgent);
    expect(reserved).toMatchObject({
      gptmakerAgentId: first.gptmakerAgentId,
      purpose: 'function-sandbox',
    });
    const remote = fake.agents.get(first.gptmakerAgentId)!;
    expect((remote.profile as { behavior: string }).behavior).toBe(first.compiled.behavior);
    expect(remote.settings).toMatchObject({ prefferModel: 'GPT_5_MINI', limitSubjects: true });
    expect([...fake.trainings.values()].map((item) => item.text)).toEqual([
      'Pergunta: Qual o prazo de entrega?\nResposta: Até 5 dias úteis.',
    ]);
    const intentions = [...fake.intentions.values()];
    expect(intentions.map((item) => item.description).sort()).toEqual([
      'Registrar dúvida',
      'Transferir para atendente',
    ]);
    expect((intentions[0]!.body as { url: string }).url).toMatch(
      /^https:\/\/api\.test\/gptmaker\/sandbox-intentions\//,
    );

    const second = await sandbox.publish('SUPPORT', { answers: ANSWERS, agentName: 'Ana' });
    expect(second.gptmakerAgentId).toBe(first.gptmakerAgentId);
    expect(fake.trainings.size).toBe(1);
    expect(fake.intentions.size).toBe(2);
    expect(fake.count('agent.create')).toBe(1);
    // Nenhum agente de tenant envolvido.
    expect(await db.select().from(agent)).toEqual([]);
  });

  it('a sincronização do workspace não aponta o sandbox como órfão', async () => {
    const summary = await sync.sync();
    expect(summary.remoteAgents).toBe(1);
    expect(summary.orphansFound).toBe(0);
  });

  it('o endpoint das intenções só simula a ação', () => {
    const reply = new SandboxIntentionController().run('registrar_duvida', {
      fields: { pergunta: 'Tem loja física?' },
    });
    expect(reply).toEqual({
      ok: true,
      message:
        'Ação "registrar_duvida" simulada no sandbox. Campos recebidos: {"pergunta":"Tem loja física?"}',
      results: [],
    });
  });
});
