import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentAccessPolicy } from '../../src/modules/agents/agent-access.policy';
import { AgentLifecycleListener } from '../../src/modules/agents/agent-lifecycle.listener';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { PaymentsOutbox } from '../../src/modules/payments/payments-outbox';
import { TenantLifecycle } from '../../src/modules/tenancy/tenant-lifecycle';
import type { Tenant } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { WireMock } from '../support/wiremock';
import { testPool } from '../support/postgres';

const { agent, aiModel, paymentsOutbox, subscriptionState, tenant } = schema;
type Reason = NonNullable<typeof agent.$inferSelect.inactiveReason>;

// Inativação e reativação automáticas (spec agent-management), com o WireMock no papel do GPTMaker.
describe('inativação e reativação automáticas dos agentes', () => {
  let postgres: StartedPostgreSqlContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let lifecycle: TenantLifecycle;
  let modelId: string;
  let owner: Tenant;

  async function newAgent(status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_SYNC', reason?: Reason) {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner.id,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Atendente',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        status,
        inactiveReason: reason ?? null,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return row!;
  }

  async function subscription(values: Partial<typeof subscriptionState.$inferInsert>) {
    await db
      .insert(subscriptionState)
      .values({
        tenantId: owner.id,
        subscriptionId: 'sub-1',
        status: 'active',
        modality: 'stripe',
        version: 1,
        ...values,
      })
      .onConflictDoUpdate({ target: subscriptionState.tenantId, set: values });
  }

  const stored = async (id: string) => (await db.select().from(agent).where(eq(agent.id, id)))[0]!;
  const toggles = async (row: { gptmakerAgentId: string }, kind: 'active' | 'inactive') =>
    wiremock.count('PUT', `/v2/agent/${row.gptmakerAgentId}/${kind}`);
  const mirrors = async (id: string) =>
    (await db.select().from(paymentsOutbox).where(eq(paymentsOutbox.aggregateRef, id))).length;
  const accessChanged = (status: Tenant['status'] = 'ACTIVE') =>
    lifecycle.emit('onAccessChanged', { ...owner, status });

  beforeAll(async () => {
    [postgres, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      WireMock.start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
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
    lifecycle = new TenantLifecycle();
    new AgentLifecycleListener(
      lifecycle,
      client,
      new PaymentsOutbox(db),
      new AgentAccessPolicy(db),
      db,
    ).onModuleInit();
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await wiremock.stub({
      request: { method: 'PUT', urlPathPattern: '/v2/agent/[^/]+/(in)?active' },
      response: { status: 200, jsonBody: { success: true } },
    });
    await db.delete(paymentsOutbox);
    await db.delete(agent);
    await db.delete(subscriptionState);
    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    owner = row!;
  });

  afterAll(async () => {
    await pool?.end();
    await Promise.all([postgres?.stop(), wiremock?.stop()]);
  });

  it('assinatura encerrada: inativa os ativos com SUBSCRIPTION_EXPIRED e espelha', async () => {
    const active = await newAgent('ACTIVE');
    const manual = await newAgent('INACTIVE', 'MANUAL');
    const outOfSync = await newAgent('OUT_OF_SYNC');
    await subscription({ status: 'cancelled' });

    await accessChanged();

    expect(await toggles(active, 'inactive')).toBe(1);
    expect(await stored(active.id)).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'SUBSCRIPTION_EXPIRED',
    });
    expect(await mirrors(active.id)).toBe(1);
    // Inativação manual e agente fora de sincronia ficam como estão.
    expect(await stored(manual.id)).toMatchObject({ status: 'INACTIVE', inactiveReason: 'MANUAL' });
    expect((await stored(outOfSync.id)).status).toBe('OUT_OF_SYNC');
    expect(await toggles(outOfSync, 'inactive')).toBe(0);
  });

  it('carência vencida inativa; dentro da carência, não', async () => {
    const row = await newAgent('ACTIVE');
    await subscription({ status: 'past_due', graceUntil: new Date(Date.now() + 3_600_000) });
    await accessChanged();
    expect((await stored(row.id)).status).toBe('ACTIVE');

    await subscription({ status: 'past_due', graceUntil: new Date(Date.now() - 1000) });
    await accessChanged();
    expect(await stored(row.id)).toMatchObject({ inactiveReason: 'SUBSCRIPTION_EXPIRED' });
  });

  it('assinatura regularizada: reativa só os inativados pelo sistema', async () => {
    const expired = await newAgent('INACTIVE', 'SUBSCRIPTION_EXPIRED');
    const manual = await newAgent('INACTIVE', 'MANUAL');
    await subscription({ status: 'active' });

    await accessChanged();

    expect(await toggles(expired, 'active')).toBe(1);
    expect(await stored(expired.id)).toMatchObject({ status: 'ACTIVE', inactiveReason: null });
    expect(await mirrors(expired.id)).toBe(1);
    expect(await toggles(manual, 'active')).toBe(0);
    expect(await stored(manual.id)).toMatchObject({ status: 'INACTIVE', inactiveReason: 'MANUAL' });
  });

  it('suspensão inativa com TENANT_SUSPENDED e vale mais que a assinatura', async () => {
    const active = await newAgent('ACTIVE');
    const expired = await newAgent('INACTIVE', 'SUBSCRIPTION_EXPIRED');
    await subscription({ status: 'cancelled' });

    await accessChanged('SUSPENDED');

    expect(await stored(active.id)).toMatchObject({ inactiveReason: 'TENANT_SUSPENDED' });
    // Já inativo: só troca o motivo, sem chamar o GPTMaker.
    expect(await stored(expired.id)).toMatchObject({ inactiveReason: 'TENANT_SUSPENDED' });
    expect(await toggles(expired, 'inactive')).toBe(0);
    expect(await mirrors(expired.id)).toBe(0);
  });

  it('fim da suspensão com a assinatura encerrada: continuam inativos, pela assinatura', async () => {
    const row = await newAgent('INACTIVE', 'TENANT_SUSPENDED');
    await subscription({ status: 'trial_expired' });

    await accessChanged('ACTIVE');

    expect(await stored(row.id)).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'SUBSCRIPTION_EXPIRED',
    });
    expect(await toggles(row, 'active')).toBe(0);
  });

  it('desinstalação e reinstalação passam pela mesma regra', async () => {
    const row = await newAgent('ACTIVE');

    await lifecycle.emit('onUninstalled', { ...owner, status: 'UNINSTALLED' });
    expect(await stored(row.id)).toMatchObject({ inactiveReason: 'UNINSTALLED' });

    // Assinatura encerrou enquanto desinstalado: a reinstalação não reativa.
    await subscription({ status: 'cancelled' });
    await lifecycle.emit('onInstalled', { ...owner, status: 'ACTIVE' }, { reinstall: true });
    expect(await stored(row.id)).toMatchObject({ inactiveReason: 'SUBSCRIPTION_EXPIRED' });

    await subscription({ status: 'active' });
    await accessChanged();
    expect(await stored(row.id)).toMatchObject({ status: 'ACTIVE', inactiveReason: null });
  });

  it('é idempotente: repetir o evento não chama o GPTMaker de novo', async () => {
    const row = await newAgent('ACTIVE');
    await subscription({ status: 'cancelled' });

    await accessChanged();
    await accessChanged();

    expect(await toggles(row, 'inactive')).toBe(1);
    expect(await mirrors(row.id)).toBe(1);
  });

  it('falha no GPTMaker sobe para a entrega ser repetida, sem gravar o agente', async () => {
    const row = await newAgent('ACTIVE');
    await subscription({ status: 'cancelled' });
    await wiremock.stub({
      request: { method: 'PUT', urlPath: `/v2/agent/${row.gptmakerAgentId}/inactive` },
      response: { status: 500, jsonBody: { error: 'falhou' } },
      priority: 1,
    });

    await expect(accessChanged()).rejects.toBeDefined();
    expect((await stored(row.id)).status).toBe('ACTIVE');
  });
});
