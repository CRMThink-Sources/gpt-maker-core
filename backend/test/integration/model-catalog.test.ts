import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { ModelCatalogService } from '../../src/modules/models/model-catalog.service';
import { SEED_DEFAULT_MODEL, SEED_MODELS, seedAiModels } from '../../src/modules/models/model-seed';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { WireMock } from '../support/wiremock';

const { agent, aiModel, aiModelCostHistory, planAllowedModel, planEntitlement, tenant } = schema;
const ACTOR = 'operator:test';

describe('catálogo de modelos', () => {
  let postgres: StartedPostgreSqlContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let catalog: ModelCatalogService;

  const errorOf = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

  function model(
    code: string,
    extra: { active?: boolean; isDefault?: boolean; cost?: number } = {},
  ) {
    return catalog.create({
      code,
      displayName: code,
      creditsPerResponse: extra.cost ?? 1,
      active: extra.active ?? true,
      isDefault: extra.isDefault ?? false,
      confirmUnknownCode: true,
    });
  }

  async function newAgent(
    modelId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'DELETED' | 'OUT_OF_SYNC' = 'ACTIVE',
  ) {
    const code = randomBytes(4).toString('hex');
    const [t] = await db
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
        tenantId: t!.id,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Bot',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        status,
        settings: { timezone: 'America/Sao_Paulo' },
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return row!;
  }

  async function newPlan(planSpaId = `plan-${randomUUID()}`) {
    await db
      .insert(planEntitlement)
      .values({ planSpaId, planType: 'subscription', creditsPerCycle: 1000 });
    return planSpaId;
  }

  beforeAll(async () => {
    [postgres, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      WireMock.start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
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
    catalog = new ModelCatalogService(db, client);
  });

  beforeEach(async () => {
    await wiremock.reset();
    await db.delete(planAllowedModel);
    await db.delete(planEntitlement);
    await db.delete(agent);
    await db.delete(aiModelCostHistory);
    await db.delete(aiModel);
  });

  afterAll(async () => {
    await pool?.end();
    await Promise.all([postgres?.stop(), wiremock?.stop()]);
  });

  describe('cadastro', () => {
    it('cria modelo com código conhecido sem confirmação', async () => {
      const row = await catalog.create({
        code: 'GPT_5_MINI',
        displayName: 'GPT-5 Mini',
        creditsPerResponse: 1,
      });
      expect(row).toMatchObject({ code: 'GPT_5_MINI', active: true, isDefault: false });
    });

    it('recusa código fora da lista conhecida sem confirmação', async () => {
      const error = await errorOf(
        catalog.create({ code: 'NOVO_MODELO', displayName: 'Novo', creditsPerResponse: 2 }),
      );
      expect(error).toMatchObject({ code: 'MODEL_CODE_UNKNOWN' });
      await expect(model('NOVO_MODELO')).resolves.toMatchObject({ code: 'NOVO_MODELO' });
    });

    it('recusa código duplicado e permite recadastrar um removido', async () => {
      const first = await model('GPT_5');
      await expect(errorOf(model('GPT_5'))).resolves.toMatchObject({
        code: 'MODEL_CODE_DUPLICATE',
      });
      await catalog.remove(first.id);
      await expect(model('GPT_5')).resolves.toMatchObject({ code: 'GPT_5' });
    });

    it('recusa custo não inteiro ou zero', async () => {
      await expect(errorOf(model('GPT_5', { cost: 0 }))).resolves.toBeInstanceOf(Error);
      await expect(
        errorOf(catalog.create({ code: 'GPT_5', displayName: 'x', creditsPerResponse: 1.5 })),
      ).resolves.toBeInstanceOf(Error);
    });

    it('mantém um único modelo padrão', async () => {
      const a = await model('GPT_5', { isDefault: true });
      const b = await model('GPT_5_MINI', { isDefault: true });
      expect((await catalog.get(a.id)).isDefault).toBe(false);
      expect((await catalog.get(b.id)).isDefault).toBe(true);
      await catalog.setDefault(a.id);
      expect((await catalog.get(a.id)).isDefault).toBe(true);
      expect((await catalog.get(b.id)).isDefault).toBe(false);
    });

    it('padrão precisa estar ativo e não pode ser inativado', async () => {
      const inactive = await model('GPT_5', { active: false });
      await expect(errorOf(catalog.setDefault(inactive.id))).resolves.toMatchObject({
        code: 'MODEL_INACTIVE',
      });
      const def = await model('GPT_5_MINI', { isDefault: true });
      await expect(errorOf(catalog.deactivate(def.id))).resolves.toMatchObject({
        code: 'MODEL_IS_DEFAULT',
      });
      await expect(errorOf(catalog.remove(def.id))).resolves.toMatchObject({
        code: 'MODEL_IS_DEFAULT',
      });
    });
  });

  describe('custo', () => {
    it('registra histórico com autor só quando o custo muda', async () => {
      const row = await model('GPT_5', { cost: 2 });
      await catalog.update(row.id, { displayName: 'GPT-5 novo' }, ACTOR);
      await catalog.update(row.id, { creditsPerResponse: 3 }, ACTOR);
      await catalog.update(row.id, { creditsPerResponse: 3 }, ACTOR);

      expect((await catalog.get(row.id)).creditsPerResponse).toBe(3);
      const history = await catalog.costHistory(row.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ previousCost: 2, newCost: 3, changedBy: ACTOR });
    });
  });

  describe('desativação e remoção', () => {
    it('desativa sem afetar agentes existentes', async () => {
      const row = await model('GPT_5');
      const a = await newAgent(row.id);
      await catalog.deactivate(row.id);
      const [current] = await db.select().from(agent).where(eq(agent.id, a.id));
      expect(current!.modelId).toBe(row.id);
      expect((await catalog.get(row.id)).active).toBe(false);
    });

    it('recusa remover modelo em uso sem substituto e lista os agentes', async () => {
      const row = await model('GPT_5');
      const a = await newAgent(row.id);
      await newAgent(row.id, 'DELETED');
      const error = await errorOf(catalog.remove(row.id));
      expect(error).toMatchObject({ code: 'MODEL_IN_USE', details: { agents: [{ id: a.id }] } });
    });

    it('migra agentes para o substituto (settings no GPTMaker) e faz soft delete', async () => {
      const old = await model('GPT_5');
      const replacement = await model('GPT_5_MINI');
      const plan = await newPlan();
      await catalog.setPlanAllowedModels(plan, { modelIds: [old.id, replacement.id] }, ACTOR);
      const active = await newAgent(old.id);
      // Fora de sincronia: só migra localmente (sem stub, uma chamada ao GPTMaker falharia).
      await newAgent(old.id, 'OUT_OF_SYNC');
      await wiremock.stub({
        request: {
          method: 'PUT',
          urlPath: `/v2/agent/${active.gptmakerAgentId}/settings`,
          bodyPatterns: [
            { equalToJson: { prefferModel: 'GPT_5_MINI', timezone: 'America/Sao_Paulo' } },
          ],
        },
        response: { status: 200, jsonBody: { success: true } },
      });

      await expect(catalog.remove(old.id, { replacementModelId: replacement.id })).resolves.toEqual(
        {
          migratedAgents: 2,
        },
      );

      const agents = await db.select().from(agent);
      expect(agents.every((row) => row.modelId === replacement.id)).toBe(true);
      const [removed] = await db.select().from(aiModel).where(eq(aiModel.id, old.id));
      expect(removed).toMatchObject({ active: false });
      expect(removed!.deletedAt).toBeInstanceOf(Date);
      expect(await catalog.listAllowedForPlan(plan)).toEqual([
        expect.objectContaining({ id: replacement.id }),
      ]);
    });

    it('falha no GPTMaker interrompe a remoção; nova tentativa continua', async () => {
      const old = await model('GPT_5');
      const replacement = await model('GPT_5_MINI');
      const a = await newAgent(old.id);
      await wiremock.stub({
        request: { method: 'PUT', urlPath: `/v2/agent/${a.gptmakerAgentId}/settings` },
        response: { status: 400, jsonBody: { error: 'Erro inesperado' } },
      });

      const error = await errorOf(catalog.remove(old.id, { replacementModelId: replacement.id }));
      expect(error).toMatchObject({
        code: 'MODEL_MIGRATION_FAILED',
        details: { migrated: 0, failed: [{ agentId: a.id }] },
      });
      const [kept] = await db.select().from(aiModel).where(eq(aiModel.id, old.id));
      expect(kept).toMatchObject({ active: false, deletedAt: null });

      await wiremock.reset();
      await wiremock.stub({
        request: { method: 'PUT', urlPath: `/v2/agent/${a.gptmakerAgentId}/settings` },
        response: { status: 200, jsonBody: { success: true } },
      });
      await expect(catalog.remove(old.id, { replacementModelId: replacement.id })).resolves.toEqual(
        {
          migratedAgents: 1,
        },
      );
    });

    it('substituto precisa ser outro modelo ativo', async () => {
      const old = await model('GPT_5');
      const inactive = await model('GPT_5_MINI', { active: false });
      await newAgent(old.id);
      await expect(
        errorOf(catalog.remove(old.id, { replacementModelId: inactive.id })),
      ).resolves.toMatchObject({ code: 'REPLACEMENT_MODEL_INVALID' });
      await expect(
        errorOf(catalog.remove(old.id, { replacementModelId: old.id })),
      ).resolves.toMatchObject({ code: 'REPLACEMENT_MODEL_INVALID' });
    });
  });

  describe('modelos por plano', () => {
    it('oferece só modelos ativos permitidos, com custo, do mais barato ao mais caro', async () => {
      const cheap = await model('GPT_5_MINI', { cost: 1 });
      const pricey = await model('GPT_5', { cost: 4 });
      const other = await model('CLAUDE_4_5_HAIKU', { cost: 3 });
      const plan = await newPlan();
      await catalog.setPlanAllowedModels(
        plan,
        { modelIds: [pricey.id, cheap.id, cheap.id] },
        ACTOR,
      );

      expect(
        (await catalog.listAllowedForPlan(plan)).map((m) => [m.code, m.creditsPerResponse]),
      ).toEqual([
        ['GPT_5_MINI', 1],
        ['GPT_5', 4],
      ]);
      expect(await catalog.isAllowedForPlan(plan, other.id)).toBe(false);

      await catalog.deactivate(pricey.id);
      expect((await catalog.listAllowedForPlan(plan)).map((m) => m.code)).toEqual(['GPT_5_MINI']);
      expect(await catalog.isAllowedForPlan(plan, pricey.id)).toBe(false);
      const [entitlement] = await db
        .select()
        .from(planEntitlement)
        .where(eq(planEntitlement.planSpaId, plan));
      expect(entitlement!.updatedBy).toBe(ACTOR);
    });

    it('recusa plano inexistente e modelo inativo', async () => {
      const inactive = await model('GPT_5', { active: false });
      await expect(
        errorOf(catalog.setPlanAllowedModels('nao-existe', { modelIds: [] }, ACTOR)),
      ).resolves.toMatchObject({ code: 'PLAN_NOT_FOUND' });
      const plan = await newPlan();
      await expect(
        errorOf(catalog.setPlanAllowedModels(plan, { modelIds: [inactive.id] }, ACTOR)),
      ).resolves.toMatchObject({
        code: 'MODEL_NOT_AVAILABLE',
        details: { modelIds: [inactive.id] },
      });
    });
  });

  describe('seed', () => {
    it('semeia só com o catálogo vazio, com um padrão e descontinuados inativos', async () => {
      await expect(seedAiModels(db)).resolves.toBe(SEED_MODELS.length);
      await expect(seedAiModels(db)).resolves.toBe(0);
      const rows = await db.select().from(aiModel);
      expect(rows.filter((row) => row.isDefault).map((row) => row.code)).toEqual([
        SEED_DEFAULT_MODEL,
      ]);
      expect(rows.find((row) => row.code === 'CLAUDE_3_5_HAIKU')?.active).toBe(false);
    });
  });
});
