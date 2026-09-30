import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { hashCallbackToken, TrainingService } from '../../src/modules/training/training.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import type { ObjectStorage, PutObjectInput } from '../../src/shared/storage/object-storage';
import { WireMock } from '../support/wiremock';

const { agent, aiModel, tenant, training } = schema;
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
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const client = new GptMakerClient(
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
    service = new TrainingService(
      new AgentRepository(db),
      client,
      storage as unknown as ObjectStorage,
      db,
      redis,
      { API_PUBLIC_URL: API } as Env,
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
    await db.delete(training);
    await db.delete(agent);
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

  describe('documento', () => {
    const upload = (originalName: string, buffer = PDF) =>
      service.createDocument(tenantId, agentId, { originalName, buffer });

    it('grava no storage e envia a URL pré-assinada com nome e tipo', async () => {
      await stubCreate();
      await stubList('DOCUMENT', [{ id: 'tr-doc', documentName: 'Política de trocas.pdf' }]);

      const view = await upload('Política de trocas.pdf');

      const [object] = [...storage.objects.values()];
      expect(object).toMatchObject({
        contentType: 'application/pdf',
        contentLength: PDF.length,
        fileName: 'Política de trocas.pdf',
      });
      expect(object!.key).toMatch(new RegExp(`^trainings/${tenantId}/`));
      expect((await created())[0]).toMatchObject({
        type: 'DOCUMENT',
        documentUrl: `https://storage.test/${object!.key}?X-Amz-Signature=abc`,
        documentName: 'Política de trocas.pdf',
        documentMimetype: 'application/pdf',
      });
      expect(view.document).toEqual({
        name: 'Política de trocas.pdf',
        mimetype: 'application/pdf',
        sizeBytes: PDF.length,
      });
      expect((await rows())[0]).toMatchObject({
        documentKey: object!.key,
        gptmakerTrainingId: 'tr-doc',
      });
    });

    it('nome em latin1 do multipart vira UTF-8', async () => {
      await stubCreate();
      await stubList('DOCUMENT', []);
      const latin1 = Buffer.from('Política.pdf', 'utf8').toString('latin1');

      expect((await upload(latin1)).document!.name).toBe('Política.pdf');
    });

    it.each([
      ['extensão não aceita', 'script.exe', PDF, 'TRAINING_FILE_TYPE'],
      ['conteúdo que não é PDF', 'falso.pdf', Buffer.from('não sou pdf'), 'TRAINING_FILE_TYPE'],
      ['texto binário', 'dados.txt', Buffer.from([0x61, 0x00, 0x62]), 'TRAINING_FILE_TYPE'],
      ['arquivo vazio', 'vazio.txt', Buffer.alloc(0), 'TRAINING_FILE_EMPTY'],
    ])('%s: recusa sem storage nem GPTMaker', async (_, name, buffer, code) => {
      await stubCreate();
      await expect(upload(name, buffer)).rejects.toMatchObject({ code });
      expect(storage.objects.size).toBe(0);
      expect(await wiremock.count('POST', TRAININGS_PATH)).toBe(0);
    });

    it('texto e markdown UTF-8 são aceitos', async () => {
      await stubCreate();
      await stubList('DOCUMENT', []);
      expect(
        (await upload('faq.md', Buffer.from('# Perguntas\nÉ grátis?'))).document,
      ).toMatchObject({ mimetype: 'text/markdown' });
    });

    it('falha no GPTMaker: apaga o objeto do storage e não grava', async () => {
      await stubCreate(500);
      await expect(upload('manual.pdf')).rejects.toMatchObject({ code: 'GPTMAKER_UNAVAILABLE' });
      expect(storage.objects.size).toBe(0);
      expect(await rows()).toHaveLength(0);
    });
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
      expect((await service.list(tenantId, agentId))[0]).toMatchObject({ status: 'DONE' });
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

  it('agente de outro tenant: 404 sem chamar o GPTMaker', async () => {
    await stubCreate();
    const other = await newTenantAgent('OUT_OF_SYNC');
    await expect(
      service.create(other.tenantId, agentId, { type: 'TEXT', text: 'x' }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
    await expect(service.list(other.tenantId, agentId)).rejects.toMatchObject({
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
    expect((await service.list(tenantId, agentId)).map((view) => view.text)).toEqual([
      'um',
      'dois',
    ]);
  });
});
