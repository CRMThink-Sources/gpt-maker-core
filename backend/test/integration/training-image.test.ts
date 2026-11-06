import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
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
import { TrainingImageService } from '../../src/modules/training/training-image.service';
import { TrainingService } from '../../src/modules/training/training.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import type { ObjectStorage, PutObjectInput } from '../../src/shared/storage/object-storage';
import { testPool } from '../support/postgres';
import { WireMock } from '../support/wiremock';

const {
  agent,
  agentFunctionConfig,
  aiModel,
  planEntitlement,
  subscriptionState,
  tenant,
  training,
  trainingImage,
} = schema;
const API = 'https://api.gptmaker.test';
const REMOTE_AGENT = 'gm-agent-img';
const TRAININGS_PATH = `/v2/agent/${REMOTE_AGENT}/trainings`;
const TRAINING_PATH = (id: string) => `/v2/training/${id}`;
const MB = 1024 * 1024;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2048, 1),
]);

class FakeStorage {
  readonly objects = new Map<string, PutObjectInput>();
  failDelete = false;
  newTrainingKey(tenantId: string, fileName: string) {
    return `trainings/${tenantId}/${randomUUID()}.${fileName.split('.').pop()}`;
  }
  async put(input: PutObjectInput) {
    this.objects.set(input.key, input);
  }
  async presignedUrl(key: string) {
    return `https://storage.test/${key}?X-Amz-Signature=abc`;
  }
  async getObject(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error('não encontrado');
    return {
      body: Readable.from([object.body as Buffer]),
      contentLength: (object.body as Buffer).length,
    };
  }
  async delete(key: string) {
    if (this.failDelete) throw new Error('storage fora');
    this.objects.delete(key);
  }
}

