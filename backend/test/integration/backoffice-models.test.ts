import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { ModelsAdminService } from '../../src/modules/backoffice/models-admin.service';
import { OperatorService } from '../../src/modules/backoffice/operator.service';
import type { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { ModelCatalogService } from '../../src/modules/models/model-catalog.service';
import { ModelCostInsights } from '../../src/modules/reconciliation/model-cost-insights';
import { previousDays } from '../../src/modules/reconciliation/reconciliation.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const {
  reconciliationAdjustment,
  agent,
  aiModel,
  auditLog,
  creditLedger,
  planAllowedModel,
  planEntitlement,
  tenant,
  usageDailyReal,
} = schema;
const TZ = 'America/Sao_Paulo';

// Catálogo de modelos no backoffice e média real por modelo (tarefas 15.3 e 14.3).
describe('backoffice: modelos de IA', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: ModelsAdminService;
  let actor: string;
  let tenantId: string;
  let mini: string;
  let sol: string;
  const updated: Array<{ agentId: string; model: unknown }> = [];

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    const gptmaker = {
      updateAgentSettings: async (agentId: string, settings: { prefferModel: unknown }) => {
        updated.push({ agentId, model: settings.prefferModel });
      },
    } as unknown as GptMakerClient;
    service = new ModelsAdminService(
      new ModelCatalogService(db, gptmaker),
      new ModelCostInsights({ RECONCILIATION_TIMEZONE: TZ } as Env, db),
      new AuditService(db),
      db,
    );
    actor = (
      await new OperatorService(db).create({ email: 'ana@empresa.com', name: 'Ana', role: 'ADMIN' })
    ).operator.id;
    const models = await db
      .insert(aiModel)
      .values([
        { code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1, isDefault: true },
        { code: 'GPT_5_6_SOL', displayName: 'GPT-5.6 Sol', creditsPerResponse: 14 },
      ])
      .returning();
    [mini, sol] = models.map((m) => m.id) as [string, string];
    const code = randomBytes(4).toString('hex');
    const [t] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    tenantId = t!.id;
    await db
      .insert(planEntitlement)
      .values({ planSpaId: '13', planType: 'subscription', creditsPerCycle: 10 });
    await db.insert(planAllowedModel).values({ planSpaId: '13', modelId: sol });
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('média real dos últimos 30 dias e destaque após 7 dias seguidos fora do custo', async () => {
    const [a] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId: mini,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    // GPT-5 Mini cadastrado a 1 crédito, mas o GPTMaker cobrou 2 por resposta nos últimos 7 dias.
    for (const day of previousDays(new Date(), TZ, 7)) {
      await db.insert(reconciliationAdjustment).values({
        agentId: a!.id,
        day,
        tenantId,
        realTotal: 6,
        debitedTotal: 3,
      });
      await db
        .insert(usageDailyReal)
        .values({ agentId: a!.id, tenantId, day, modelCode: 'GPT_5_MINI', credits: 6 });
      for (let i = 0; i < 3; i++) {
        await db.insert(creditLedger).values({
          tenantId,
          wallet: 'PLAN',
          type: 'DEBIT',
          amount: -1,
          agentId: a!.id,
          modelCode: 'GPT_5_MINI',
          unitCost: 1,
          refType: 'message',
          refId: randomUUID(),
          idempotencyKey: randomUUID(),
          createdBy: 't',
          createdAt: new Date(`${day}T15:00:00-03:00`),
        });
      }
    }

    const list = await service.list();
    expect(list.map((m) => m.code)).toEqual(['GPT_5_MINI', 'GPT_5_6_SOL']);
    expect(list[0]).toMatchObject({
      isDefault: true,
      agentsUsing: 1,
      plansAllowing: 0,
      insight: { average: 2, real: 42, responses: 21, suggestion: 2, stale: true },
    });
    expect(list[1]).toMatchObject({
      agentsUsing: 0,
      plansAllowing: 1,
      insight: { average: null, suggestion: null, stale: false },
    });
  });

  it('alterar o custo grava histórico com o nome do operador e auditoria', async () => {
    await service.update(mini, { creditsPerResponse: 2 }, actor);
    expect(await service.history(mini)).toEqual([
      expect.objectContaining({ previousCost: 1, newCost: 2, changedBy: 'Ana' }),
    ]);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, mini), eq(auditLog.action, 'model.updated')));
    expect(audit).toMatchObject({ actorId: actor });
    expect((audit!.after as { creditsPerResponse: number }).creditsPerResponse).toBe(2);
  });

  it('remover com substituto migra os agentes no GPTMaker', async () => {
    const created = await service.create(
      { code: 'GPT_5_4', displayName: 'GPT-5.4', creditsPerResponse: 7 },
      actor,
    );
    await db.insert(agent).values({
      tenantId,
      gptmakerAgentId: 'gm-migrar',
      name: 'Bia',
      type: 'SUPPORT',
      communicationType: 'NORMAL',
      modelId: created.id,
      webhookTokenHash: randomUUID(),
    });
    expect(await service.remove(created.id, { replacementModelId: sol }, actor)).toEqual({
      migratedAgents: 1,
    });
    expect(updated).toContainEqual({ agentId: 'gm-migrar', model: 'GPT_5_6_SOL' });
    expect((await service.list()).some((m) => m.id === created.id)).toBe(false);
  });

  it('dia ainda não reconciliado: respostas não viram média zero', async () => {
    // 10 dias atrás: dentro dos 30 da média, fora dos 7 reconciliados no primeiro cenário.
    const [day] = previousDays(new Date(), TZ, 10);
    await db.insert(creditLedger).values({
      tenantId,
      wallet: 'PLAN',
      type: 'DEBIT',
      amount: -14,
      modelCode: 'GPT_5_6_SOL',
      unitCost: 14,
      refType: 'message',
      refId: randomUUID(),
      idempotencyKey: randomUUID(),
      createdBy: 't',
      createdAt: new Date(`${day}T15:00:00-03:00`),
    });
    const solModel = (await service.list()).find((m) => m.code === 'GPT_5_6_SOL')!;
    expect(solModel.insight).toMatchObject({ average: null, responses: 0, stale: false });
  });
});
