import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import {
  EXPIRY_BATCH_SIZE,
  TrainingExpiryJob,
} from '../../src/modules/training/training-expiry.job';
import { TrainingImageService } from '../../src/modules/training/training-image.service';
import { TrainingSyncService } from '../../src/modules/training/training-sync.service';
import { TrainingService } from '../../src/modules/training/training.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import type { ObjectStorage, PutObjectInput } from '../../src/shared/storage/object-storage';
import { testPool } from '../support/postgres';
import { WireMock } from '../support/wiremock';

const { agent, aiModel, tenant, training, trainingImage } = schema;
const REMOTE_AGENT = 'gm-agent-1';
const TRAININGS_PATH = `/v2/agent/${REMOTE_AGENT}/trainings`;
const REMOTE = (id: string) => `/v2/training/${id}`;
const HOUR = 3_600_000;

/** Storage em memória: o S3 real é coberto em object-storage.test.ts. */
class FakeStorage {
  readonly objects = new Map<string, PutObjectInput>();
  async put(input: PutObjectInput) {
    this.objects.set(input.key, input);
  }
  async presignedUrl(key: string) {
    return `https://storage.test/${key}`;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

// Expiração automática de treinamentos (spec training-expiration; design D2 e D3).
describe('job de expiração de treinamentos', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let storage: FakeStorage;
  let job: TrainingExpiryJob;
  let sync: TrainingSyncService;
  let modelId: string;
  let tenantId: string;
  let agentId: string;

  const ENV = {
    API_PUBLIC_URL: 'https://api.gptmaker.test',
    TRAINING_DEFAULT_MAX_TRAININGS: 1000,
    TRAINING_DEFAULT_MAX_STORAGE_MB: 50,
  } as Env;

  const past = (ms = HOUR) => new Date(Date.now() - ms);
  const future = (ms = HOUR) => new Date(Date.now() + ms);
  const stored = async (id: string) =>
    (await db.select().from(training).where(eq(training.id, id)))[0]!;

  async function newAgent(status: 'ACTIVE' | 'OUT_OF_SYNC' = 'ACTIVE') {
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
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner!.id,
        gptmakerAgentId: status === 'ACTIVE' ? REMOTE_AGENT : `gm-${randomUUID()}`,
        name: 'Atendente',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        status,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return { tenantId: owner!.id, agentId: row!.id };
  }

  /** Treinamento ativo vencido (por padrão há 1 hora), com id no GPTMaker. */
  async function due(remoteId: string | null, values: Partial<typeof training.$inferInsert> = {}) {
    const [row] = await db
      .insert(training)
      .values({
        tenantId,
        agentId,
        type: 'TEXT',
        content: `conteúdo ${remoteId ?? randomUUID()}`,
        gptmakerTrainingId: remoteId,
        status: 'DONE',
        expiresAt: past(),
        ...values,
      })
      .returning();
    return row!;
  }

  async function stubDelete(id: string, status = 200) {
    await wiremock.stub({
      request: { method: 'DELETE', urlPath: REMOTE(id) },
      response:
        status === 200
          ? { status, jsonBody: { success: true } }
          : { status, jsonBody: { error: 'falhou' } },
    });
  }

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
    storage = new FakeStorage();
    const objectStorage = storage as unknown as ObjectStorage;
    const service = new TrainingService(
      new AgentRepository(db),
      client,
      objectStorage,
      new TrainingImageService(objectStorage, db, redis, ENV),
      db,
      redis,
      ENV,
    );
    job = new TrainingExpiryJob(service, db, redis);
    sync = new TrainingSyncService(client, objectStorage, db, redis);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await redis.flushall();
    storage.objects.clear();
    await db.delete(training);
    await db.delete(trainingImage);
    await db.delete(agent);
    ({ tenantId, agentId } = await newAgent());
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  it('expira no prazo: apaga no GPTMaker, marca EXPIRED com expiredAt e limpa a mídia', async () => {
    await stubDelete('tr-doc');
    const key = `trainings/${tenantId}/doc.pdf`;
    await storage.put({
      key,
      body: Buffer.from('%PDF'),
      contentType: 'application/pdf',
      contentLength: 4,
      fileName: 'a.pdf',
    });
    const row = await due('tr-doc', {
      type: 'DOCUMENT',
      content: null,
      documentKey: key,
      documentName: 'a.pdf',
      status: 'FAILED',
      error: 'falhou antes',
    });
    const now = new Date();

    const summary = await job.run(now);

    expect(summary).toEqual({ due: 1, expired: 1, failed: 0 });
    expect(await wiremock.count('DELETE', REMOTE('tr-doc'))).toBe(1);
    expect(await stored(row.id)).toMatchObject({
      status: 'EXPIRED',
      expiredAt: now,
      error: null,
      documentKey: null,
      imageId: null,
      deletedAt: null,
    });
    expect(storage.objects.has(key)).toBe(false);
  });

  it('descarta também a imagem ligada ao treinamento', async () => {
    await stubDelete('tr-img');
    const [image] = await db
      .insert(trainingImage)
      .values({
        tenantId,
        agentId,
        objectKey: `trainings/${tenantId}/img.png`,
        mimetype: 'image/png',
        sizeBytes: 10,
        fileName: 'img.png',
      })
      .returning();
    const row = await due('tr-img', { imageId: image!.id });

    await job.run();

    expect((await stored(row.id)).imageId).toBeNull();
    const [after] = await db.select().from(trainingImage).where(eq(trainingImage.id, image!.id));
    expect(after!.deletedAt).toBeInstanceOf(Date);
  });

  it('ainda não vencido não expira', async () => {
    await stubDelete('tr-1');
    const row = await due('tr-1', { expiresAt: future() });

    expect(await job.run()).toEqual({ due: 0, expired: 0, failed: 0 });

    expect((await stored(row.id)).status).toBe('DONE');
    expect(await wiremock.count('DELETE', REMOTE('tr-1'))).toBe(0);
  });

  it('falha do GPTMaker mantém ativo e a execução seguinte conclui', async () => {
    await stubDelete('tr-1', 500);
    const row = await due('tr-1');

    expect(await job.run()).toEqual({ due: 1, expired: 0, failed: 1 });
    expect(await stored(row.id)).toMatchObject({ status: 'DONE', expiredAt: null });

    await wiremock.reset();
    await stubDelete('tr-1');
    expect(await job.run()).toEqual({ due: 1, expired: 1, failed: 0 });
    expect(await stored(row.id)).toMatchObject({ status: 'EXPIRED' });
  });

  it('NOT_FOUND no GPTMaker conta como sucesso', async () => {
    await stubDelete('tr-1', 404);
    const row = await due('tr-1');

    expect(await job.run()).toEqual({ due: 1, expired: 1, failed: 0 });
    expect((await stored(row.id)).status).toBe('EXPIRED');
  });

  it('sem id remoto e agente fora de sincronia: expira só aqui, sem chamar o GPTMaker', async () => {
    const orphan = await newAgent('OUT_OF_SYNC');
    const [row] = await db
      .insert(training)
      .values({
        tenantId: orphan.tenantId,
        agentId: orphan.agentId,
        type: 'TEXT',
        content: 'x',
        gptmakerTrainingId: 'tr-orfao',
        expiresAt: past(),
      })
      .returning();

    expect(await job.run()).toEqual({ due: 1, expired: 1, failed: 0 });

    expect((await stored(row!.id)).status).toBe('EXPIRED');
    expect(await wiremock.count('DELETE', REMOTE('tr-orfao'))).toBe(0);
  });

  it('item estendido (prazo no futuro) entre a seleção e a execução não expira', async () => {
    await stubDelete('tr-1');
    const row = await due('tr-1');
    // Usuário estende o prazo depois que o job selecionou o item.
    await db.update(training).set({ expiresAt: future() }).where(eq(training.id, row.id));

    const service = (job as unknown as { trainings: TrainingService }).trainings;
    expect(await service.expire({ id: row.id, tenantId, agentId })).toBe(false);

    expect(await stored(row.id)).toMatchObject({ status: 'DONE', expiredAt: null });
    expect(await wiremock.count('DELETE', REMOTE('tr-1'))).toBe(0);
    expect(await job.run()).toMatchObject({ due: 0 });
  });

  it('item removido pelo usuário não expira nem chama o GPTMaker', async () => {
    await stubDelete('tr-1');
    const row = await due('tr-1', { deletedAt: new Date() });

    expect(await job.run()).toEqual({ due: 0, expired: 0, failed: 0 });
    const service = (job as unknown as { trainings: TrainingService }).trainings;
    expect(await service.expire({ id: row.id, tenantId, agentId })).toBe(false);

    expect((await stored(row.id)).status).toBe('DONE');
    expect(await wiremock.count('DELETE', REMOTE('tr-1'))).toBe(0);
  });

  it('já expirado não é processado de novo', async () => {
    await stubDelete('tr-1');
    await due('tr-1', { status: 'EXPIRED', expiredAt: past(2 * HOUR) });
    expect(await job.run()).toEqual({ due: 0, expired: 0, failed: 0 });
    expect(await wiremock.count('DELETE', REMOTE('tr-1'))).toBe(0);
  });

  it.each(['PROCESSING', 'FAILED', 'DONE'] as const)(
    'treinamento %s também expira',
    async (status) => {
      await stubDelete('tr-1');
      const row = await due('tr-1', { status });
      expect(await job.run()).toMatchObject({ expired: 1 });
      expect((await stored(row.id)).status).toBe('EXPIRED');
    },
  );

  it('treinamento gerado pela função (managed) nunca expira', async () => {
    await stubDelete('tr-1');
    const row = await due('tr-1', { managed: true });

    expect(await job.run()).toEqual({ due: 0, expired: 0, failed: 0 });

    expect(await stored(row.id)).toMatchObject({ status: 'DONE', expiredAt: null });
    expect(await wiremock.count('DELETE', REMOTE('tr-1'))).toBe(0);
  });

  it('um item com falha não bloqueia os outros (inclusive de outros tenants)', async () => {
    const other = await newAgent('OUT_OF_SYNC');
    await db.update(agent).set({ status: 'ACTIVE' }).where(eq(agent.id, other.agentId));
    await stubDelete('tr-ruim', 500);
    await stubDelete('tr-bom');
    await stubDelete('tr-outro');
    const bad = await due('tr-ruim', { expiresAt: past(3 * HOUR) });
    const good = await due('tr-bom', { expiresAt: past(2 * HOUR) });
    const [alheio] = await db
      .insert(training)
      .values({
        tenantId: other.tenantId,
        agentId: other.agentId,
        type: 'TEXT',
        content: 'outro tenant',
        gptmakerTrainingId: 'tr-outro',
        expiresAt: past(),
      })
      .returning();

    expect(await job.run()).toEqual({ due: 3, expired: 2, failed: 1 });

    expect((await stored(bad.id)).status).toBe('DONE');
    expect((await stored(good.id)).status).toBe('EXPIRED');
    expect((await stored(alheio!.id)).status).toBe('EXPIRED');
  });

  it(`lote de ${EXPIRY_BATCH_SIZE}: o resto fica para a execução seguinte, do mais antigo ao mais novo`, async () => {
    expect(EXPIRY_BATCH_SIZE).toBe(50);
    const total = EXPIRY_BATCH_SIZE + 5;
    for (let n = 0; n < total; n++) await stubDelete(`tr-${n}`);
    // tr-0 é o mais antigo (vencido há mais tempo).
    const ids: string[] = [];
    for (let n = 0; n < total; n++) {
      ids.push((await due(`tr-${n}`, { expiresAt: past((total - n) * 60_000 + HOUR) })).id);
    }

    expect(await job.run()).toEqual({ due: 50, expired: 50, failed: 0 });
    const afterFirst = await Promise.all(ids.map(stored));
    expect(afterFirst.filter((row) => row.status === 'EXPIRED')).toHaveLength(50);
    expect(afterFirst.slice(0, 50).every((row) => row.status === 'EXPIRED')).toBe(true);
    expect(afterFirst.slice(50).every((row) => row.status === 'DONE')).toBe(true);

    expect(await job.run()).toEqual({ due: 5, expired: 5, failed: 0 });
    expect((await Promise.all(ids.map(stored))).every((row) => row.status === 'EXPIRED')).toBe(
      true,
    );
  });

  describe('sincronização depois de expirar', () => {
    it('mantém EXPIRED, sem criar nem soft-deletar, mesmo sem o item no GPTMaker', async () => {
      await stubDelete('tr-1');
      const row = await due('tr-1', { createdAt: past(48 * HOUR) });
      await job.run();
      const empty = async (type: string) =>
        wiremock.stub({
          request: {
            method: 'GET',
            urlPath: TRAININGS_PATH,
            queryParameters: { type: { equalTo: type } },
          },
          response: { status: 200, jsonBody: [] },
        });
      for (const type of ['TEXT', 'WEBSITE', 'VIDEO', 'DOCUMENT']) await empty(type);

      const owner = { id: agentId, tenantId, gptmakerAgentId: REMOTE_AGENT };
      // Duas rodadas: a segunda é a que confirmaria "sumiu" para um item ativo.
      const first = await sync.syncAgent(owner, new Date());
      const second = await sync.syncAgent(owner, new Date());

      for (const result of [first, second]) {
        expect(result).toEqual({ linked: 0, imported: 0, updated: 0, removed: 0, lost: 0 });
      }
      expect(await stored(row.id)).toMatchObject({ status: 'EXPIRED', deletedAt: null });
      expect(await db.select().from(training)).toHaveLength(1);
    });

    it('se o GPTMaker ainda devolver o id expirado, não é reimportado', async () => {
      await stubDelete('tr-1');
      const row = await due('tr-1');
      await job.run();
      await wiremock.stub({
        request: {
          method: 'GET',
          urlPath: TRAININGS_PATH,
          queryParameters: { type: { equalTo: 'TEXT' } },
        },
        response: { status: 200, jsonBody: [{ id: 'tr-1', type: 'TEXT', text: row.content }] },
      });
      for (const type of ['WEBSITE', 'VIDEO', 'DOCUMENT']) {
        await wiremock.stub({
          request: {
            method: 'GET',
            urlPath: TRAININGS_PATH,
            queryParameters: { type: { equalTo: type } },
          },
          response: { status: 200, jsonBody: [] },
        });
      }

      const result = await sync.syncAgent({
        id: agentId,
        tenantId,
        gptmakerAgentId: REMOTE_AGENT,
      });

      expect(result).toEqual({ linked: 0, imported: 0, updated: 0, removed: 0, lost: 0 });
      expect(await stored(row.id)).toMatchObject({ status: 'EXPIRED', content: row.content });
      expect(await db.select().from(training)).toHaveLength(1);
    });
  });
});