// Imagem em treinamento de texto (spec agent-training-image; tarefas 3.1, 3.2, 4.1 e 4.2).
describe('imagens de treinamento de texto', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let storage: FakeStorage;
  let images: TrainingImageService;
  let service: TrainingService;
  let modelId: string;
  let tenantId: string;
  let agentId: string;
  const ENV = {
    API_PUBLIC_URL: API,
    TRAINING_DEFAULT_MAX_TRAININGS: 10,
    TRAINING_DEFAULT_MAX_STORAGE_MB: 50,
  } as Env;

  const errorOf = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);
  const upload = (body: Buffer = PNG, name = 'tabela.png', id = agentId, tenant = tenantId) =>
    service.uploadImage(tenant, id, { originalname: name, buffer: body });
  const stored = async (id: string) =>
    (await db.select().from(training).where(eq(training.id, id)))[0]!;
  const imageRow = async (id: string) =>
    (await db.select().from(trainingImage).where(eq(trainingImage.id, id)))[0]!;

  async function newTenantAgent() {
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
        gptmakerAgentId: REMOTE_AGENT,
        name: 'Atendente',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return { tenantId: owner!.id, agentId: row!.id };
  }

  async function stubCreate() {
    await wiremock.stub({
      request: { method: 'POST', urlPath: TRAININGS_PATH },
      response: { status: 200, jsonBody: { success: true } },
    });
  }

  async function stubPut(id: string, status = 200) {
    await wiremock.stub({
      request: { method: 'PUT', urlPath: TRAINING_PATH(id) },
      response: { status, jsonBody: status === 200 ? { success: true } : { error: 'falhou' } },
    });
  }

  async function stubList(items: Array<Record<string, unknown>>) {
    await wiremock.stub({
      request: {
        method: 'GET',
        urlPath: TRAININGS_PATH,
        queryParameters: { type: { equalTo: 'TEXT' } },
      },
      response: { status: 200, jsonBody: items.map((item) => ({ type: 'TEXT', ...item })) },
    });
  }

  const bodies = (method: string, path: string) =>
    wiremock.bodies(method, path) as Promise<Array<Record<string, unknown>>>;

  /** Treinamento de texto já criado, com imagem. */
  async function withImage(values: Partial<typeof training.$inferInsert> = {}) {
    const image = await upload();
    const [row] = await db
      .insert(training)
      .values({
        tenantId,
        agentId,
        type: 'TEXT',
        content: 'Tabela de preços',
        gptmakerTrainingId: 'tr-1',
        status: 'DONE',
        imageId: image.id,
        ...values,
      })
      .returning();
    return { row: row!, image };
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
        workspaceId: 'ws-test',
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
    images = new TrainingImageService(storage as unknown as ObjectStorage, db, redis, ENV);
    service = new TrainingService(
      new AgentRepository(db),
      client,
      storage as unknown as ObjectStorage,
      images,
      db,
      redis,
      ENV,
    );
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
    storage.failDelete = false;
    await db.delete(training);
    await db.delete(trainingImage);
    await db.delete(agentFunctionConfig);
    await db.delete(agent);
    await db.delete(subscriptionState);
    await db.delete(planEntitlement);
    ({ tenantId, agentId } = await newTenantAgent());
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  describe('upload', () => {
    it('guarda o arquivo privado e a linha, e devolve o id e a miniatura', async () => {
      const result = await upload();
      expect(result).toMatchObject({
        mimetype: 'image/png',
        sizeBytes: PNG.length,
        fileName: 'tabela.png',
      });
      const stable = `${API}/public/training-images/${(await imageRow(result.id)).publicToken}`;
      expect(result.url).toBe(stable);
      const row = await imageRow(result.id);
      expect(row).toMatchObject({ tenantId, agentId, deletedAt: null });
      expect(storage.objects.get(row.objectKey)).toMatchObject({ contentType: 'image/png' });
    });

    it('recusa PDF e arquivo .png com outro conteúdo', async () => {
      const pdf = await errorOf(upload(Buffer.from('%PDF-1.7 conteúdo'), 'a.pdf'));
      expect(pdf).toMatchObject({ code: 'TRAINING_IMAGE_INVALID_TYPE' });
      const fake = await errorOf(upload(Buffer.from('não sou imagem'), 'foto.png'));
      expect(fake).toMatchObject({ code: 'TRAINING_IMAGE_INVALID_TYPE' });
      expect(storage.objects.size).toBe(0);
    });

    it('recusa imagem acima de 5 MB e envio vazio', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(5 * MB)]);
      expect(await errorOf(upload(big))).toMatchObject({ code: 'TRAINING_IMAGE_TOO_LARGE' });
      expect(await errorOf(service.uploadImage(tenantId, agentId, undefined))).toMatchObject({
        code: 'TRAINING_IMAGE_INVALID',
      });
    });

    it('agente de outro tenant: como se não existisse', async () => {
      const other = await newTenantAgent().catch(() => null);
      // O segundo agente reusa o id do GPTMaker (único): outro tenant é simulado pelo tenantId.
      expect(other).toBeNull();
      const error = await errorOf(upload(PNG, 'a.png', agentId, randomUUID()));
      expect(error).toMatchObject({ code: 'AGENT_NOT_FOUND' });
    });
  });

  describe('cota do plano', () => {
    async function onPlan(maxDocumentStorageMb: number | null) {
      const planSpaId = `plan-${randomUUID()}`;
      await db.insert(planEntitlement).values({
        planSpaId,
        planType: 'subscription',
        creditsPerCycle: 1000,
        maxTrainings: null,
        maxDocumentStorageMb,
      });
      await db.insert(subscriptionState).values({
        tenantId,
        subscriptionId: `sub-${randomUUID()}`,
        status: 'active',
        modality: 'stripe',
        planId: planSpaId,
        version: 1,
      });
    }
    const png = (bytes: number) => Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(bytes)]);

    it('recusa o envio que ultrapassa a cota e informa o limite', async () => {
      await onPlan(1);
      await upload(png(600 * 1024));
      const error = await errorOf(upload(png(600 * 1024)));
      expect(error).toMatchObject({ code: 'PLAN_TRAINING_LIMIT' });
      expect(storage.objects.size).toBe(1);
    });

    it('plano sem limite aceita', async () => {
      await onPlan(null);
      await upload(png(3 * MB));
      await upload(png(3 * MB));
      expect((await service.usage(tenantId)).documentBytes.used).toBeGreaterThan(6 * MB);
    });

    it('remover o treinamento libera o espaço', async () => {
      await onPlan(10);
      await stubPut('tr-1');
      await wiremock.stub({
        request: { method: 'DELETE', urlPath: TRAINING_PATH('tr-1') },
        response: { status: 200, jsonBody: { success: true } },
      });
      const { row, image } = await withImage();
      const before = (await service.usage(tenantId)).documentBytes.used;
      expect(before).toBe(image.sizeBytes);
      await service.remove(tenantId, agentId, row.id);
      expect((await service.usage(tenantId)).documentBytes.used).toBe(0);
    });
  });

  describe('treinamento de texto com imagem', () => {
    it('cria com texto e imagem juntos e mostra a miniatura', async () => {
      await stubCreate();
      await stubList([{ id: 'tr-new', text: 'Tabela de preços' }]);
      const image = await upload();

      const view = await service.create(tenantId, agentId, {
        type: 'TEXT',
        text: 'Tabela de preços',
        imageId: image.id,
      });

      const [body] = await bodies('POST', TRAININGS_PATH);
      expect(body).toMatchObject({ type: 'TEXT', text: 'Tabela de preços' });
      expect(String(body!.image)).toBe(
        `${API}/public/training-images/${(await imageRow(image.id)).publicToken}`,
      );
      expect(view.image).toMatchObject({ id: image.id, mimetype: 'image/png' });
      expect((await stored(view.id)).imageId).toBe(image.id);
    });

    it('sem imagem cria só com o texto, como antes', async () => {
      await stubCreate();
      await stubList([{ id: 'tr-new', text: 'Só texto' }]);
      const view = await service.create(tenantId, agentId, { type: 'TEXT', text: 'Só texto' });
      const [body] = await bodies('POST', TRAININGS_PATH);
      expect(body).not.toHaveProperty('image');
      expect(view.image).toBeNull();
    });

    it('imagem inexistente, de outro agente ou já em uso: recusa', async () => {
      await stubCreate();
      expect(
        await errorOf(
          service.create(tenantId, agentId, { type: 'TEXT', text: 'x', imageId: randomUUID() }),
        ),
      ).toMatchObject({ code: 'TRAINING_IMAGE_NOT_FOUND' });

      const { image } = await withImage();
      expect(
        await errorOf(
          service.create(tenantId, agentId, { type: 'TEXT', text: 'y', imageId: image.id }),
        ),
      ).toMatchObject({ code: 'TRAINING_IMAGE_IN_USE' });
      expect(await wiremock.count('POST', TRAININGS_PATH)).toBe(0);
    });

    it('GPTMaker recusa: nada criado e a imagem continua para nova tentativa', async () => {
      await wiremock.stub({
        request: { method: 'POST', urlPath: TRAININGS_PATH },
        response: { status: 422, jsonBody: { error: 'recusado' } },
      });
      const image = await upload();
      const error = await errorOf(
        service.create(tenantId, agentId, { type: 'TEXT', text: 'x', imageId: image.id }),
      );
      expect(error).toMatchObject({ code: 'GPTMAKER_REJECTED' });
      expect(await db.select().from(training)).toHaveLength(0);
      expect((await imageRow(image.id)).deletedAt).toBeNull();
      expect(storage.objects.size).toBe(1);
    });

    it('troca a imagem sem mudar o texto e apaga a anterior', async () => {
      await stubPut('tr-1');
      const { row, image: oldImage } = await withImage();
      const next = await upload(PNG, 'nova.png');
      const oldKey = (await imageRow(oldImage.id)).objectKey;

      const view = await service.updateText(tenantId, agentId, row.id, { imageId: next.id });

      const [body] = await bodies('PUT', TRAINING_PATH('tr-1'));
      expect(body).toMatchObject({ type: 'TEXT', text: 'Tabela de preços' });
      expect(String(body!.image)).toContain((await imageRow(next.id)).publicToken);
      expect(view.image?.id).toBe(next.id);
      expect((await imageRow(oldImage.id)).deletedAt).toBeInstanceOf(Date);
      expect(storage.objects.has(oldKey)).toBe(false);
    });

    it('remove a imagem: GPTMaker recebe image nulo e o arquivo sai do storage', async () => {
      await stubPut('tr-1');
      const { row, image } = await withImage();
      const key = (await imageRow(image.id)).objectKey;

      const view = await service.updateText(tenantId, agentId, row.id, { imageId: null });

      const [body] = await bodies('PUT', TRAINING_PATH('tr-1'));
      expect(body).toEqual({ type: 'TEXT', text: 'Tabela de preços', image: null });
      expect(view.image).toBeNull();
      expect((await stored(row.id)).imageId).toBeNull();
      expect(storage.objects.has(key)).toBe(false);
    });

    it('muda só o texto: reenvia a imagem atual junto', async () => {
      await stubPut('tr-1');
      const { row, image } = await withImage();
      await service.updateText(tenantId, agentId, row.id, { text: 'Tabela 2027' });
      const [body] = await bodies('PUT', TRAINING_PATH('tr-1'));
      expect(String(body!.image)).toContain((await imageRow(image.id)).publicToken);
      expect((await stored(row.id)).imageId).toBe(image.id);
    });

    it('falha no GPTMaker ao editar: treinamento e arquivos ficam como estavam', async () => {
      await stubPut('tr-1', 500);
      const { row, image } = await withImage();
      const next = await upload(PNG, 'nova.png');

      const error = await errorOf(
        service.updateText(tenantId, agentId, row.id, { imageId: next.id }),
      );

      expect(error).toMatchObject({ code: 'GPTMAKER_UNAVAILABLE' });
      expect((await stored(row.id)).imageId).toBe(image.id);
      expect((await imageRow(image.id)).deletedAt).toBeNull();
      expect(storage.objects.size).toBe(2);
    });

    it('reenvio após falha usa o mesmo texto e a mesma imagem, com URL nova', async () => {
      await stubCreate();
      await stubList([{ id: 'tr-novo', text: 'Tabela de preços' }]);
      await wiremock.stub({
        request: { method: 'DELETE', urlPath: TRAINING_PATH('tr-1') },
        response: { status: 200, jsonBody: { success: true } },
      });
      const { row, image } = await withImage({ status: 'FAILED', error: 'falhou' });

      await service.retry(tenantId, agentId, row.id);

      const [body] = await bodies('POST', TRAININGS_PATH);
      expect(body).toMatchObject({ type: 'TEXT', text: 'Tabela de preços' });
      expect(String(body!.image)).toContain((await imageRow(image.id)).publicToken);
    });

    it('remover o treinamento apaga a imagem; falha do storage não falha a remoção', async () => {
      await wiremock.stub({
        request: { method: 'DELETE', urlPath: TRAINING_PATH('tr-1') },
        response: { status: 200, jsonBody: { success: true } },
      });
      const { row, image } = await withImage();
      storage.failDelete = true;

      await service.remove(tenantId, agentId, row.id);

      expect((await stored(row.id)).deletedAt).toBeInstanceOf(Date);
      expect((await imageRow(image.id)).deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('URL pública estável', () => {
    it('entrega o arquivo pelo token e deixa de entregar quando a imagem é removida', async () => {
      const image = await upload();
      const token = (await imageRow(image.id)).publicToken;
      expect(token.length).toBeGreaterThanOrEqual(32);

      const served = await images.readPublic(token);
      expect(served).toMatchObject({ mimetype: 'image/png', contentLength: PNG.length });
      expect(await images.readPublic('token-que-nao-existe')).toBeNull();

      await images.discard(image.id);
      expect(await images.readPublic(token)).toBeNull();
    });

    it('cada imagem tem o seu token', async () => {
      const [a, b] = [await upload(), await upload()];
      expect((await imageRow(a.id)).publicToken).not.toBe((await imageRow(b.id)).publicToken);
    });
  });

  describe('criação ambígua no GPTMaker', () => {
    it('GPTMaker cria e responde 5xx: o treinamento que ficou lá é removido e nada fica aqui', async () => {
      // Como na API real: grava o treinamento e falha ao processá-lo (ex.: imagem).
      await wiremock.stub({
        request: { method: 'POST', urlPath: TRAININGS_PATH },
        response: { status: 500, jsonBody: { error: 'Fail on train assistant.' } },
      });
      await stubList([{ id: 'tr-orfao', text: 'com imagem' }]);
      await wiremock.stub({
        request: { method: 'DELETE', urlPath: TRAINING_PATH('tr-orfao') },
        response: { status: 200, jsonBody: { success: true } },
      });
      const image = await upload();

      const error = await errorOf(
        service.create(tenantId, agentId, { type: 'TEXT', text: 'com imagem', imageId: image.id }),
      );

      expect(error).toMatchObject({ code: 'GPTMAKER_UNAVAILABLE' });
      expect(await wiremock.count('DELETE', TRAINING_PATH('tr-orfao'))).toBe(1);
      expect(await db.select().from(training)).toHaveLength(0);
      // A imagem continua disponível para nova tentativa.
      expect((await imageRow(image.id)).deletedAt).toBeNull();
    });

    it('não apaga treinamento que já tem registro local, nem de texto diferente', async () => {
      await wiremock.stub({
        request: { method: 'POST', urlPath: TRAININGS_PATH },
        response: { status: 500, jsonBody: { error: 'falhou' } },
      });
      await db.insert(training).values({
        tenantId,
        agentId,
        type: 'TEXT',
        content: 'mesmo texto',
        gptmakerTrainingId: 'tr-meu',
        status: 'DONE',
      });
      await stubList([
        { id: 'tr-meu', text: 'mesmo texto' },
        { id: 'tr-outro', text: 'outro texto' },
      ]);
      await wiremock.stub({
        request: { method: 'DELETE', urlPathPattern: '/v2/training/.*' },
        response: { status: 200, jsonBody: { success: true } },
      });

      await errorOf(service.create(tenantId, agentId, { type: 'TEXT', text: 'mesmo texto' }));

      expect(await wiremock.count('DELETE', TRAINING_PATH('tr-meu'))).toBe(0);
      expect(await wiremock.count('DELETE', TRAINING_PATH('tr-outro'))).toBe(0);
    });
  });

  describe('limpeza', () => {
    const old = () => new Date(Date.now() - 25 * 60 * 60 * 1000);

    it('apaga a enviada e nunca ligada há mais de 24 h; mantém a recente', async () => {
      const abandoned = await upload();
      const recent = await upload();
      await db
        .update(trainingImage)
        .set({ createdAt: old() })
        .where(eq(trainingImage.id, abandoned.id));

      const summary = await images.cleanup();

      expect(summary.orphans).toBe(1);
      expect((await imageRow(abandoned.id)).deletedAt).toBeInstanceOf(Date);
      expect((await imageRow(recent.id)).deletedAt).toBeNull();
    });

    it('mantém a ligada a treinamento e a citada pelas respostas do formulário', async () => {
      const { image: linked } = await withImage();
      const cited = await upload();
      const draft = await upload();
      await db.update(trainingImage).set({ createdAt: old() });
      const [template] = await db
        .select({ id: schema.agentFunctionTemplate.id })
        .from(schema.agentFunctionTemplate);
      if (template) {
        await db.insert(agentFunctionConfig).values({
          agentId,
          tenantId,
          templateId: template.id,
          answers: { 'base.produtos': [{ itemKey: randomUUID(), imageId: cited.id, values: {} }] },
          draftAnswers: {
            'base.produtos': [{ itemKey: randomUUID(), imageId: draft.id, values: {} }],
          },
        });
      }

      await images.cleanup();

      expect((await imageRow(linked.id)).deletedAt).toBeNull();
      if (template) {
        expect((await imageRow(cited.id)).deletedAt).toBeNull();
        expect((await imageRow(draft.id)).deletedAt).toBeNull();
      }
    });
  });
});
