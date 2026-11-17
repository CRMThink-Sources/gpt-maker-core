import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { TrainingImageService } from '../../src/modules/training/training-image.service';
import { TrainingTransferService } from '../../src/modules/training/training-transfer.service';
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
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2048, 1),
]);

class FakeStorage {
  readonly objects = new Map<string, PutObjectInput>();
  reads = 0;
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
    this.reads += 1;
    const object = this.objects.get(key);
    if (!object) throw new Error('não encontrado');
    return {
      body: Readable.from([object.body as Buffer]),
      contentLength: (object.body as Buffer).length,
    };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

// Exportar e importar treinamentos (spec agent-training-transfer; tarefas 2.1, 2.2, 3.0 e 3.3).
describe('exportar e importar treinamentos', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let storage: FakeStorage;
  let images: TrainingImageService;
  let trainings: TrainingService;
  let transfer: TrainingTransferService;
  let modelId: string;
  const ENV = {
    API_PUBLIC_URL: API,
    TRAINING_DEFAULT_MAX_TRAININGS: 50,
    TRAINING_DEFAULT_MAX_STORAGE_MB: 50,
  } as Env;

  const errorOf = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

  async function newTenantAgent(name = 'Atendente') {
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
        gptmakerAgentId: `gm-agent-${code}`,
        name,
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return { tenantId: owner!.id, agentId: row!.id };
  }

  async function onPlan(tenantId: string, maxTrainings: number | null) {
    const planSpaId = `plan-${randomUUID()}`;
    await db.insert(planEntitlement).values({
      planSpaId,
      planType: 'subscription',
      creditsPerCycle: 1000,
      maxTrainings,
      maxDocumentStorageMb: 100,
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

  const stubCreate = () =>
    wiremock.stub({
      request: { method: 'POST', urlPathPattern: '/v2/agent/gm-agent-.*/trainings' },
      response: { status: 200, jsonBody: { success: true } },
    });

  const addText = (
    owner: { tenantId: string; agentId: string },
    values: Partial<typeof training.$inferInsert> = {},
  ) =>
    db
      .insert(training)
      .values({
        tenantId: owner.tenantId,
        agentId: owner.agentId,
        type: 'TEXT',
        content: 'texto',
        status: 'DONE',
        ...values,
      })
      .returning()
      .then(([row]) => row!);

  const manualOf = (owner: { tenantId: string; agentId: string }) =>
    db
      .select()
      .from(training)
      .where(
        and(
          eq(training.tenantId, owner.tenantId),
          eq(training.agentId, owner.agentId),
          eq(training.managed, false),
          isNull(training.deletedAt),
        ),
      );

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
    const agents = new AgentRepository(db);
    images = new TrainingImageService(storage as unknown as ObjectStorage, db, redis, ENV);
    trainings = new TrainingService(
      agents,
      client,
      storage as unknown as ObjectStorage,
      images,
      db,
      redis,
      ENV,
    );
    transfer = new TrainingTransferService(agents, trainings, images, db, redis);
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
    storage.reads = 0;
    await db.delete(training);
    await db.delete(trainingImage);
    await db.delete(agentFunctionConfig);
    await db.delete(agent);
    await db.delete(subscriptionState);
    await db.delete(planEntitlement);
    await stubCreate();
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  describe('exportação', () => {
    it('leva só os manuais de texto, site e vídeo, na ordem de criação, sem identificadores', async () => {
      const owner = await newTenantAgent('Atendente Comercial');
      await addText(owner, { content: 'primeiro', createdAt: new Date('2026-01-01') });
      await addText(owner, {
        type: 'WEBSITE',
        content: null,
        url: 'https://exemplo.com',
        trainingSubPages: true,
        trainingInterval: 'ONE_DAY',
        createdAt: new Date('2026-01-02'),
      });
      await addText(owner, {
        type: 'VIDEO',
        content: null,
        url: 'https://youtu.be/x',
        createdAt: new Date('2026-01-03'),
      });
      // Ficam de fora: da função, documento e removido.
      await addText(owner, { content: 'da função', managed: true });
      await addText(owner, { type: 'DOCUMENT', content: null, documentName: 'a.pdf' });
      await addText(owner, { content: 'removido', deletedAt: new Date() });

      const { file, fileName } = await transfer.export(
        owner.tenantId,
        owner.agentId,
        new Date('2026-11-16T12:00:00Z'),
      );

      expect(file).toEqual({
        version: 1,
        exportedAt: '2026-11-16T12:00:00.000Z',
        trainings: [
          { type: 'TEXT', text: 'primeiro' },
          {
            type: 'WEBSITE',
            url: 'https://exemplo.com',
            trainingSubPages: true,
            trainingInterval: 'ONE_DAY',
          },
          { type: 'VIDEO', url: 'https://youtu.be/x' },
        ],
      });
      expect(fileName).toBe('treinamentos-atendente-comercial-2026-11-16.json');
      expect(JSON.stringify(file)).not.toMatch(/tenant|gptmaker|callback|managed/i);
    });

    it('texto com imagem sai com o link público; sem imagem, não', async () => {
      const owner = await newTenantAgent();
      const image = await trainings.uploadImage(owner.tenantId, owner.agentId, {
        originalname: 'tabela.png',
        buffer: PNG,
      });
      await addText(owner, { content: 'com imagem', imageId: image.id });
      await addText(owner, { content: 'sem imagem' });

      const { file } = await transfer.export(owner.tenantId, owner.agentId);

      expect(file.trainings).toEqual([
        { type: 'TEXT', text: 'com imagem', imageUrl: image.url },
        { type: 'TEXT', text: 'sem imagem' },
      ]);
    });

    it('leva as tags, nunca a expiração, e deixa de fora os expirados', async () => {
      const owner = await newTenantAgent();
      await addText(owner, {
        content: 'ativo',
        tags: ['preços'],
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date('2026-01-01'),
      });
      await addText(owner, {
        content: 'vencido',
        status: 'EXPIRED',
        tags: ['preços'],
        expiredAt: new Date(),
        createdAt: new Date('2026-01-02'),
      });

      const { file } = await transfer.export(owner.tenantId, owner.agentId);

      expect(file.trainings).toEqual([{ type: 'TEXT', text: 'ativo', tags: ['preços'] }]);
      expect(JSON.stringify(file)).not.toMatch(/expires|expired/i);
    });

    it('agente sem treinamentos manuais gera lista vazia', async () => {
      const owner = await newTenantAgent();
      const { file } = await transfer.export(owner.tenantId, owner.agentId);
      expect(file.trainings).toEqual([]);
    });

    it('agente de outro tenant responde como inexistente', async () => {
      const owner = await newTenantAgent();
      const other = await newTenantAgent();
      const error = await errorOf(transfer.export(other.tenantId, owner.agentId));
      expect(error).toMatchObject({ status: 404 });
    });
  });

  describe('importação', () => {
    it('cria os treinamentos como manuais e soma aos existentes', async () => {
      const owner = await newTenantAgent();
      await addText(owner, { content: 'já existia' });

      const result = await transfer.import(owner.tenantId, owner.agentId, {
        version: 1,
        trainings: [
          { type: 'TEXT', text: 'novo texto' },
          { type: 'WEBSITE', url: 'https://exemplo.com' },
          { type: 'VIDEO', url: 'https://youtu.be/x' },
        ],
      });

      expect(result.summary).toMatchObject({ created: 3, rejected: 0, failed: 0 });
      const rows = await manualOf(owner);
      expect(rows.map((row) => row.content ?? row.url).sort()).toEqual(
        ['já existia', 'novo texto', 'https://exemplo.com', 'https://youtu.be/x'].sort(),
      );
      expect(rows.every((row) => row.managed === false)).toBe(true);
    });

    it('exportar de um agente e importar em outro de outro tenant', async () => {
      const source = await newTenantAgent('Origem');
      const target = await newTenantAgent('Destino');
      await addText(source, { content: 'Preços 2026' });
      await addText(source, { type: 'VIDEO', content: null, url: 'https://youtu.be/x' });
      const { file } = await transfer.export(source.tenantId, source.agentId);

      const result = await transfer.import(target.tenantId, target.agentId, file);

      expect(result.summary).toMatchObject({ created: 2 });
      expect((await manualOf(target)).map((row) => row.tenantId)).toEqual([
        target.tenantId,
        target.tenantId,
      ]);
      expect(await manualOf(source)).toHaveLength(2);
    });

    it('recusa item inválido e cria o resto', async () => {
      const owner = await newTenantAgent();
      const result = await transfer.import(owner.tenantId, owner.agentId, {
        version: 1,
        trainings: [
          { type: 'TEXT', text: 'ok' },
          { type: 'TEXT', text: '' },
          { type: 'VIDEO', url: 'ftp://x' },
        ],
      });
      expect(result.items.map((item) => item.status)).toEqual(['CREATED', 'REJECTED', 'REJECTED']);
      expect(await manualOf(owner)).toHaveLength(1);
    });

    it('agente de outro tenant responde como inexistente e nada é criado', async () => {
      const owner = await newTenantAgent();
      const other = await newTenantAgent();
      const error = await errorOf(
        transfer.import(other.tenantId, owner.agentId, {
          version: 1,
          trainings: [{ type: 'TEXT', text: 'x' }],
        }),
      );
      expect(error).toMatchObject({ status: 404 });
      expect(await manualOf(owner)).toHaveLength(0);
    });
  });

  describe('limite do plano', () => {
    it('cria só os primeiros até o limite e recusa os demais', async () => {
      const owner = await newTenantAgent();
      await onPlan(owner.tenantId, 3);
      await addText(owner, { content: 'existente' });

      const result = await transfer.import(owner.tenantId, owner.agentId, {
        version: 1,
        trainings: [1, 2, 3, 4].map((n) => ({ type: 'TEXT', text: `item ${n}` })),
      });

      expect(result.items.map((item) => item.status)).toEqual([
        'CREATED',
        'CREATED',
        'REJECTED',
        'REJECTED',
      ]);
      expect(result.items[2]?.reason?.code).toBe('PLAN_TRAINING_LIMIT');
      expect(await manualOf(owner)).toHaveLength(3);
    });

    it('importações simultâneas do mesmo tenant não passam do limite', async () => {
      const first = await newTenantAgent();
      await onPlan(first.tenantId, 3);
      const code = randomBytes(3).toString('hex');
      const [second] = await db
        .insert(agent)
        .values({
          tenantId: first.tenantId,
          gptmakerAgentId: `gm-agent-${code}`,
          name: 'Segundo',
          type: 'SUPPORT',
          communicationType: 'NORMAL',
          modelId,
          webhookTokenHash: randomUUID(),
        })
        .returning();
      const file = {
        version: 1,
        trainings: [1, 2].map((n) => ({ type: 'TEXT', text: `item ${n}` })),
      };

      await Promise.all([
        transfer.import(first.tenantId, first.agentId, file),
        transfer.import(first.tenantId, second!.id, file),
      ]);

      const total = await db.select().from(training).where(eq(training.tenantId, first.tenantId));
      expect(total).toHaveLength(3);
    });
  });

  describe('imagens (cópia por link)', () => {
    async function sourceWithImage() {
      const source = await newTenantAgent('Origem');
      const image = await trainings.uploadImage(source.tenantId, source.agentId, {
        originalname: 'tabela.png',
        buffer: PNG,
      });
      await addText(source, { content: 'Tabela', imageId: image.id });
      const { file } = await transfer.export(source.tenantId, source.agentId);
      return { source, image, file };
    }

    it('copia a imagem como nova, sem tocar na original', async () => {
      const { source, image, file } = await sourceWithImage();
      const target = await newTenantAgent('Destino');

      const result = await transfer.import(target.tenantId, target.agentId, file);

      expect(result.items[0]).toMatchObject({ status: 'CREATED', warnings: [] });
      const [copy] = await db
        .select()
        .from(trainingImage)
        .where(eq(trainingImage.agentId, target.agentId));
      const [original] = await db
        .select()
        .from(trainingImage)
        .where(eq(trainingImage.id, image.id));
      expect(copy).toMatchObject({
        tenantId: target.tenantId,
        mimetype: 'image/png',
        deletedAt: null,
      });
      expect(copy!.id).not.toBe(original!.id);
      expect(copy!.publicToken).not.toBe(original!.publicToken);
      expect(copy!.objectKey).not.toBe(original!.objectKey);
      expect(original).toMatchObject({ agentId: source.agentId, deletedAt: null });
      const [imported] = await manualOf(target);
      expect(imported?.imageId).toBe(copy!.id);
    });

    it('apagar a imagem de origem depois não afeta a cópia', async () => {
      const { image, file } = await sourceWithImage();
      const target = await newTenantAgent('Destino');
      await transfer.import(target.tenantId, target.agentId, file);

      await images.discard(image.id);

      const [copy] = await db
        .select()
        .from(trainingImage)
        .where(eq(trainingImage.agentId, target.agentId));
      expect(copy!.deletedAt).toBeNull();
      expect(storage.objects.has(copy!.objectKey)).toBe(true);
      expect(await images.readPublic(copy!.publicToken)).not.toBeNull();
    });

    it('imagem apagada na origem: texto criado sem imagem e com aviso', async () => {
      const { image, file } = await sourceWithImage();
      await images.discard(image.id);
      const target = await newTenantAgent('Destino');

      const result = await transfer.import(target.tenantId, target.agentId, file);

      expect(result.items[0]).toMatchObject({
        status: 'CREATED',
        warnings: [{ code: 'IMAGE_NOT_FOUND' }],
      });
      expect((await manualOf(target))[0]?.imageId).toBeNull();
    });

    it.each([
      ['de outro site', 'https://exemplo.com/public/training-images/abc'],
      ['de outro ambiente', 'https://staging.gptmaker.test/public/training-images/abc'],
      ['de outro caminho', `${API}/app/agents/x/imagem`],
      ['interna', 'http://169.254.169.254/latest/meta-data'],
      [
        'com userinfo que imita o host',
        'https://api.gptmaker.test@evil.example/public/training-images/abc',
      ],
    ])('endereço %s não é acessado: texto criado e aviso', async (_nome, imageUrl) => {
      const target = await newTenantAgent('Destino');

      const result = await transfer.import(target.tenantId, target.agentId, {
        version: 1,
        trainings: [{ type: 'TEXT', text: 'Tabela', imageUrl }],
      });

      expect(result.items[0]).toMatchObject({
        status: 'CREATED',
        warnings: [{ code: 'IMAGE_URL_NOT_SUPPORTED' }],
      });
      expect(storage.reads).toBe(0);
      expect(await db.select().from(trainingImage)).toHaveLength(0);
    });

    it('caminho disfarçado (%2F) é só um token que não existe: nada é lido do storage', async () => {
      const target = await newTenantAgent('Destino');

      const result = await transfer.import(target.tenantId, target.agentId, {
        version: 1,
        trainings: [
          {
            type: 'TEXT',
            text: 'Tabela',
            imageUrl: `${API}/public/training-images/..%2F..%2Fadmin`,
          },
        ],
      });

      expect(result.items[0]).toMatchObject({
        status: 'CREATED',
        warnings: [{ code: 'IMAGE_NOT_FOUND' }],
      });
      expect(storage.reads).toBe(0);
    });

    it('arquivo que não é imagem no storage: texto criado e aviso, sem cópia', async () => {
      const { image, file } = await sourceWithImage();
      const [row] = await db.select().from(trainingImage).where(eq(trainingImage.id, image.id));
      storage.objects.set(row!.objectKey, {
        ...storage.objects.get(row!.objectKey)!,
        body: Buffer.from('não sou imagem'),
      });
      const target = await newTenantAgent('Destino');

      const result = await transfer.import(target.tenantId, target.agentId, file);

      expect(result.items[0]).toMatchObject({
        status: 'CREATED',
        warnings: [{ code: 'IMAGE_INVALID' }],
      });
      expect(
        await db.select().from(trainingImage).where(eq(trainingImage.agentId, target.agentId)),
      ).toHaveLength(0);
    });

    it('cota do plano sem espaço: texto criado sem imagem e aviso', async () => {
      const { file } = await sourceWithImage();
      const target = await newTenantAgent('Destino');
      const planSpaId = `plan-${randomUUID()}`;
      await db.insert(planEntitlement).values({
        planSpaId,
        planType: 'subscription',
        creditsPerCycle: 1000,
        maxTrainings: 10,
        maxDocumentStorageMb: 0,
      });
      await db.insert(subscriptionState).values({
        tenantId: target.tenantId,
        subscriptionId: `sub-${randomUUID()}`,
        status: 'active',
        modality: 'stripe',
        planId: planSpaId,
        version: 1,
      });

      const result = await transfer.import(target.tenantId, target.agentId, file);

      expect(result.items[0]).toMatchObject({
        status: 'CREATED',
        warnings: [{ code: 'IMAGE_QUOTA' }],
      });
    });
  });
});
