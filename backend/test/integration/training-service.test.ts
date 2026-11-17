import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { listTrainingsQuerySchema } from '@gptmaker/contracts';
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
import { hashCallbackToken, TrainingService } from '../../src/modules/training/training.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import type { ObjectStorage, PutObjectInput } from '../../src/shared/storage/object-storage';
import { WireMock } from '../support/wiremock';
import { testPool } from '../support/postgres';

const { agent, aiModel, planEntitlement, subscriptionState, tenant, training } = schema;
const WS = 'ws-test';
const API = 'https://api.gptmaker.test';
const REMOTE_AGENT = 'gm-agent-1';
const TRAININGS_PATH = `/v2/agent/${REMOTE_AGENT}/trainings`;
const PDF = Buffer.from('%PDF-1.7\nconteúdo');

/** Storage em memória: o S3 real é coberto em object-storage.test.ts. */
class FakeStorage {
  readonly objects = new Map<string, PutObjectInput>();
  newTrainingKey(tenantId: string, fileName: string) {
    return `trainings/${tenantId}/${randomUUID()}.${fileName.split('.').pop()}`;
  }
  async put(input: PutObjectInput) {
    this.objects.set(input.key, input);
  }
  async presignedUrl(key: string) {
    return `https://storage.test/${key}?X-Amz-Signature=abc`;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe('treinamentos dos agentes', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let storage: FakeStorage;
  let service: TrainingService;
  /** Primeira página sem filtros (tamanho padrão cobre os testes antigos). */
  const listed = async (tenantId: string, agentId: string) =>
    (await service.list(tenantId, agentId, listTrainingsQuerySchema.parse({}))).trainings;
  let client: GptMakerClient;
  const ENV = {
    API_PUBLIC_URL: API,
    TRAINING_DEFAULT_MAX_TRAININGS: 10,
    TRAINING_DEFAULT_MAX_STORAGE_MB: 50,
  } as Env;
  const serviceWith = (env: Partial<Env> = {}) =>
    new TrainingService(
      new AgentRepository(db),
      client,
      storage as unknown as ObjectStorage,
      new TrainingImageService(storage as unknown as ObjectStorage, db, redis, ENV),
      db,
      redis,
      { ...ENV, ...env } as Env,
    );
  let modelId: string;
  let tenantId: string;
  let agentId: string;

  const errorOf = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);
  const rows = () => db.select().from(training);

  async function newTenantAgent(status: 'ACTIVE' | 'OUT_OF_SYNC' = 'ACTIVE') {
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

  async function stubCreate(status = 200) {
    await wiremock.stub({
      request: { method: 'POST', urlPath: TRAININGS_PATH },
      response:
        status === 200
          ? { status, jsonBody: { success: true } }
          : { status, jsonBody: { error: 'falhou' } },
    });
  }

  /** Listagem do GPTMaker depois da criação, por tipo. */
  async function stubList(type: string, items: Array<Record<string, unknown>>) {
    await wiremock.stub({
      request: {
        method: 'GET',
        urlPath: TRAININGS_PATH,
        queryParameters: { type: { equalTo: type } },
      },
      response: { status: 200, jsonBody: items.map((item) => ({ type, ...item })) },
    });
  }

  const created = async () =>
    (await wiremock.bodies('POST', TRAININGS_PATH)) as Array<Record<string, string>>;

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
    client = new GptMakerClient(
      {
        baseUrl: `${wiremock.baseUrl}/v2`,
        token: 't',
        workspaceId: WS,
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
    service = serviceWith();
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

  it('texto: envia com callbackUrl, guarda só o hash do token e acha o id criado', async () => {
    await stubCreate();
    // Já havia um treinamento deste agente com registro local.
    await db.insert(training).values({
      tenantId,
      agentId,
      type: 'TEXT',
      content: 'antigo',
      gptmakerTrainingId: 'tr-old',
      status: 'DONE',
    });
    await stubList('TEXT', [
      { id: 'tr-old', text: 'antigo' },
      { id: 'tr-new', text: 'Trocas em até 7 dias' },
    ]);

    const view = await service.create(tenantId, agentId, {
      type: 'TEXT',
      text: '  Trocas em até 7 dias ',
    });

    const [body] = await created();
    expect(body).toMatchObject({ type: 'TEXT', text: 'Trocas em até 7 dias' });
    const callback = new URL(body!.callbackUrl!);
    expect(`${callback.origin}${callback.pathname}`).toBe(`${API}/gptmaker/trainings/callback`);
    const [stored] = await db.select().from(training).where(eq(training.id, view.id));
    expect(stored).toMatchObject({
      gptmakerTrainingId: 'tr-new',
      status: 'PROCESSING',
      content: 'Trocas em até 7 dias',
      callbackTokenHash: hashCallbackToken(callback.searchParams.get('t')!),
    });
    expect(view).toMatchObject({
      type: 'TEXT',
      status: 'PROCESSING',
      text: 'Trocas em até 7 dias',
    });
  });

  it('site: subpáginas e intervalo no formato do GPTMaker; casa a URL sem a barra final', async () => {
    await stubCreate();
    await stubList('WEBSITE', [{ id: 'tr-site', website: 'https://loja.exemplo.com.br' }]);

    const view = await service.create(tenantId, agentId, {
      type: 'WEBSITE',
      url: 'https://loja.exemplo.com.br/',
      trainingSubPages: true,
      trainingInterval: 'ONE_WEEK',
    });

    expect((await created())[0]).toMatchObject({
      type: 'WEBSITE',
      website: 'https://loja.exemplo.com.br/',
      trainingSubPages: 'ACTIVE',
      trainingInterval: 'ONE_WEEK',
    });
    expect(view).toMatchObject({ trainingSubPages: true, trainingInterval: 'ONE_WEEK' });
    expect((await rows())[0]!.gptmakerTrainingId).toBe('tr-site');
  });

  it('id devolvido pela criação é usado sem listar', async () => {
    await wiremock.stub({
      request: { method: 'POST', urlPath: TRAININGS_PATH },
      response: { status: 200, jsonBody: { id: 'tr-direto', type: 'TEXT', text: 'Oi' } },
    });

    await service.create(tenantId, agentId, { type: 'TEXT', text: 'Oi' });

    expect((await rows())[0]!.gptmakerTrainingId).toBe('tr-direto');
    expect(await wiremock.count('GET', TRAININGS_PATH)).toBe(0);
  });

  it('corpo sem success (como na API real) não é erro', async () => {
    await wiremock.stub({
      request: { method: 'POST', urlPath: TRAININGS_PATH },
      response: { status: 200, jsonBody: {} },
    });
    await stubList('TEXT', [{ id: 'tr-listado', text: 'Oi' }]);

    const view = await service.create(tenantId, agentId, { type: 'TEXT', text: 'Oi' });

    expect(view.status).toBe('PROCESSING');
    expect((await rows())[0]!.gptmakerTrainingId).toBe('tr-listado');
  });

  it('sem como identificar o criado: registro fica sem id para a sincronização', async () => {
    await stubCreate();
    await stubList('VIDEO', [
      { id: 'tr-a', video: 'https://youtu.be/a' },
      { id: 'tr-b', video: 'https://youtu.be/b' },
    ]);

    const view = await service.create(tenantId, agentId, {
      type: 'VIDEO',
      url: 'https://youtu.be/c',
    });

    expect(view.status).toBe('PROCESSING');
    expect((await rows())[0]!.gptmakerTrainingId).toBeNull();
  });

  it('falha no GPTMaker: erro recuperável e nada gravado', async () => {
    await stubCreate(500);
    const error = await errorOf(service.create(tenantId, agentId, { type: 'TEXT', text: 'x' }));
    expect(error).toMatchObject({ code: 'GPTMAKER_UNAVAILABLE', status: 503 });
    expect(await rows()).toHaveLength(0);
  });

  describe('callback do GPTMaker', () => {
    /** Treinamento em processamento com o token de callback informado. */
    async function processing(token: string, values: Partial<typeof training.$inferInsert> = {}) {
      const [row] = await db
        .insert(training)
        .values({
          tenantId,
          agentId,
          type: 'TEXT',
          content: 'x',
          callbackTokenHash: hashCallbackToken(token),
          ...values,
        })
        .returning();
      return row!;
    }
    const stored = async (id: string) =>
      (await db.select().from(training).where(eq(training.id, id)))[0]!;

    it('o token do callbackUrl enviado na criação marca o treinamento como concluído', async () => {
      await stubCreate();
      await stubList('TEXT', []);
      const view = await service.create(tenantId, agentId, { type: 'TEXT', text: 'Oi' });
      const token = new URL((await created())[0]!.callbackUrl!).searchParams.get('t')!;

      await service.applyCallback(token, { status: 'DONE' });

      expect(await stored(view.id)).toMatchObject({ status: 'DONE', error: null });
      expect((await listed(tenantId, agentId))[0]).toMatchObject({ status: 'DONE' });
    });

    it('falha guarda o motivo; conclusão depois (reprocessado) limpa', async () => {
      const row = await processing('tk');

      await service.applyCallback('tk', { status: 'FAILED', error: 'site fora do ar' });
      expect(await stored(row.id)).toMatchObject({ status: 'FAILED', error: 'site fora do ar' });

      await service.applyCallback('tk', { success: true });
      expect(await stored(row.id)).toMatchObject({ status: 'DONE', error: null });
    });

    it('corpo não reconhecido não muda o status', async () => {
      const row = await processing('tk');
      await service.applyCallback('tk', { foo: 'bar' });
      expect((await stored(row.id)).status).toBe('PROCESSING');
    });

    it('completa o id do GPTMaker quando faltava, sem roubar o de outro registro', async () => {
      const missing = await processing('tk-a');
      await service.applyCallback('tk-a', { status: 'DONE', trainingId: 'tr-9' });
      expect((await stored(missing.id)).gptmakerTrainingId).toBe('tr-9');

      const other = await processing('tk-b');
      await service.applyCallback('tk-b', { status: 'DONE', trainingId: 'tr-9' });
      expect((await stored(other.id)).gptmakerTrainingId).toBeNull();

      const known = await processing('tk-c', { gptmakerTrainingId: 'tr-1' });
      await service.applyCallback('tk-c', { status: 'DONE', trainingId: 'tr-2' });
      expect((await stored(known.id)).gptmakerTrainingId).toBe('tr-1');
    });

    it('token desconhecido ou de treinamento removido: 404', async () => {
      await processing('tk-removido', { deletedAt: new Date() });
      await expect(service.applyCallback('inexistente', { status: 'DONE' })).rejects.toMatchObject({
        code: 'TRAINING_CALLBACK_INVALID',
        status: 404,
      });
      await expect(service.applyCallback('tk-removido', { status: 'DONE' })).rejects.toMatchObject({
        code: 'TRAINING_CALLBACK_INVALID',
      });
    });
  });

  describe('edição e remoção', () => {
    const TRAINING_PATH = (id: string) => `/v2/training/${id}`;

    async function existing(values: Partial<typeof training.$inferInsert> = {}) {
      const [row] = await db
        .insert(training)
        .values({
          tenantId,
          agentId,
          type: 'TEXT',
          content: 'Trocas em 7 dias',
          gptmakerTrainingId: 'tr-1',
          status: 'DONE',
          ...values,
        })
        .returning();
      return row!;
    }

    async function stubTraining(method: 'PUT' | 'DELETE', id: string, status = 200) {
      await wiremock.stub({
        request: { method, urlPath: TRAINING_PATH(id) },
        response:
          status === 200
            ? { status, jsonBody: { success: true } }
            : { status, jsonBody: { error: 'falhou' } },
      });
    }

    const stored = async (id: string) =>
      (await db.select().from(training).where(eq(training.id, id)))[0]!;

    it('treinamento gerado pela função: só a publicação edita ou remove', async () => {
      await stubTraining('PUT', 'tr-1');
      await stubTraining('DELETE', 'tr-1');
      const row = await existing({ managed: true });

      for (const call of [
        () => service.updateText(tenantId, agentId, row.id, { text: 'Outro' }),
        () => service.remove(tenantId, agentId, row.id),
      ]) {
        expect(await errorOf(call())).toMatchObject({ code: 'TRAINING_MANAGED_BY_FUNCTION' });
      }
      expect(await wiremock.count('PUT', TRAINING_PATH('tr-1'))).toBe(0);

      const view = await service.updateText(
        tenantId,
        agentId,
        row.id,
        { text: 'Outro' },
        { managed: true },
      );
      expect(view).toMatchObject({ text: 'Outro', managed: true });
      await service.remove(tenantId, agentId, row.id, { managed: true });
      expect((await stored(row.id)).deletedAt).toBeInstanceOf(Date);
    });

    it('edita o texto no GPTMaker e localmente', async () => {
      await stubTraining('PUT', 'tr-1');
      const row = await existing();

      const view = await service.updateText(tenantId, agentId, row.id, {
        text: ' Trocas em 30 dias ',
      });

      expect(await wiremock.bodies('PUT', TRAINING_PATH('tr-1'))).toEqual([
        { type: 'TEXT', text: 'Trocas em 30 dias' },
      ]);
      expect(view.text).toBe('Trocas em 30 dias');
      expect((await stored(row.id)).content).toBe('Trocas em 30 dias');
    });

    it('texto igual ao atual não chama o GPTMaker', async () => {
      await stubTraining('PUT', 'tr-1');
      const row = await existing();
      await service.updateText(tenantId, agentId, row.id, { text: 'Trocas em 7 dias' });
      expect(await wiremock.count('PUT', TRAINING_PATH('tr-1'))).toBe(0);
    });

    it('só texto é editável', async () => {
      const row = await existing({ type: 'WEBSITE', content: null, url: 'https://a.com' });
      await expect(
        service.updateText(tenantId, agentId, row.id, { text: 'x' }),
      ).rejects.toMatchObject({ code: 'TRAINING_NOT_EDITABLE', status: 409 });
    });

    it('sem id do GPTMaker: acha pelo conteúdo e grava; sem achar, TRAINING_NOT_READY', async () => {
      const row = await existing({ gptmakerTrainingId: null });
      await stubList('TEXT', []);
      await expect(
        service.updateText(tenantId, agentId, row.id, { text: 'novo' }),
      ).rejects.toMatchObject({ code: 'TRAINING_NOT_READY' });

      await wiremock.reset();
      await stubList('TEXT', [{ id: 'tr-achado', text: 'Trocas em 7 dias' }]);
      await stubTraining('PUT', 'tr-achado');
      await service.updateText(tenantId, agentId, row.id, { text: 'novo' });
      expect(await stored(row.id)).toMatchObject({
        gptmakerTrainingId: 'tr-achado',
        content: 'novo',
      });
    });

    it('falha no GPTMaker mantém o texto local', async () => {
      await stubTraining('PUT', 'tr-1', 500);
      const row = await existing();
      await expect(
        service.updateText(tenantId, agentId, row.id, { text: 'novo' }),
      ).rejects.toMatchObject({ code: 'GPTMAKER_UNAVAILABLE' });
      expect((await stored(row.id)).content).toBe('Trocas em 7 dias');
    });

    it('remove no GPTMaker, marca removido e apaga o documento do storage', async () => {
      await stubTraining('DELETE', 'tr-doc');
      const key = `trainings/${tenantId}/doc.pdf`;
      await storage.put({
        key,
        body: PDF,
        contentType: 'application/pdf',
        contentLength: PDF.length,
        fileName: 'a.pdf',
      });
      const row = await existing({
        type: 'DOCUMENT',
        content: null,
        gptmakerTrainingId: 'tr-doc',
        documentKey: key,
        documentName: 'a.pdf',
      });

      await service.remove(tenantId, agentId, row.id);

      expect(await wiremock.count('DELETE', TRAINING_PATH('tr-doc'))).toBe(1);
      expect((await stored(row.id)).deletedAt).toBeInstanceOf(Date);
      expect(storage.objects.has(key)).toBe(false);
      expect(await listed(tenantId, agentId)).toEqual([]);
    });

    it('já ausente no GPTMaker: remove só aqui', async () => {
      await stubTraining('DELETE', 'tr-1', 404);
      const row = await existing();
      await service.remove(tenantId, agentId, row.id);
      expect((await stored(row.id)).deletedAt).toBeInstanceOf(Date);
    });

    it('sem id e sem correspondente no GPTMaker: remove só aqui', async () => {
      await stubList('TEXT', []);
      const row = await existing({ gptmakerTrainingId: null });
      await service.remove(tenantId, agentId, row.id);
      expect((await stored(row.id)).deletedAt).toBeInstanceOf(Date);
    });

    it('falha no GPTMaker mantém o registro e o documento', async () => {
      await stubTraining('DELETE', 'tr-1', 500);
      const key = `trainings/${tenantId}/fica.pdf`;
      await storage.put({
        key,
        body: PDF,
        contentType: 'application/pdf',
        contentLength: PDF.length,
        fileName: 'a.pdf',
      });
      const row = await existing({ type: 'DOCUMENT', content: null, documentKey: key });

      await expect(service.remove(tenantId, agentId, row.id)).rejects.toMatchObject({
        code: 'GPTMAKER_UNAVAILABLE',
      });
      expect((await stored(row.id)).deletedAt).toBeNull();
      expect(storage.objects.has(key)).toBe(true);
    });

    it('agente fora de sincronia: remove só aqui, sem chamar o GPTMaker', async () => {
      const other = await newTenantAgent('OUT_OF_SYNC');
      const [row] = await db
        .insert(training)
        .values({
          tenantId: other.tenantId,
          agentId: other.agentId,
          type: 'TEXT',
          content: 'x',
          gptmakerTrainingId: 'tr-orfao',
        })
        .returning();

      await service.remove(other.tenantId, other.agentId, row!.id);

      expect((await stored(row!.id)).deletedAt).toBeInstanceOf(Date);
      expect(await wiremock.count('DELETE', TRAINING_PATH('tr-orfao'))).toBe(0);
    });

    it('treinamento de outro agente, removido ou id inválido: 404', async () => {
      await stubTraining('DELETE', 'tr-1');
      const row = await existing();
      const other = await newTenantAgent('OUT_OF_SYNC');

      await expect(service.remove(other.tenantId, other.agentId, row.id)).rejects.toMatchObject({
        code: 'TRAINING_NOT_FOUND',
      });
      await expect(service.remove(tenantId, agentId, 'nao-e-uuid')).rejects.toMatchObject({
        code: 'TRAINING_NOT_FOUND',
      });
      await service.remove(tenantId, agentId, row.id);
      await expect(service.remove(tenantId, agentId, row.id)).rejects.toMatchObject({
        code: 'TRAINING_NOT_FOUND',
      });
    });
  });

  describe('reenvio', () => {
    async function failed(values: Partial<typeof training.$inferInsert> = {}) {
      const [row] = await db
        .insert(training)
        .values({
          tenantId,
          agentId,
          type: 'TEXT',
          content: 'Trocas em 7 dias',
          status: 'FAILED',
          error: 'falhou',
          gptmakerTrainingId: 'tr-velho',
          callbackTokenHash: 'antigo',
          ...values,
        })
        .returning();
      return row!;
    }
    const stored = async (id: string) =>
      (await db.select().from(training).where(eq(training.id, id)))[0]!;

    it('remove a tentativa anterior e cria de novo no mesmo registro, com token novo', async () => {
      await wiremock.stub({
        request: { method: 'DELETE', urlPath: '/v2/training/tr-velho' },
        response: { status: 200, jsonBody: { success: true } },
      });
      await stubCreate();
      await stubList('TEXT', [{ id: 'tr-novo', text: 'Trocas em 7 dias' }]);
      const row = await failed();

      const view = await service.retry(tenantId, agentId, row.id);

      expect(await wiremock.count('DELETE', '/v2/training/tr-velho')).toBe(1);
      const [body] = await created();
      expect(body).toMatchObject({ type: 'TEXT', text: 'Trocas em 7 dias' });
      const token = new URL(body!.callbackUrl!).searchParams.get('t')!;
      expect(view).toMatchObject({ id: row.id, status: 'PROCESSING', error: null });
      expect(await stored(row.id)).toMatchObject({
        gptmakerTrainingId: 'tr-novo',
        callbackTokenHash: hashCallbackToken(token),
      });
      expect(await rows()).toHaveLength(1);
    });

    it('documento: URL pré-assinada nova do objeto guardado', async () => {
      await stubCreate();
      await stubList('DOCUMENT', []);
      const row = await failed({
        type: 'DOCUMENT',
        content: null,
        gptmakerTrainingId: null,
        documentKey: 'trainings/x/a.pdf',
        documentName: 'a.pdf',
        documentMimetype: 'application/pdf',
      });

      await service.retry(tenantId, agentId, row.id);

      expect((await created())[0]).toMatchObject({
        documentUrl: 'https://storage.test/trainings/x/a.pdf?X-Amz-Signature=abc',
        documentName: 'a.pdf',
      });
    });

    it('falha no GPTMaker: volta a FAILED', async () => {
      await stubCreate(500);
      const row = await failed({ gptmakerTrainingId: null });
      await expect(service.retry(tenantId, agentId, row.id)).rejects.toMatchObject({
        code: 'GPTMAKER_UNAVAILABLE',
      });
      expect((await stored(row.id)).status).toBe('FAILED');
    });

    it('só reenvia com falha; documento sem arquivo guardado não reenvia', async () => {
      const done = await failed({ status: 'DONE' });
      await expect(service.retry(tenantId, agentId, done.id)).rejects.toMatchObject({
        code: 'TRAINING_NOT_FAILED',
      });
      const imported = await failed({
        type: 'DOCUMENT',
        content: null,
        gptmakerTrainingId: 'tr-x',
      });
      await expect(service.retry(tenantId, agentId, imported.id)).rejects.toMatchObject({
        code: 'TRAINING_NOT_RETRYABLE',
      });
    });
  });

  describe('limites do plano', () => {
    async function onPlan(maxTrainings: number | null, maxDocumentStorageMb: number | null) {
      const planSpaId = `plan-${randomUUID()}`;
      await db.insert(planEntitlement).values({
        planSpaId,
        planType: 'subscription',
        creditsPerCycle: 1000,
        maxTrainings,
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

    const existing = (values: Partial<typeof training.$inferInsert> = {}) =>
      db.insert(training).values({ tenantId, agentId, type: 'TEXT', content: 'x', ...values });

    it('soma os agentes do tenant, sem os removidos, e recusa acima do limite', async () => {
      await onPlan(2, null);
      // Outro agente do mesmo tenant (id próprio no GPTMaker).
      const second = await newTenantAgent('OUT_OF_SYNC');
      await db.update(agent).set({ tenantId }).where(eq(agent.id, second.agentId));
      await existing();
      await existing({ agentId: second.agentId });
      await existing({ deletedAt: new Date() });
      await stubCreate();

      const error = await errorOf(service.create(tenantId, agentId, { type: 'TEXT', text: 'y' }));

      expect(error).toMatchObject({
        code: 'PLAN_TRAINING_LIMIT',
        status: 422,
        details: { kind: 'trainings', used: 2, limit: 2 },
      });
      expect(await wiremock.count('POST', TRAININGS_PATH)).toBe(0);
    });

    it('limite nulo no plano é sem limite', async () => {
      await onPlan(null, null);
      for (let i = 0; i < 12; i++) await existing();
      await stubCreate();
      await stubList('TEXT', []);
      await expect(
        service.create(tenantId, agentId, { type: 'TEXT', text: 'mais um' }),
      ).resolves.toBeDefined();
    });

    it('sem plano: valem os padrões do ambiente', async () => {
      await existing();
      await stubCreate();
      await expect(
        serviceWith({ TRAINING_DEFAULT_MAX_TRAININGS: 1 }).create(tenantId, agentId, {
          type: 'TEXT',
          text: 'y',
        }),
      ).rejects.toMatchObject({ code: 'PLAN_TRAINING_LIMIT', details: { limit: 1 } });
    });

    it('uso: quantidade e bytes de documentos do tenant', async () => {
      await onPlan(20, 100);
      await existing();
      await existing({ type: 'DOCUMENT', content: null, documentSizeBytes: 3000 });
      await existing({
        type: 'DOCUMENT',
        content: null,
        documentSizeBytes: 9999,
        deletedAt: new Date(),
      });

      expect(await service.usage(tenantId)).toEqual({
        trainings: { used: 2, limit: 20 },
        documentBytes: { used: 3000, limit: 100 * 1024 * 1024 },
      });
    });
  });

  describe('tags e expiração (spec training-tags, training-expiration)', () => {
    const HOUR = 3_600_000;
    const inFuture = (ms = 24 * HOUR) => new Date(Date.now() + ms);
    const REMOTE = (id: string) => `/v2/training/${id}`;
    const stored = async (id: string) =>
      (await db.select().from(training).where(eq(training.id, id)))[0]!;

    async function existing(values: Partial<typeof training.$inferInsert> = {}) {
      const [row] = await db
        .insert(training)
        .values({
          tenantId,
          agentId,
          type: 'TEXT',
          content: 'Trocas em 7 dias',
          gptmakerTrainingId: 'tr-1',
          status: 'DONE',
          ...values,
        })
        .returning();
      return row!;
    }

    async function stubRemote(method: 'PUT' | 'DELETE', id: string) {
      await wiremock.stub({
        request: { method, urlPath: REMOTE(id) },
        response: { status: 200, jsonBody: { success: true } },
      });
    }

    async function onPlan(maxTrainings: number | null) {
      const planSpaId = `plan-${randomUUID()}`;
      await db.insert(planEntitlement).values({
        planSpaId,
        planType: 'subscription',
        creditsPerCycle: 1000,
        maxTrainings,
        maxDocumentStorageMb: null,
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

    describe('criação', () => {
      it('grava tags normalizadas e a expiração, e a view devolve os campos', async () => {
        await stubCreate();
        await stubList('TEXT', []);
        const expiresAt = inFuture();

        const view = await service.create(tenantId, agentId, {
          type: 'TEXT',
          text: 'Oi',
          tags: ['Preços', ' preços ', 'Frete  Grátis'],
          expiresAt: expiresAt.toISOString(),
        });

        expect(view).toMatchObject({
          tags: ['preços', 'frete grátis'],
          expiresAt: expiresAt.toISOString(),
          expiredAt: null,
        });
        expect(await stored(view.id)).toMatchObject({
          tags: ['preços', 'frete grátis'],
          expiresAt,
          expiredAt: null,
        });
      });

      it.each([
        ['site', { type: 'WEBSITE' as const, url: 'https://loja.exemplo.com.br' }],
        ['vídeo', { type: 'VIDEO' as const, url: 'https://youtu.be/x' }],
      ])('%s também aceita tags e expiração', async (_nome, input) => {
        await stubCreate();
        await stubList(input.type, []);

        const view = await service.create(tenantId, agentId, {
          ...input,
          tags: ['ofertas'],
          expiresAt: inFuture().toISOString(),
        } as never);

        expect(view.tags).toEqual(['ofertas']);
        expect(view.expiresAt).not.toBeNull();
      });

      it('sem tags nem expiração: lista vazia e sem prazo', async () => {
        await stubCreate();
        await stubList('TEXT', []);
        const view = await service.create(tenantId, agentId, { type: 'TEXT', text: 'Oi' });
        expect(view).toMatchObject({ tags: [], expiresAt: null, expiredAt: null });
      });

      it('expiração no passado é recusada sem chamar o GPTMaker', async () => {
        await stubCreate();
        await expect(
          service.create(tenantId, agentId, {
            type: 'TEXT',
            text: 'Oi',
            expiresAt: new Date(Date.now() - HOUR).toISOString(),
          }),
        ).rejects.toThrow();
        expect(await wiremock.count('POST', TRAININGS_PATH)).toBe(0);
        expect(await rows()).toHaveLength(0);
      });

      it('treinamento gerado pela função não aceita tags nem expiração', async () => {
        await stubCreate();
        const error = await errorOf(
          service.create(
            tenantId,
            agentId,
            { type: 'TEXT', text: 'Oi', tags: ['x'] },
            { managed: true },
          ),
        );
        expect(error).toMatchObject({ code: 'TRAINING_MANAGED_NO_SETTINGS', status: 400 });
        expect(await wiremock.count('POST', TRAININGS_PATH)).toBe(0);
      });
    });

    describe('ajustes (updateSettings)', () => {
      it('site DONE continua DONE e o GPTMaker não é chamado', async () => {
        const row = await existing({
          type: 'WEBSITE',
          content: null,
          url: 'https://a.com',
          status: 'DONE',
        });
        const expiresAt = inFuture();

        const view = await service.updateSettings(tenantId, agentId, row.id, {
          tags: ['Catálogo', 'catálogo'],
          expiresAt: expiresAt.toISOString(),
        });

        expect(view).toMatchObject({
          status: 'DONE',
          tags: ['catálogo'],
          expiresAt: expiresAt.toISOString(),
        });
        expect(await stored(row.id)).toMatchObject({ status: 'DONE', tags: ['catálogo'] });
        for (const method of ['POST', 'PUT', 'DELETE', 'GET']) {
          expect(await wiremock.count(method, TRAININGS_PATH)).toBe(0);
          expect(await wiremock.count(method, REMOTE('tr-1'))).toBe(0);
        }
      });

      it('só tags não mexe na expiração e expiresAt null limpa o prazo', async () => {
        const expiresAt = inFuture();
        const row = await existing({ tags: ['a'], expiresAt });

        await service.updateSettings(tenantId, agentId, row.id, { tags: ['b'] });
        expect(await stored(row.id)).toMatchObject({ tags: ['b'], expiresAt });

        await service.updateSettings(tenantId, agentId, row.id, { expiresAt: null });
        expect(await stored(row.id)).toMatchObject({ tags: ['b'], expiresAt: null });
      });

      it('objeto vazio é recusado', async () => {
        const row = await existing();
        await expect(service.updateSettings(tenantId, agentId, row.id, {})).rejects.toThrow();
      });

      it('treinamento gerado pela função é recusado', async () => {
        const row = await existing({ managed: true });
        expect(
          await errorOf(service.updateSettings(tenantId, agentId, row.id, { tags: ['x'] })),
        ).toMatchObject({ code: 'TRAINING_MANAGED_BY_FUNCTION' });
        expect((await stored(row.id)).tags).toEqual([]);
      });

      it('expirado é recusado com TRAINING_EXPIRED (409)', async () => {
        const row = await existing({ status: 'EXPIRED', expiredAt: new Date() });
        expect(
          await errorOf(service.updateSettings(tenantId, agentId, row.id, { tags: ['x'] })),
        ).toMatchObject({ code: 'TRAINING_EXPIRED', status: 409 });
        expect((await stored(row.id)).tags).toEqual([]);
      });

      it('agente de outro tenant: AGENT_NOT_FOUND e nada muda', async () => {
        const row = await existing();
        const other = await newTenantAgent('OUT_OF_SYNC');
        expect(
          await errorOf(service.updateSettings(other.tenantId, agentId, row.id, { tags: ['x'] })),
        ).toMatchObject({ code: 'AGENT_NOT_FOUND' });
        // Agente do outro tenant com o id do treinamento: o treinamento não existe para ele.
        expect(
          await errorOf(
            service.updateSettings(other.tenantId, other.agentId, row.id, { tags: ['x'] }),
          ),
        ).toMatchObject({ code: 'TRAINING_NOT_FOUND' });
        expect((await stored(row.id)).tags).toEqual([]);
      });
    });

    describe('listagem paginada e filtros', () => {
      const ids = (view: { trainings: Array<{ text?: string | null }> }) =>
        view.trainings.map((item) => item.text);
      const query = (params: Record<string, string | number> = {}) =>
        listTrainingsQuerySchema.parse(
          Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        );

      it('45 itens: páginas de 20, 20 e 5, na ordem de criação, com total certo', async () => {
        await db.insert(training).values(
          Array.from({ length: 45 }, (_, n) => ({
            tenantId,
            agentId,
            type: 'TEXT' as const,
            content: `item ${String(n).padStart(2, '0')}`,
            createdAt: new Date(1_000 + n),
          })),
        );

        const pages = [];
        for (const page of [1, 2, 3]) {
          pages.push(await service.list(tenantId, agentId, query({ page })));
        }

        expect(pages.map((p) => p.trainings.length)).toEqual([20, 20, 5]);
        expect(pages[0]!.page).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
        expect(ids(pages[0]!)[0]).toBe('item 00');
        expect(ids(pages[1]!)[0]).toBe('item 20');
        expect(ids(pages[2]!)).toEqual(['item 40', 'item 41', 'item 42', 'item 43', 'item 44']);
        const all = pages.flatMap((p) => p.trainings.map((t) => t.id));
        expect(new Set(all).size).toBe(45);
      });

      it('página além do fim vem vazia, com o total certo', async () => {
        await db.insert(training).values(
          Array.from({ length: 3 }, (_, n) => ({
            tenantId,
            agentId,
            type: 'TEXT' as const,
            content: `i${n}`,
          })),
        );
        const result = await service.list(tenantId, agentId, query({ page: 9 }));
        expect(result.trainings).toEqual([]);
        expect(result.page).toEqual({ page: 9, pageSize: 20, total: 3, totalPages: 1 });
      });

      it('lista vazia: total 0 e zero páginas', async () => {
        const result = await service.list(tenantId, agentId, query());
        expect(result.page).toMatchObject({ total: 0, totalPages: 0 });
        expect(result.availableTags).toEqual([]);
      });

      describe('filtros', () => {
        beforeEach(async () => {
          await db.insert(training).values([
            {
              tenantId,
              agentId,
              type: 'TEXT',
              content: 'Tabela de Preços',
              status: 'DONE',
              tags: ['preços'],
              createdAt: new Date(1),
            },
            {
              tenantId,
              agentId,
              type: 'TEXT',
              content: 'Prazo de entrega',
              status: 'FAILED',
              tags: ['frete', 'preços'],
              createdAt: new Date(2),
            },
            {
              tenantId,
              agentId,
              type: 'WEBSITE',
              url: 'https://loja.exemplo.com.br/preços',
              status: 'DONE',
              tags: ['site'],
              createdAt: new Date(3),
            },
            {
              tenantId,
              agentId,
              type: 'VIDEO',
              url: 'https://youtu.be/frete',
              status: 'PROCESSING',
              createdAt: new Date(4),
            },
            {
              tenantId,
              agentId,
              type: 'DOCUMENT',
              documentName: 'Manual de Preços.pdf',
              status: 'EXPIRED',
              tags: ['manual'],
              createdAt: new Date(5),
            },
          ]);
        });

        const found = async (params: Record<string, string>) => {
          const result = await service.list(tenantId, agentId, query(params));
          return { result, count: result.page.total };
        };

        it('busca é insensível a maiúsculas e olha conteúdo, url e nome do documento', async () => {
          const { result } = await found({ q: 'PREÇOS' });
          expect(result.page.total).toBe(3);
          expect(result.trainings.map((t) => t.type)).toEqual(['TEXT', 'WEBSITE', 'DOCUMENT']);
        });

        it.each([
          ['tipo', { type: 'TEXT' }, 2],
          ['vários tipos (OU)', { type: 'TEXT,VIDEO' }, 3],
          ['estado', { status: 'DONE' }, 2],
          ['vários estados (OU)', { status: 'FAILED,EXPIRED' }, 2],
          ['tag', { tags: 'preços' }, 2],
          ['várias tags (OU)', { tags: 'frete,site' }, 2],
          ['tag normalizada no filtro', { tags: 'PREÇOS' }, 2],
          ['tag inexistente', { tags: 'nada' }, 0],
        ])('filtro por %s', async (_nome, params, total) => {
          expect((await found(params)).count).toBe(total);
        });

        it('filtros combinados valem em conjunto (E entre eles)', async () => {
          const { result } = await found({
            q: 'preços',
            type: 'TEXT',
            status: 'DONE',
            tags: 'preços',
          });
          expect(result.trainings.map((t) => t.text)).toEqual(['Tabela de Preços']);
          expect(result.page.total).toBe(1);
        });

        it('total e páginas respeitam o filtro', async () => {
          const result = await service.list(
            tenantId,
            agentId,
            query({ tags: 'preços', pageSize: 1, page: 2 }),
          );
          expect(result.trainings.map((t) => t.text)).toEqual(['Prazo de entrega']);
          expect(result.page).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
        });

        it('availableTags: todas as tags do agente, ordenadas, mesmo com filtro aplicado', async () => {
          const result = await service.list(tenantId, agentId, query({ type: 'VIDEO' }));
          expect(result.availableTags).toEqual(['frete', 'manual', 'preços', 'site']);
        });
      });

      it('busca com "%" e "_" é literal, não curinga', async () => {
        await db.insert(training).values([
          { tenantId, agentId, type: 'TEXT', content: 'Desconto de 50% hoje' },
          { tenantId, agentId, type: 'TEXT', content: 'Desconto de 500 reais' },
          { tenantId, agentId, type: 'TEXT', content: 'codigo_a1' },
          { tenantId, agentId, type: 'TEXT', content: 'codigoXa1' },
        ]);

        expect(ids(await service.list(tenantId, agentId, query({ q: '50%' })))).toEqual([
          'Desconto de 50% hoje',
        ]);
        expect(ids(await service.list(tenantId, agentId, query({ q: 'o_a' })))).toEqual([
          'codigo_a1',
        ]);
        expect(ids(await service.list(tenantId, agentId, query({ q: '%' })))).toEqual([
          'Desconto de 50% hoje',
        ]);
      });

      it('removidos, outro agente e outro tenant não aparecem nem vazam tags', async () => {
        const sibling = await newTenantAgent('OUT_OF_SYNC');
        await db.update(agent).set({ tenantId }).where(eq(agent.id, sibling.agentId));
        const stranger = await newTenantAgent('OUT_OF_SYNC');
        await db.insert(training).values([
          { tenantId, agentId, type: 'TEXT', content: 'meu', tags: ['minha'] },
          {
            tenantId,
            agentId,
            type: 'TEXT',
            content: 'apagado',
            tags: ['apagada'],
            deletedAt: new Date(),
          },
          { tenantId, agentId: sibling.agentId, type: 'TEXT', content: 'irmão', tags: ['irma'] },
          {
            tenantId: stranger.tenantId,
            agentId: stranger.agentId,
            type: 'TEXT',
            content: 'alheio',
            tags: ['alheia'],
          },
        ]);

        const result = await service.list(tenantId, agentId, query());

        expect(ids(result)).toEqual(['meu']);
        expect(result.availableTags).toEqual(['minha']);
        expect(await errorOf(service.list(stranger.tenantId, agentId, query()))).toMatchObject({
          code: 'AGENT_NOT_FOUND',
        });
      });

      it('usage é do tenant inteiro, independente de filtros e de página', async () => {
        await db.insert(training).values([
          { tenantId, agentId, type: 'TEXT', content: 'a', tags: ['x'] },
          { tenantId, agentId, type: 'TEXT', content: 'b' },
          { tenantId, agentId, type: 'VIDEO', url: 'https://youtu.be/c' },
        ]);

        const filtered = await service.list(tenantId, agentId, query({ tags: 'x' }));
        const empty = await service.list(tenantId, agentId, query({ q: 'nao-existe' }));

        expect(filtered.page.total).toBe(1);
        expect(empty.page.total).toBe(0);
        expect(filtered.usage.trainings.used).toBe(3);
        expect(empty.usage).toEqual(filtered.usage);
      });
    });

    describe('treinamento expirado', () => {
      it('usage e limite ignoram EXPIRED: expirar libera a cota', async () => {
        await onPlan(1);
        const row = await existing({ expiresAt: new Date(Date.now() - HOUR) });
        await stubCreate();
        await stubList('TEXT', []);
        await stubRemote('DELETE', 'tr-1');

        expect(await service.usage(tenantId)).toMatchObject({ trainings: { used: 1, limit: 1 } });
        expect(
          await errorOf(service.create(tenantId, agentId, { type: 'TEXT', text: 'novo' })),
        ).toMatchObject({ code: 'PLAN_TRAINING_LIMIT' });

        expect(await service.expire({ id: row.id, tenantId, agentId })).toBe(true);

        expect(await service.usage(tenantId)).toMatchObject({ trainings: { used: 0, limit: 1 } });
        await expect(
          service.create(tenantId, agentId, { type: 'TEXT', text: 'novo' }),
        ).resolves.toBeDefined();
      });

      it('bytes de documento expirado não contam no uso', async () => {
        await existing({ type: 'DOCUMENT', content: null, documentSizeBytes: 4000 });
        await existing({
          type: 'DOCUMENT',
          content: null,
          documentSizeBytes: 9000,
          gptmakerTrainingId: 'tr-expirado',
          status: 'EXPIRED',
        });
        expect((await service.usage(tenantId)).documentBytes.used).toBe(4000);
      });

      it('expirado continua listado, com status EXPIRED e expiredAt', async () => {
        const expiredAt = new Date();
        await existing({ status: 'EXPIRED', expiredAt });
        const [view] = await listed(tenantId, agentId);
        expect(view).toMatchObject({ status: 'EXPIRED', expiredAt: expiredAt.toISOString() });
      });

      it('updateText e retry são recusados com TRAINING_EXPIRED, sem chamar o GPTMaker', async () => {
        await stubRemote('PUT', 'tr-1');
        await stubCreate();
        const row = await existing({ status: 'EXPIRED', expiredAt: new Date() });

        for (const call of [
          () => service.updateText(tenantId, agentId, row.id, { text: 'Outro' }),
          () => service.retry(tenantId, agentId, row.id),
        ]) {
          expect(await errorOf(call())).toMatchObject({ code: 'TRAINING_EXPIRED', status: 409 });
        }
        expect(await wiremock.count('PUT', REMOTE('tr-1'))).toBe(0);
        expect(await wiremock.count('POST', TRAININGS_PATH)).toBe(0);
        expect(await stored(row.id)).toMatchObject({
          status: 'EXPIRED',
          content: 'Trocas em 7 dias',
        });
      });

      it('remover expirado só marca deletedAt, sem chamar o GPTMaker', async () => {
        await stubRemote('DELETE', 'tr-1');
        const row = await existing({ status: 'EXPIRED', expiredAt: new Date() });

        await service.remove(tenantId, agentId, row.id);

        expect((await stored(row.id)).deletedAt).toBeInstanceOf(Date);
        expect(await wiremock.count('DELETE', REMOTE('tr-1'))).toBe(0);
        expect(await listed(tenantId, agentId)).toEqual([]);
      });

      it('remover expirado funciona mesmo com o GPTMaker fora do ar', async () => {
        await wiremock.stub({
          request: { method: 'DELETE', urlPath: REMOTE('tr-1') },
          response: { status: 500, jsonBody: { error: 'falhou' } },
        });
        const row = await existing({ status: 'EXPIRED', expiredAt: new Date() });
        await expect(service.remove(tenantId, agentId, row.id)).resolves.toBeUndefined();
        expect((await stored(row.id)).deletedAt).toBeInstanceOf(Date);
      });

      it('callback tardio de expirado é ignorado e não ressuscita', async () => {
        const row = await existing({
          status: 'EXPIRED',
          expiredAt: new Date(),
          error: null,
          callbackTokenHash: hashCallbackToken('tk-tardio'),
        });

        await service.applyCallback('tk-tardio', { status: 'DONE', trainingId: 'tr-novo' });
        await service.applyCallback('tk-tardio', { status: 'FAILED', error: 'x' });

        expect(await stored(row.id)).toMatchObject({
          status: 'EXPIRED',
          error: null,
          gptmakerTrainingId: 'tr-1',
        });
      });
    });
  });

  it('agente de outro tenant: 404 sem chamar o GPTMaker', async () => {
    await stubCreate();
    const other = await newTenantAgent('OUT_OF_SYNC');
    await expect(
      service.create(other.tenantId, agentId, { type: 'TEXT', text: 'x' }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
    await expect(
      service.list(other.tenantId, agentId, listTrainingsQuerySchema.parse({})),
    ).rejects.toMatchObject({
      code: 'AGENT_NOT_FOUND',
    });
    expect(await wiremock.count('POST', TRAININGS_PATH)).toBe(0);
  });

  it('agente fora de sincronia não recebe treinamento', async () => {
    const other = await newTenantAgent('OUT_OF_SYNC');
    await expect(
      service.create(other.tenantId, other.agentId, { type: 'TEXT', text: 'x' }),
    ).rejects.toMatchObject({ code: 'AGENT_OUT_OF_SYNC' });
  });

  it('lista só os não removidos do agente, do mais antigo ao mais novo', async () => {
    await db.insert(training).values([
      { tenantId, agentId, type: 'TEXT', content: 'um', createdAt: new Date(1000) },
      { tenantId, agentId, type: 'TEXT', content: 'dois', createdAt: new Date(2000) },
      { tenantId, agentId, type: 'TEXT', content: 'removido', deletedAt: new Date() },
    ]);
    expect((await listed(tenantId, agentId)).map((view) => view.text)).toEqual(['um', 'dois']);
  });
});
