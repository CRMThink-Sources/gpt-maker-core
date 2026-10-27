import { randomBytes, randomUUID } from 'node:crypto';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { FunctionAnswers } from '@gptmaker/contracts';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AgentFunctionService } from '../../src/modules/agent-functions/agent-function.service';
import { FunctionCatalog } from '../../src/modules/agent-functions/function-catalog.service';
import {
  FunctionTransferTargets,
  TRANSFER_TARGET_GONE_REASON,
} from '../../src/modules/agent-functions/function-transfer-targets';
import { FunctionPublisher } from '../../src/modules/agent-functions/function-publisher';
import { seedAgentFunctions } from '../../src/modules/agent-functions/function-seed';
import { FunctionTrainingPolicy } from '../../src/modules/agent-functions/function-training-policy';
import { AgentAccessPolicy } from '../../src/modules/agents/agent-access.policy';
import { AgentEvents } from '../../src/modules/agents/agent-events';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { AgentService } from '../../src/modules/agents/agent.service';
import type { CrmAccessService } from '../../src/modules/crm-tools/crm-access.service';
import type { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { TenantAgentLimitService } from '../../src/modules/gptmaker/tenant-agent-limit.service';
import { IntentionService } from '../../src/modules/intentions/intention.service';
import { ModelCatalogService } from '../../src/modules/models/model-catalog.service';
import { PaymentsOutbox } from '../../src/modules/payments/payments-outbox';
import { TenantService } from '../../src/modules/tenancy/tenant.service';
import type { ObjectStorage } from '../../src/shared/storage/object-storage';
import { TrainingService } from '../../src/modules/training/training.service';
import { TrainingSyncService } from '../../src/modules/training/training-sync.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { DomainError } from '../../src/shared/http/api-exception.filter';
import { FakeGptMaker } from '../support/fake-gptmaker';
import { testPool } from '../support/postgres';

const {
  agent,
  agentFunctionConfig,
  agentFunctionTemplate,
  agentIntention,
  agentManagedResource,
  aiModel,
  tenant,
  training,
} = schema;

const ITEM_A = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const ITEM_B = '1b9e4d2c-8f3a-4e5b-a6c7-d8e9f0a1b2c3';
const ITEM_C = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';

/** Respostas completas do SDR do seed (blocos comum, registro, dúvida e transferir). */
const sdrAnswers = (extra: FunctionAnswers = {}): FunctionAnswers => ({
  'empresa.nome': 'CRMThink',
  'empresa.descricao': 'Implantação de Bitrix24 para times comerciais.',
  'comum.tom': 'normal',
  'comum.emojis': 'nao',
  'registro.onde': 'conversa',
  'duvida.depois': 'transferir',
  'sdr.perfil_ideal': 'Empresas com time comercial',
  'sdr.perguntas': ['Quantos vendedores?', 'Usa CRM hoje?'],
  'sdr.criterio': '5 vendedores ou mais',
  'sdr.qualificado': 'transferir',
  'sdr.nao_qualificado': 'encerrar',
  'sdr.preco': 'nao',
  'sdr.cliente_atual': 'transferir',
  'base.produtos': [
    { itemKey: ITEM_A, values: { nome: 'Plano Pro', descricao: 'CRM completo' } },
    { itemKey: ITEM_B, values: { nome: 'Plano Start', descricao: 'Para começar' } },
  ],
  ...extra,
});

// Publicação da função do agente (spec agent-function-configuration; tarefas 5.1 a 5.5).
describe('publicação da função do agente', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  const fake = new FakeGptMaker();
  let catalog: FunctionCatalog;
  let functions: AgentFunctionService;
  let trainingService: TrainingService;
  let trainingSync: TrainingSyncService;
  let publisher: FunctionPublisher;
  let queued: Array<{ agentId: string }>;
  let owner: { tenantId: string };
  let maxTrainings: number;
  let crmCalls: Array<[string, string]>;
  let crmFailure: Error | null;
  let events: AgentEvents;

  async function rejection(promise: Promise<unknown>): Promise<DomainError> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }

  const configOf = async (agentId: string) =>
    (
      await db.select().from(agentFunctionConfig).where(eq(agentFunctionConfig.agentId, agentId))
    )[0]!;
  const liveTrainings = (agentId: string) =>
    db
      .select()
      .from(training)
      .where(and(eq(training.agentId, agentId), isNull(training.deletedAt)));
  const resources = (agentId: string) =>
    db.select().from(agentManagedResource).where(eq(agentManagedResource.agentId, agentId));

  async function createAgent(answers = sdrAnswers()) {
    const view = await functions.create(owner, { name: 'Ana', functionCode: 'SDR', answers });
    expect(await publisher.run(view.id)).toBe('DONE');
    fake.calls = [];
    queued = [];
    return view;
  }

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());

    const client = fake as unknown as GptMakerClient;
    const env = {
      API_PUBLIC_URL: 'https://api.test',
      TENANT_AGENT_LIMIT: 5,
      get TRAINING_DEFAULT_MAX_TRAININGS() {
        return maxTrainings;
      },
      TRAINING_DEFAULT_MAX_STORAGE_MB: 50,
    } as Env;
    const repository = new AgentRepository(db);
    events = new AgentEvents();
    const agents = new AgentService(
      repository,
      new TenantAgentLimitService(db, env),
      new ModelCatalogService(db, client),
      client,
      new PaymentsOutbox(db),
      new AgentAccessPolicy(db),
      events,
      db,
      redis,
      env,
    );
    const trainings = new TrainingService(
      repository,
      client,
      undefined as unknown as ObjectStorage,
      db,
      redis,
      env,
    );
    const intentions = new IntentionService(repository, client, events, db, redis, env);
    trainingService = trainings;
    trainingSync = new TrainingSyncService(
      client,
      undefined as unknown as ObjectStorage,
      db,
      redis,
    );
    new FunctionTrainingPolicy(trainings, trainingSync, db).onModuleInit();
    new FunctionTransferTargets(events, db).onModuleInit();
    catalog = new FunctionCatalog(db);
    publisher = new FunctionPublisher(
      catalog,
      agents,
      repository,
      trainings,
      intentions,
      {
        ensureEnabled: async (tenantId: string, agentId: string) => {
          crmCalls.push([tenantId, agentId]);
          if (crmFailure) throw crmFailure;
        },
      } as unknown as CrmAccessService,
      client,
      db,
      redis,
    );
    const amqp = {
      publish: async (_exchange: string, _key: string, message: { agentId: string }) => {
        queued.push(message);
        return true;
      },
    } as unknown as AmqpConnection;
    functions = new AgentFunctionService(
      catalog,
      agents,
      repository,
      trainings,
      new TenantService(db),
      amqp,
      db,
    );
    await db.insert(aiModel).values({
      code: 'GPT_5_MINI',
      displayName: 'GPT-5 Mini',
      creditsPerResponse: 1,
      isDefault: true,
    });
    await seedAgentFunctions(db, catalog);
  });

  beforeEach(async () => {
    fake.reset();
    queued = [];
    maxTrainings = 20;
    crmCalls = [];
    crmFailure = null;
    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    owner = { tenantId: row!.id };
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  describe('criação', () => {
    it('cria o agente compilado e a publicação aplica base e intenções', async () => {
      const view = await functions.create(owner, {
        name: 'Ana',
        functionCode: 'SDR',
        answers: sdrAnswers(),
      });

      expect(view).toMatchObject({ name: 'Ana', type: 'SALE', communicationType: 'NORMAL' });
      expect(view.behavior).toContain('Você é Ana, da CRMThink.');
      expect(view.settings).toMatchObject({
        enabledHumanTransfer: true,
        limitSubjects: true,
        enabledEmoji: false,
      });
      const remote = [...fake.agents.values()][0]!;
      expect(remote.settings).toMatchObject({
        enabledEmoji: false,
        limitSubjects: true,
        prefferModel: 'GPT_5_MINI',
      });
      expect(queued).toEqual([{ agentId: view.id, tenantId: owner.tenantId }]);
      expect(await configOf(view.id)).toMatchObject({
        publicationStatus: 'PENDING',
        versionId: null,
      });

      expect(await publisher.run(view.id)).toBe('DONE');

      const config = await configOf(view.id);
      expect(config).toMatchObject({
        publicationStatus: 'IDLE',
        publicationTarget: null,
        mode: 'SIMPLE',
      });
      expect(config.versionId).not.toBeNull();
      const rows = await liveTrainings(view.id);
      expect(rows.map((row) => [row.content, row.managed])).toEqual([
        ['Produto ou serviço: Plano Pro\nCRM completo', true],
        ['Produto ou serviço: Plano Start\nPara começar', true],
      ]);
      expect(rows.every((row) => row.gptmakerTrainingId)).toBe(true);
      const intentions = await db
        .select({ name: agentIntention.name, managed: agentIntention.managed })
        .from(agentIntention)
        .where(eq(agentIntention.agentId, view.id));
      expect(intentions.map((row) => row.name).sort()).toEqual([
        'Registrar dúvida',
        'Registrar qualificação',
        'Transferir para atendente',
      ]);
      expect(intentions.every((row) => row.managed)).toBe(true);
      expect((await resources(view.id)).map((row) => row.key).sort()).toEqual([
        ...[`base.produtos:${ITEM_A}`, `base.produtos:${ITEM_B}`].sort(),
        'qualificacao',
        'registrar_duvida',
        'transferir_atendente',
      ]);
      // O perfil já foi na criação: a publicação não reenvia comportamento.
      expect(fake.count('agent.update')).toBe(0);
    });

    it('respostas inválidas: recusa sem criar agente', async () => {
      const error = await rejection(
        functions.create(owner, {
          name: 'Ana',
          functionCode: 'SDR',
          answers: sdrAnswers({ 'sdr.perguntas': [] }),
        }),
      );
      expect(error.code).toBe('FUNCTION_ANSWERS_INVALID');
      expect(error.details).toEqual({
        issues: [{ field: 'sdr.perguntas', message: 'campo obrigatório' }],
      });
      expect(fake.count('agent.create')).toBe(0);
    });

    it('função sem versão publicada: recusa sem chamar o GPTMaker', async () => {
      const error = await rejection(
        functions.create(owner, { name: 'Ana', functionCode: 'INEXISTENTE', answers: {} }),
      );
      expect(error.code).toBe('FUNCTION_NOT_AVAILABLE');
      expect(fake.calls).toEqual([]);
    });

    it('limite do plano: recusa antes de criar', async () => {
      maxTrainings = 1;
      const error = await rejection(
        functions.create(owner, { name: 'Ana', functionCode: 'SDR', answers: sdrAnswers() }),
      );
      expect(error.code).toBe('PLAN_TRAINING_LIMIT');
      expect(fake.count('agent.create')).toBe(0);
    });
  });

  describe('republicação', () => {
    it('rascunho não muda o agente publicado', async () => {
      const view = await createAgent();
      await functions.saveDraft(owner.tenantId, view.id, { answers: { 'sdr.preco': 'base' } });
      expect((await configOf(view.id)).draftAnswers).toEqual({ 'sdr.preco': 'base' });
      expect(fake.calls).toEqual([]);
      const error = await rejection(
        functions.saveDraft(owner.tenantId, view.id, {
          answers: { 'sdr.perguntas': ['a', 'b', 'c', 'd', 'e', 'f'] },
        }),
      );
      expect(error.code).toBe('FUNCTION_ANSWERS_INVALID');
    });

    it('item editado atualiza só o seu treinamento', async () => {
      const view = await createAgent();
      const answers = sdrAnswers({
        'base.produtos': [
          { itemKey: ITEM_A, values: { nome: 'Plano Pro', descricao: 'CRM completo com IA' } },
          { itemKey: ITEM_B, values: { nome: 'Plano Start', descricao: 'Para começar' } },
        ],
      });

      const preview = await functions.preview(owner.tenantId, view.id, { answers });
      expect(preview.plan.trainings.update.map((item) => item.key)).toEqual([
        `base.produtos:${ITEM_A}`,
      ]);
      expect(preview.plan.behavior.changed).toBe(false);

      expect(await functions.publish(owner.tenantId, view.id, { answers })).toEqual({
        status: 'PENDING',
      });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect(fake.count('training.update')).toBe(1);
      expect(fake.count('training.create')).toBe(0);
      expect(fake.count('agent.update')).toBe(0);
      expect((await liveTrainings(view.id)).map((row) => row.content)).toContain(
        'Produto ou serviço: Plano Pro\nCRM completo com IA',
      );
    });

    it('nada mudou: não chama o GPTMaker nem enfileira', async () => {
      const view = await createAgent();
      expect(await functions.publish(owner.tenantId, view.id, {})).toEqual({ status: 'NOTHING' });
      expect(queued).toEqual([]);
      expect(fake.calls).toEqual([]);
    });

    it('escolha diferente muda comportamento, tom e intenção', async () => {
      const view = await createAgent();
      const answers = sdrAnswers({ 'comum.tom': 'formal', 'sdr.qualificado': 'registrar' });
      await functions.publish(owner.tenantId, view.id, { answers });
      expect(await publisher.run(view.id)).toBe('DONE');

      expect(fake.count('agent.update')).toBe(1);
      expect(fake.count('intention.update')).toBe(1);
      const [row] = await db.select().from(agent).where(eq(agent.id, view.id));
      expect(row).toMatchObject({ communicationType: 'FORMAL' });
      expect(row!.behavior).toContain('um consultor vai entrar em contato em breve');
    });

    it('falha parcial: repetir não duplica os treinamentos', async () => {
      const view = await createAgent();
      const answers = sdrAnswers({
        'base.produtos': [
          { itemKey: ITEM_A, values: { nome: 'Plano Pro', descricao: 'CRM completo' } },
          { itemKey: ITEM_B, values: { nome: 'Plano Start', descricao: 'Para começar' } },
          { itemKey: ITEM_C, values: { nome: 'Plano Max', descricao: 'Tudo incluso' } },
        ],
        'base.faq': [
          {
            itemKey: randomUUID(),
            values: { pergunta: 'Tem teste grátis?', resposta: 'Sim, 7 dias.' },
          },
        ],
      });
      fake.failOn('training.create', { skip: 1 });
      await functions.publish(owner.tenantId, view.id, { answers });
      expect(await publisher.run(view.id)).toBe('FAILED');
      const failed = await configOf(view.id);
      expect(failed.publicationStatus).toBe('FAILED');
      expect(failed.publicationError).toContain('GPTMAKER_UNAVAILABLE');
      expect(await liveTrainings(view.id)).toHaveLength(3);

      await functions.retry(owner.tenantId, view.id);
      expect(await publisher.run(view.id)).toBe('DONE');
      expect(await liveTrainings(view.id)).toHaveLength(4);
      expect(
        [...fake.trainings.values()].filter((item) => item.text?.includes('Plano Max')),
      ).toHaveLength(1);
      expect((await configOf(view.id)).publicationStatus).toBe('IDLE');
    });

    it('treinamento gerado que some do GPTMaker: marca para republicar e a publicação recria', async () => {
      const view = await createAgent();
      const [row] = await db.select().from(agent).where(eq(agent.id, view.id));
      const [gone] = await liveTrainings(view.id);
      fake.trainings.delete(gone!.gptmakerTrainingId!);
      await db
        .update(training)
        .set({ createdAt: new Date(Date.now() - 24 * 3600_000) })
        .where(eq(training.id, gone!.id));
      const owner2 = {
        id: view.id,
        tenantId: owner.tenantId,
        gptmakerAgentId: row!.gptmakerAgentId,
      };
      // A ausência só é confirmada na segunda passada.
      await trainingSync.syncAgent(owner2);
      await trainingSync.syncAgent(owner2);

      const marked = await functions.view(owner.tenantId, view.id);
      expect(marked.needsRepublishReason).toContain('sumiu do GPTMaker');
      expect((await resources(view.id)).map((r) => r.trainingId)).not.toContain(gone!.id);

      fake.calls = [];
      expect(await functions.publish(owner.tenantId, view.id, {})).toEqual({ status: 'PENDING' });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect(fake.count('training.create')).toBe(1);
      expect(await liveTrainings(view.id)).toHaveLength(2);
      expect((await functions.view(owner.tenantId, view.id)).needsRepublishReason).toBeNull();
    });

    it('publicação em andamento: recusa outra', async () => {
      const view = await createAgent();
      await functions.publish(owner.tenantId, view.id, {
        answers: sdrAnswers({ 'sdr.preco': 'base' }),
      });
      const error = await rejection(functions.publish(owner.tenantId, view.id, {}));
      expect(error.code).toBe('FUNCTION_PUBLICATION_PENDING');
    });

    it('limite do plano na republicação', async () => {
      const view = await createAgent();
      maxTrainings = 2;
      const error = await rejection(
        functions.publish(owner.tenantId, view.id, {
          answers: sdrAnswers({
            'base.faq': [{ itemKey: randomUUID(), values: { pergunta: 'P?', resposta: 'R.' } }],
          }),
        }),
      );
      expect(error.code).toBe('PLAN_TRAINING_LIMIT');
    });
  });

  describe('versões do template', () => {
    it('versão nova não muda o agente; republicar usa a mais recente e pede campo novo', async () => {
      const view = await createAgent();
      const before = await functions.view(owner.tenantId, view.id);
      expect(before).toMatchObject({ version: 1, latestVersion: 1 });

      // Versão 2: texto novo e um campo obrigatório novo.
      const [template] = await db
        .select()
        .from(agentFunctionTemplate)
        .where(eq(agentFunctionTemplate.code, 'SDR'));
      const draft = template!.draft;
      await catalog.saveTemplateDraft('SDR', {
        draft: {
          ...draft,
          // O SDR está no limite do orçamento: o campo novo pede espaço de outro.
          fields: [
            ...draft.fields.map((field) =>
              field.id === 'sdr.perfil_ideal' && field.kind === 'TEXT'
                ? { ...field, maxLength: 120 }
                : field,
            ),
            {
              kind: 'TEXT',
              id: 'sdr.horario',
              label: 'Horário',
              required: true,
              maxLength: 60,
              multiline: false,
            },
          ],
          behavior: draft.behavior.replace('PREÇO', 'HORÁRIO\n{{sdr.horario}}\n\nPREÇO'),
        },
      });
      await catalog.publishTemplate('SDR', null);

      const after = await functions.view(owner.tenantId, view.id);
      expect(after).toMatchObject({ version: 1, latestVersion: 2 });
      expect(fake.calls).toEqual([]);

      const preview = await functions.preview(owner.tenantId, view.id, {});
      expect(preview.issues).toEqual([{ field: 'sdr.horario', message: 'campo obrigatório' }]);
      expect(preview.version).toEqual({ from: 1, to: 2 });
      const error = await rejection(functions.publish(owner.tenantId, view.id, {}));
      expect(error.code).toBe('FUNCTION_ANSWERS_INVALID');

      await functions.publish(owner.tenantId, view.id, {
        answers: sdrAnswers({ 'sdr.horario': 'Seg a sex, 9h às 18h' }),
      });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect(await functions.view(owner.tenantId, view.id)).toMatchObject({
        version: 2,
        latestVersion: 2,
      });
      const [row] = await db.select().from(agent).where(eq(agent.id, view.id));
      expect(row!.behavior).toContain('HORÁRIO\nSeg a sex, 9h às 18h');

      // Os testes seguintes criam agentes com a versão mais recente: volta ao conteúdo da 1.
      await catalog.restoreVersion('SDR', 1, null);
    });

    it('a prévia mostra pelo nome a intenção que a versão nova remove', async () => {
      const view = await createAgent();
      const [template] = await db
        .select()
        .from(agentFunctionTemplate)
        .where(eq(agentFunctionTemplate.code, 'SDR'));
      const draft = template!.draft;
      const removed = draft.intentions.find((intention) => intention.key === 'qualificacao')!;
      await catalog.saveTemplateDraft('SDR', {
        draft: {
          ...draft,
          intentions: draft.intentions.filter((intention) => intention.key !== 'qualificacao'),
        },
      });
      await catalog.publishTemplate('SDR', null);

      const preview = await functions.preview(owner.tenantId, view.id, {});
      expect(preview.plan.intentions.remove).toEqual(['qualificacao']);
      expect(preview.removedIntentions).toEqual({ qualificacao: removed.name });

      // O rascunho do SDR vem do teste anterior (restaurar não muda o rascunho): volta à 1.
      await catalog.restoreVersion('SDR', 1, null);
    });
  });

  describe('acesso ao CRM', () => {
    it('função que exige o CRM ativa o acesso na publicação; sem conectar, a publicação falha', async () => {
      const plain = await createAgent();
      expect(crmCalls).toEqual([]);

      const [template] = await db
        .select()
        .from(agentFunctionTemplate)
        .where(eq(agentFunctionTemplate.code, 'SDR'));
      await catalog.saveTemplateDraft('SDR', { draft: { ...template!.draft, crmAccess: true } });
      await catalog.publishTemplate('SDR', null);
      // O rascunho ainda tem o campo do teste de versões.
      const answers = sdrAnswers({ 'sdr.horario': 'Seg a sex' });

      const view = await functions.create(owner, { name: 'Ana', functionCode: 'SDR', answers });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect(crmCalls).toEqual([[owner.tenantId, view.id]]);

      crmFailure = new DomainError('CRM_ACCESS_FAILED', 'Não foi possível ativar o acesso ao CRM');
      await functions.publish(owner.tenantId, plain.id, { answers });
      expect(await publisher.run(plain.id)).toBe('FAILED');
      expect((await configOf(plain.id)).publicationError).toContain('CRM_ACCESS_FAILED');

      await catalog.saveTemplateDraft('SDR', { draft: template!.draft });
      await catalog.restoreVersion('SDR', 1, null);
    });
  });

  describe('função inativa', () => {
    it('sai da criação, os agentes existentes seguem e não pode ser excluída', async () => {
      const view = await createAgent();
      await catalog.setActive('SDR', false);
      try {
        expect((await functions.listFunctions(owner.tenantId)).map((fn) => fn.code)).not.toContain(
          'SDR',
        );
        const refused = await rejection(
          functions.create(owner, { name: 'Bia', functionCode: 'SDR', answers: sdrAnswers() }),
        );
        expect(refused.code).toBe('FUNCTION_NOT_AVAILABLE');

        // O agente que já usa a função continua publicando.
        await functions.publish(owner.tenantId, view.id, {
          answers: sdrAnswers({ 'sdr.preco': 'base' }),
        });
        expect(await publisher.run(view.id)).toBe('DONE');

        const inUse = await rejection(catalog.remove('SDR'));
        expect(inUse.code).toBe('FUNCTION_IN_USE');
      } finally {
        await catalog.setActive('SDR', true);
      }
      expect((await functions.listFunctions(owner.tenantId)).map((fn) => fn.code)).toContain('SDR');
    });
  });

  describe('função restrita a portais', () => {
    it('só os portais da lista a escolhem; os agentes existentes seguem em qualquer portal', async () => {
      const view = await createAgent();
      const code = randomBytes(3).toString('hex');
      const [other] = await db
        .insert(tenant)
        .values({
          installationId: code,
          memberId: code,
          domain: `${code}.b24.com`,
          tenantCode: code,
        })
        .returning();
      const codes = async (tenantId: string) =>
        (await functions.listFunctions(tenantId)).map((fn) => fn.code);

      const restricted = await catalog.setTenants('SDR', { tenantIds: [other!.id] });
      try {
        expect(restricted.tenants).toEqual([{ id: other!.id, domain: other!.domain }]);
        expect(await codes(other!.id)).toContain('SDR');
        expect(await codes(owner.tenantId)).not.toContain('SDR');
        // As outras funções continuam para todos.
        expect(await codes(owner.tenantId)).toContain('SUPPORT');
        const refused = await rejection(
          functions.create(owner, { name: 'Bia', functionCode: 'SDR', answers: sdrAnswers() }),
        );
        expect(refused.code).toBe('FUNCTION_NOT_AVAILABLE');
        expect((await rejection(functions.functionForm(owner.tenantId, 'SDR'))).code).toBe(
          'FUNCTION_NOT_AVAILABLE',
        );

        // O agente deste portal, criado antes da restrição, continua publicando.
        await functions.publish(owner.tenantId, view.id, {
          answers: sdrAnswers({ 'sdr.preco': 'base' }),
        });
        expect(await publisher.run(view.id)).toBe('DONE');

        const unknown = await rejection(catalog.setTenants('SDR', { tenantIds: [randomUUID()] }));
        expect(unknown.code).toBe('TENANT_NOT_FOUND');
      } finally {
        await catalog.setTenants('SDR', { tenantIds: [] });
      }
      expect((await catalog.getTemplate('SDR')).tenants).toEqual([]);
      expect(await codes(owner.tenantId)).toContain('SDR');
    });
  });

  describe('transferência entre agentes (D17)', () => {
    /** Função mínima com uma transferência ligada a uma escolha. */
    const TRANSFER_DRAFT = {
      agentType: 'SUPPORT' as const,
      settings: {},
      profile: { jobName: '', jobDescription: '', jobSite: '' },
      blocks: [],
      crmAccess: false,
      fields: [
        {
          kind: 'CHOICE' as const,
          id: 'transf.orcamento',
          label: 'Pedido de orçamento',
          required: true,
          options: [
            { value: 'aqui', label: 'Atender aqui', snippet: 'Atenda o orçamento.' },
            {
              value: 'agente',
              label: 'Passar para outro agente',
              snippet: 'Orçamentos vão para outro agente.',
              dependents: [
                { kind: 'AGENT' as const, id: 'transf.agente', label: 'Agente', required: true },
              ],
            },
          ],
        },
      ],
      behavior: 'Você é {{agente.nome}}. {{transf.orcamento}}',
      intentions: [],
      transfers: [
        {
          key: 'orcamento',
          when: { field: 'transf.orcamento', in: ['agente'] },
          agent: '{{transf.agente}}',
          instructions: 'Quando o cliente pedir orçamento.',
          returnOnFinish: true,
        },
      ],
    };

    beforeAll(async () => {
      await catalog.createTemplate({
        code: 'TRANSF',
        name: 'Com transferência',
        description: 'Teste da transferência entre agentes.',
        draft: TRANSFER_DRAFT,
      });
      await catalog.publishTemplate('TRANSF', null);
    });

    const gmOf = async (agentId: string) =>
      (await db.select().from(agent).where(eq(agent.id, agentId)))[0]!.gptmakerAgentId;

    async function createWithTransfer(answers: FunctionAnswers) {
      const view = await functions.create(owner, { name: 'Bia', functionCode: 'TRANSF', answers });
      return { view, outcome: await publisher.run(view.id) };
    }

    it('cria, atualiza e remove a regra no GPTMaker', async () => {
      const target = await createAgent();
      const other = await createAgent();
      const { view, outcome } = await createWithTransfer({
        'transf.orcamento': 'agente',
        'transf.agente': target.id,
      });
      expect(outcome).toBe('DONE');
      const source = await gmOf(view.id);
      expect([...fake.transferRules.values()]).toEqual([
        {
          id: expect.any(String),
          agentId: source,
          body: {
            type: 'AGENT',
            agentId: await gmOf(target.id),
            instructions: 'Quando o cliente pedir orçamento.',
            returnOnFinish: true,
          },
        },
      ]);
      expect((await resources(view.id)).filter((r) => r.kind === 'TRANSFER_RULE')).toHaveLength(1);

      fake.calls = [];
      await functions.publish(owner.tenantId, view.id, {
        answers: { 'transf.orcamento': 'agente', 'transf.agente': other.id },
      });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect(fake.count('transferRule.update')).toBe(1);
      expect([...fake.transferRules.values()][0]!.body.agentId).toBe(await gmOf(other.id));

      await functions.publish(owner.tenantId, view.id, {
        answers: { 'transf.orcamento': 'aqui' },
      });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect(fake.transferRules.size).toBe(0);
      expect((await resources(view.id)).filter((r) => r.kind === 'TRANSFER_RULE')).toEqual([]);
    });

    it('remover o agente de destino pede para republicar quem o usa', async () => {
      const target = await createAgent();
      const { view } = await createWithTransfer({
        'transf.orcamento': 'agente',
        'transf.agente': target.id,
      });
      await events.emit({ agentId: target.id, tenantId: owner.tenantId, kind: 'removed' });
      expect((await configOf(view.id)).needsRepublishReason).toBe(TRANSFER_TARGET_GONE_REASON);
      expect((await configOf(target.id)).needsRepublishReason).toBeNull();
    });

    it('destino removido: a publicação falha nomeando o campo e não cria regra', async () => {
      const target = await createAgent();
      await db.update(agent).set({ deletedAt: new Date() }).where(eq(agent.id, target.id));
      const { view, outcome } = await createWithTransfer({
        'transf.orcamento': 'agente',
        'transf.agente': target.id,
      });
      expect(outcome).toBe('FAILED');
      expect((await configOf(view.id)).publicationError).toContain(
        'FUNCTION_TRANSFER_AGENT_INVALID: Escolha outro agente em "Agente"',
      );
      expect(fake.transferRules.size).toBe(0);
    });

    it('destino de outro portal é recusado', async () => {
      const target = await createAgent();
      const code = randomBytes(3).toString('hex');
      const [other] = await db
        .insert(tenant)
        .values({
          installationId: code,
          memberId: code,
          domain: `${code}.b24.com`,
          tenantCode: code,
        })
        .returning();
      await db.update(agent).set({ tenantId: other!.id }).where(eq(agent.id, target.id));
      const { outcome } = await createWithTransfer({
        'transf.orcamento': 'agente',
        'transf.agente': target.id,
      });
      expect(outcome).toBe('FAILED');
      expect(fake.transferRules.size).toBe(0);
    });
  });

  describe('modo avançado', () => {
    const site = { type: 'WEBSITE' as const, url: 'https://loja.com.br/faq' };

    it('ligar libera instruções adicionais e site; desligar remove os dois', async () => {
      const view = await createAgent();
      expect((await rejection(trainingService.create(owner.tenantId, view.id, site))).code).toBe(
        'TRAINING_ADVANCED_ONLY',
      );

      await functions.publish(owner.tenantId, view.id, {
        mode: 'ADVANCED',
        additionalInstructions: 'Sempre ofereça o e-book gratuito.',
      });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect(await configOf(view.id)).toMatchObject({ mode: 'ADVANCED' });
      const [advanced] = await db.select().from(agent).where(eq(agent.id, view.id));
      expect(advanced!.behavior).toMatch(/Sempre ofereça o e-book gratuito.$/);
      // Texto manual nunca: a base vem do formulário, em qualquer modo.
      expect(
        (
          await rejection(
            trainingService.create(owner.tenantId, view.id, { type: 'TEXT', text: 'x' }),
          )
        ).code,
      ).toBe('TRAINING_FORM_ONLY');
      const created = await trainingService.create(owner.tenantId, view.id, site);
      expect(created).toMatchObject({ type: 'WEBSITE', managed: false });

      const preview = await functions.preview(owner.tenantId, view.id, { mode: 'SIMPLE' });
      expect(preview.mediaToRemove).toEqual([
        { id: created.id, type: 'WEBSITE', url: 'https://loja.com.br/faq' },
      ]);
      await functions.publish(owner.tenantId, view.id, { mode: 'SIMPLE' });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect((await liveTrainings(view.id)).map((row) => row.type)).toEqual(['TEXT', 'TEXT']);
      const [simple] = await db.select().from(agent).where(eq(agent.id, view.id));
      expect(simple!.behavior).not.toContain('e-book');
    });

    it('instruções adicionais acima do limite: recusa', async () => {
      const view = await createAgent();
      const error = await rejection(
        functions.publish(owner.tenantId, view.id, {
          mode: 'ADVANCED',
          additionalInstructions: 'x'.repeat(401),
        }),
      );
      expect(error.code).toBe('FUNCTION_COMPILE_FAILED');
    });
  });

  describe('assumir controle', () => {
    it('só parceiro assume', async () => {
      const view = await createAgent();
      expect((await functions.view(owner.tenantId, view.id)).canTakeOver).toBe(false);
      const error = await rejection(
        functions.publish(owner.tenantId, view.id, { mode: 'TAKEN_OVER' }),
      );
      expect(error.code).toBe('FUNCTION_TAKE_OVER_NOT_ALLOWED');
    });

    it('site e vídeo são do modo avançado: saem ao assumir o controle', async () => {
      await db.update(tenant).set({ isPartner: true }).where(eq(tenant.id, owner.tenantId));
      const view = await createAgent();
      await functions.publish(owner.tenantId, view.id, { mode: 'ADVANCED' });
      expect(await publisher.run(view.id)).toBe('DONE');
      const site = await trainingService.create(owner.tenantId, view.id, {
        type: 'WEBSITE',
        url: 'https://loja.com.br/faq',
      });

      const preview = await functions.preview(owner.tenantId, view.id, { mode: 'TAKEN_OVER' });
      expect(preview.mediaToRemove.map((media) => media.id)).toEqual([site.id]);
      await functions.publish(owner.tenantId, view.id, {
        mode: 'TAKEN_OVER',
        takenOverBehavior: 'Texto livre do parceiro.',
      });
      expect(await publisher.run(view.id)).toBe('DONE');
      expect((await liveTrainings(view.id)).map((row) => row.type)).toEqual(['TEXT', 'TEXT']);
      const refused = await rejection(
        trainingService.create(owner.tenantId, view.id, {
          type: 'VIDEO',
          url: 'https://youtu.be/x',
        }),
      );
      expect(refused.code).toBe('TRAINING_ADVANCED_ONLY');
    });

    it('parceiro edita livre, fica sem aviso de versão e volta ao formulário', async () => {
      await db.update(tenant).set({ isPartner: true }).where(eq(tenant.id, owner.tenantId));
      const view = await createAgent();

      // Sem texto novo, parte do comportamento publicado.
      const start = await functions.preview(owner.tenantId, view.id, { mode: 'TAKEN_OVER' });
      expect(start.compiled.behavior).toContain('Você é Ana, da CRMThink.');

      await functions.publish(owner.tenantId, view.id, {
        mode: 'TAKEN_OVER',
        takenOverBehavior: 'Texto livre do parceiro.',
      });
      expect(await publisher.run(view.id)).toBe('DONE');
      const [taken] = await db.select().from(agent).where(eq(agent.id, view.id));
      expect(taken!.behavior).toBe('Texto livre do parceiro.');

      // Versão nova do template (o rascunho ficou com o campo do teste de versões).
      await catalog.restoreVersion('SDR', 1, null);
      expect(await functions.view(owner.tenantId, view.id)).toMatchObject({
        mode: 'TAKEN_OVER',
        takenOverBehavior: 'Texto livre do parceiro.',
        updateAvailable: false,
      });

      const tooLong = await rejection(
        functions.publish(owner.tenantId, view.id, { takenOverBehavior: 'y'.repeat(3001) }),
      );
      expect(tooLong.code).toBe('FUNCTION_COMPILE_FAILED');

      await functions.publish(owner.tenantId, view.id, { mode: 'SIMPLE' });
      expect(await publisher.run(view.id)).toBe('DONE');
      const back = await functions.view(owner.tenantId, view.id);
      expect(back).toMatchObject({
        mode: 'SIMPLE',
        takenOverBehavior: null,
        updateAvailable: false,
      });
      expect(back.version).toBe(back.latestVersion);
      const [simple] = await db.select().from(agent).where(eq(agent.id, view.id));
      expect(simple!.behavior).toContain('Você é Ana, da CRMThink.');
    });
  });
});
