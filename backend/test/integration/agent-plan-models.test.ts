import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentPlanModels } from '../../src/modules/agents/agent-plan-models';
import type { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { ModelCatalogService } from '../../src/modules/models/model-catalog.service';
import type { NotificationService } from '../../src/modules/notifications/notification.service';
import { TenantLifecycle } from '../../src/modules/tenancy/tenant-lifecycle';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agent, aiModel, planAllowedModel, planEntitlement, subscriptionState, tenant } = schema;

// Downgrade com modelo não permitido (spec payments-integration): agente vai para o modelo padrão.
describe('modelos dos agentes conforme o plano', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let enforcer: AgentPlanModels;
  let tenantId: string;
  let defaultModel: string;
  let premium: string;
  let middle: string;
  const remote: Array<{ agentId: string; model: unknown }> = [];
  const notified: Array<{ type: string; message: string }> = [];

  async function newAgent(name: string, modelId: string, status = 'ACTIVE' as const) {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name,
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        status,
        settings: { prefferModel: 'X', timezone: 'America/Sao_Paulo' },
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return row!;
  }

  async function onPlan(planId: string) {
    await db
      .insert(subscriptionState)
      .values({
        tenantId,
        subscriptionId: '1',
        status: 'active',
        modality: 'stripe',
        planId,
        version: 1,
      })
      .onConflictDoUpdate({ target: subscriptionState.tenantId, set: { planId } });
  }

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    const models = await db
      .insert(aiModel)
      .values([
        { code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1, isDefault: true },
        { code: 'GPT_5_6_SOL', displayName: 'GPT-5.6 Sol', creditsPerResponse: 14 },
        { code: 'GPT_5_4', displayName: 'GPT-5.4', creditsPerResponse: 7 },
      ])
      .returning();
    [defaultModel, premium, middle] = models.map((m) => m.id) as [string, string, string];
    await db.insert(planEntitlement).values([
      { planSpaId: '13', planType: 'subscription', creditsPerCycle: 10000 },
      { planSpaId: '11', planType: 'subscription', creditsPerCycle: 5000 },
    ]);
    await db.insert(planAllowedModel).values([
      { planSpaId: '13', modelId: premium },
      { planSpaId: '13', modelId: middle },
      { planSpaId: '11', modelId: middle },
    ]);

    const gptmaker = {
      updateAgentSettings: async (agentId: string, settings: { prefferModel: unknown }) => {
        remote.push({ agentId, model: settings.prefferModel });
      },
    } as unknown as GptMakerClient;
    const notifications = {
      notify: async (n: { type: string; message: string }) => notified.push(n) > 0,
    } as unknown as NotificationService;
    enforcer = new AgentPlanModels(
      new TenantLifecycle(),
      gptmaker,
      new ModelCatalogService(db, undefined as never),
      notifications,
      db,
    );
  });

  beforeEach(async () => {
    remote.length = 0;
    notified.length = 0;
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    tenantId = row!.id;
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('downgrade: só quem usa modelo fora do plano vai para o padrão, com aviso', async () => {
    const ana = await newAgent('Ana', premium);
    const bia = await newAgent('Bia', middle);
    const caio = await newAgent('Caio', defaultModel);
    await onPlan('11');

    expect(await enforcer.enforce(tenantId)).toEqual([ana.id]);
    expect(remote).toEqual([{ agentId: ana.gptmakerAgentId, model: 'GPT_5_MINI' }]);
    const models = await db
      .select({ id: agent.id, modelId: agent.modelId })
      .from(agent)
      .where(eq(agent.tenantId, tenantId));
    expect(Object.fromEntries(models.map((m) => [m.id, m.modelId]))).toEqual({
      [ana.id]: defaultModel,
      [bia.id]: middle,
      [caio.id]: defaultModel,
    });
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ type: 'MODEL_DOWNGRADED' });
    expect(notified[0]!.message).toContain('Ana');
    expect(notified[0]!.message).toContain('GPT-5 Mini');

    // Repetir não muda nada.
    expect(await enforcer.enforce(tenantId)).toEqual([]);
  });

  it('plano que permite o modelo: nada muda', async () => {
    await newAgent('Ana', premium);
    await onPlan('13');
    expect(await enforcer.enforce(tenantId)).toEqual([]);
    expect(remote).toEqual([]);
  });

  it('sem assinatura: não mexe', async () => {
    await newAgent('Ana', premium);
    expect(await enforcer.enforce(tenantId)).toEqual([]);
  });

  it('agente fora de sincronia: só o registro local muda', async () => {
    const ana = await newAgent('Ana', premium, 'OUT_OF_SYNC' as never);
    await onPlan('11');
    expect(await enforcer.enforce(tenantId)).toEqual([ana.id]);
    expect(remote).toEqual([]);
  });
});
