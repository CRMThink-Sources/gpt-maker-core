import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { TrainingSyncService } from '../../src/modules/training/training-sync.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import type { ObjectStorage } from '../../src/shared/storage/object-storage';
import { WireMock } from '../support/wiremock';
import { testPool } from '../support/postgres';

const { agent, aiModel, tenant, training } = schema;
const REMOTE_AGENT = 'gm-agent-1';
const TRAININGS_PATH = `/v2/agent/${REMOTE_AGENT}/trainings`;
const HOUR = 60 * 60_000;
type Remote = Record<string, unknown> & { id: string };
type RemoteByType = Partial<Record<'TEXT' | 'WEBSITE' | 'VIDEO' | 'DOCUMENT', Remote[]>>;

describe('sincronização dos treinamentos com o GPTMaker', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let deleted: string[];
  let sync: TrainingSyncService;
  let modelId: string;
  let tenantId: string;
  let agentId: string;

  const later = (ms: number) => new Date(Date.now() + ms);

  /** Listagem do GPTMaker por tipo; tipo ausente lista vazio. */
  async function stubRemote(byType: RemoteByType, failing?: string) {
    await wiremock.reset();
    for (const type of ['TEXT', 'WEBSITE', 'VIDEO', 'DOCUMENT'] as const) {
      await wiremock.stub({
        request: {
          method: 'GET',
          urlPath: TRAININGS_PATH,
          queryParameters: { type: { equalTo: type } },
        },
        response:
          failing === type
            ? { status: 500, jsonBody: { error: 'falhou' } }
            : {
                status: 200,
                jsonBody: (byType[type] ?? []).map((item) => ({ type, ...item })),
              },
      });
    }
  }

  async function local(values: Partial<typeof training.$inferInsert> = {}) {
    const [row] = await db
      .insert(training)
      .values({ tenantId, agentId, type: 'TEXT', content: 'Trocas em 7 dias', ...values })
      .returning();
    return row!;
  }

  const stored = async (id: string) =>
    (await db.select().from(training).where(eq(training.id, id)))[0]!;
  const alive = () =>
    db
      .select()
      .from(training)
      .then((rows) => rows.filter((row) => !row.deletedAt));

  beforeAll(async () => {
    [postgres, redisContainer, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      WireMock.start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const client = new GptMakerClient(
      {
        baseUrl: `${wiremock.baseUrl}/v2`,
        token: 't',
        workspaceId: 'ws',
        timeoutMs: 5000,
        conversationTimeoutMs: 5000,
      },
      new GptMakerResilience({
        maxAttempts: 1,
        breakerThreshold: 50,
        halfOpenAfterMs: 1000,
        beforeAttempt: async () => {},
      }),
    );
    const storage = {
      delete: async (key: string) => {
        deleted.push(key);
      },
    };
    sync = new TrainingSyncService(client, storage as unknown as ObjectStorage, db, redis);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await redis.flushall();
    deleted = [];
    await db.delete(training);
    await db.delete(agent);
    const code = randomBytes(3).toString('hex');
    const [owner] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    tenantId = owner!.id;
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: REMOTE_AGENT,
        name: 'Atendente',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    agentId = row!.id;
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  it('completa o id pelo conteúdo e, sem casar, pelo par único do tipo', async () => {
    const text = await local();
    const site = await local({ type: 'WEBSITE', content: null, url: 'https://loja.com.br/' });
    await stubRemote({
      TEXT: [{ id: 'tr-text', text: 'Trocas em 7 dias' }],
      // Normalizada lá: não casa pela URL, mas é o único novo do tipo.
      WEBSITE: [{ id: 'tr-site', website: 'https://www.loja.com.br' }],
    });

    const summary = await sync.syncAll();

    expect(summary).toMatchObject({ agents: 1, linked: 2, imported: 0 });
    expect((await stored(text.id)).gptmakerTrainingId).toBe('tr-text');
    expect((await stored(site.id)).gptmakerTrainingId).toBe('tr-site');
  });

  it('importa como DONE o que só existe no GPTMaker, uma vez só', async () => {
    await stubRemote({
      TEXT: [{ id: 'tr-1', text: ' Horário: 8h às 18h ' }],
      WEBSITE: [
        {
          id: 'tr-2',
          website: 'https://loja.com.br',
          trainingSubPages: 'ACTIVE',
          trainingInterval: 'ONE_WEEK',
        },
      ],
      DOCUMENT: [{ id: 'tr-3', documentName: 'manual.pdf', documentMimetype: 'application/pdf' }],
    });

    expect((await sync.syncAll()).imported).toBe(3);
    expect((await sync.syncAll()).imported).toBe(0);

    const rows = await alive();
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.type === 'TEXT')).toMatchObject({
      content: 'Horário: 8h às 18h',
      status: 'DONE',
      tenantId,
    });
    expect(rows.find((row) => row.type === 'WEBSITE')).toMatchObject({
      trainingSubPages: true,
      trainingInterval: 'ONE_WEEK',
    });
    expect(rows.find((row) => row.type === 'DOCUMENT')).toMatchObject({
      documentName: 'manual.pdf',
      documentKey: null,
    });
  });

  it('o conteúdo do GPTMaker vale sobre o local', async () => {
    const text = await local({ gptmakerTrainingId: 'tr-1' });
    const site = await local({
      type: 'WEBSITE',
      content: null,
      url: 'https://loja.com.br',
      trainingSubPages: false,
      trainingInterval: 'NEVER',
      gptmakerTrainingId: 'tr-2',
    });
    await stubRemote({
      TEXT: [{ id: 'tr-1', text: 'Trocas em 30 dias' }],
      WEBSITE: [
        {
          id: 'tr-2',
          website: 'https://loja.com.br/',
          trainingSubPages: 'ACTIVE',
          trainingInterval: 'ONE_DAY',
        },
      ],
    });

    expect((await sync.syncAll()).updated).toBe(2);
    expect((await stored(text.id)).content).toBe('Trocas em 30 dias');
    // Barra final não é divergência.
    expect(await stored(site.id)).toMatchObject({
      url: 'https://loja.com.br',
      trainingSubPages: true,
      trainingInterval: 'ONE_DAY',
    });
  });

  it('ausente no GPTMaker: remove só na segunda sync seguida, com o documento', async () => {
    const row = await local({
      type: 'DOCUMENT',
      content: null,
      gptmakerTrainingId: 'tr-doc',
      documentKey: 'trainings/x/doc.pdf',
      documentName: 'doc.pdf',
    });
    await stubRemote({});

    expect((await sync.syncAll(later(HOUR))).removed).toBe(0);
    expect((await stored(row.id)).deletedAt).toBeNull();

    expect((await sync.syncAll(later(2 * HOUR))).removed).toBe(1);
    expect((await stored(row.id)).deletedAt).toBeInstanceOf(Date);
    expect(deleted).toEqual(['trainings/x/doc.pdf']);
  });

  it('reaparecer zera a contagem de ausência', async () => {
    const row = await local({ gptmakerTrainingId: 'tr-1' });
    await stubRemote({});
    await sync.syncAll(later(HOUR));
    await stubRemote({ TEXT: [{ id: 'tr-1', text: 'Trocas em 7 dias' }] });
    await sync.syncAll(later(HOUR));
    await stubRemote({});

    await sync.syncAll(later(2 * HOUR));
    expect((await stored(row.id)).deletedAt).toBeNull();
  });

  it('recém-criado não é removido nem dado como perdido', async () => {
    const withId = await local({ gptmakerTrainingId: 'tr-1' });
    const withoutId = await local({ content: 'outro' });
    await stubRemote({});

    await sync.syncAll();
    await sync.syncAll();

    expect((await stored(withId.id)).deletedAt).toBeNull();
    expect((await stored(withoutId.id)).status).toBe('PROCESSING');
  });

  it('sem id e sem correspondente depois de 1 h: FAILED para o usuário reenviar', async () => {
    const row = await local();
    await stubRemote({});

    expect((await sync.syncAll(later(2 * HOUR))).lost).toBe(1);
    expect(await stored(row.id)).toMatchObject({
      status: 'FAILED',
      error: expect.stringContaining('não apareceu no GPTMaker'),
    });
  });

  it('falha ao listar um tipo: nada muda no agente', async () => {
    const row = await local({ gptmakerTrainingId: 'tr-1' });
    await stubRemote({ TEXT: [] }, 'VIDEO');
    await redis.set(`training-missing:${row.id}`, '1');

    const summary = await sync.syncAll(later(2 * HOUR));

    expect(summary).toMatchObject({ agentsFailed: 1, removed: 0 });
    expect((await stored(row.id)).deletedAt).toBeNull();
  });

  it('agente com treinamento em andamento fica para a próxima rodada', async () => {
    await stubRemote({ TEXT: [{ id: 'tr-1', text: 'x' }] });
    await redis.set(`lock:training:${agentId}`, 'outro', 'PX', 60_000);

    expect(await sync.syncAll()).toMatchObject({ agentsSkipped: 1, imported: 0 });
  });

  it('ignora agentes removidos e fora de sincronia', async () => {
    await db.update(agent).set({ status: 'OUT_OF_SYNC' }).where(eq(agent.id, agentId));
    await stubRemote({ TEXT: [{ id: 'tr-1', text: 'x' }] });

    expect(await sync.syncAll()).toMatchObject({ agents: 0, imported: 0 });
  });
});
