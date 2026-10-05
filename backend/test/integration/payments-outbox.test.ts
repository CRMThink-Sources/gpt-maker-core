import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentItemMirror } from '../../src/modules/payments/agent-item.mirror';
import {
  MAX_OUTBOX_ATTEMPTS,
  OUTBOX_OPERATIONS,
  type OutboxHandler,
  PaymentsOutbox,
} from '../../src/modules/payments/payments-outbox';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { PlatformApiClient } from '../../src/shared/platform/platform-api.client';
import { WireMock } from '../support/wiremock';

const { agent, aiModel, paymentsOutbox, subscriptionState, tenant } = schema;
const SUB = 501;
const ITEM = 77;
const ITEMS_PATH = `/v1/subscriptions/${SUB}/items`;
const ITEM_PATH = `${ITEMS_PATH}/${ITEM}`;

// Espelho dos agentes como itens de assinatura (spec payments-integration), com o WireMock no
// papel do crmthink-platform.
describe('outbox de pagamentos: agentes como itens de assinatura', () => {
  let postgres: StartedPostgreSqlContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let outbox: PaymentsOutbox;
  let handlers: Record<string, OutboxHandler>;
  let modelId: string;
  let tenantId: string;
  let installationId: number;

  const item = (overrides: Record<string, unknown> = {}) => ({
    itemId: ITEM,
    subscriptionId: SUB,
    externalRef: null,
    title: 'Atendente',
    status: 'active',
    billable: false,
    metadata: {},
    deletedAt: null,
    ...overrides,
  });
  const ok = (jsonBody: unknown, status = 200) => ({ status, jsonBody });
  const fail = (status: number, code: string) => ({
    status,
    jsonBody: { error: { code, message: code } },
  });

  async function newAgent(
    values: Partial<typeof agent.$inferInsert> = {},
  ): Promise<typeof agent.$inferSelect> {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Atendente',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
        ...values,
      })
      .returning();
    await outbox.enqueue(tenantId, OUTBOX_OPERATIONS.agentItemSync, row!.id);
    return row!;
  }

  async function withLocalSubscription() {
    await db.insert(subscriptionState).values({
      tenantId,
      subscriptionId: String(SUB),
      status: 'active',
      modality: 'stripe',
      version: 1,
    });
  }

  async function stubItems(created: Record<string, unknown> = {}) {
    await wiremock.stub({
      request: { method: 'POST', urlPath: ITEMS_PATH },
      response: ok(item(created), 201),
    });
    await wiremock.stub({
      request: { method: 'PATCH', urlPath: ITEM_PATH },
      response: ok(item()),
    });
  }

  const rows = () => db.select().from(paymentsOutbox);

  beforeAll(async () => {
    [postgres, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      WireMock.start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    const platform = new PlatformApiClient({
      baseUrl: wiremock.baseUrl,
      apiKey: 'k',
      timeoutMs: 5000,
      maxAttempts: 1,
    });
    outbox = new PaymentsOutbox(db);
    const mirror = new AgentItemMirror(platform, db);
    handlers = { [OUTBOX_OPERATIONS.agentItemSync]: (row) => mirror.sync(row) };
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await db.delete(paymentsOutbox);
    await db.delete(agent);
    await db.delete(subscriptionState);
    const code = randomBytes(3).toString('hex');
    installationId = Math.floor(Math.random() * 1_000_000);
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: String(installationId),
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    tenantId = row!.id;
  });

  afterAll(async () => {
    await pool?.end();
    await Promise.all([postgres?.stop(), wiremock?.stop()]);
  });

  it('agente ativo: cria o item não cobrável com externalRef = id do agente', async () => {
    await withLocalSubscription();
    const row = await newAgent();
    await stubItems({ externalRef: row.id });

    expect(await outbox.processDue(handlers)).toBe(1);

    expect(await wiremock.bodies('POST', ITEMS_PATH)).toEqual([
      { externalRef: row.id, title: 'Atendente', billable: false },
    ]);
    // Item já coincide com o agente: nada a atualizar.
    expect(await wiremock.count('PATCH', ITEM_PATH)).toBe(0);
    expect(await rows()).toMatchObject([{ status: 'DONE', attempts: 1, lastError: null }]);
  });

  it('agente inativo ou renomeado: atualiza status e título do item existente', async () => {
    await withLocalSubscription();
    await newAgent({ name: 'Vendedor', status: 'INACTIVE', inactiveReason: 'MANUAL' });
    // Idempotente por externalRef: a plataforma devolve o item como estava.
    await stubItems({ title: 'Atendente', status: 'active' });

    await outbox.processDue(handlers);

    expect(await wiremock.bodies('PATCH', ITEM_PATH)).toEqual([
      { title: 'Vendedor', status: 'cancelled' },
    ]);
  });

  it('agente removido: remove o item achado pelo externalRef', async () => {
    await withLocalSubscription();
    const row = await newAgent({ status: 'DELETED', deletedAt: new Date() });
    await wiremock.stub({
      request: { method: 'GET', urlPath: ITEMS_PATH },
      response: ok({
        items: [
          item({ itemId: 1, externalRef: 'outro' }),
          item({ itemId: ITEM, externalRef: row.id }),
        ],
      }),
    });
    await wiremock.stub({
      request: { method: 'DELETE', urlPath: ITEM_PATH },
      response: ok(item({ deletedAt: new Date().toISOString() })),
    });

    await outbox.processDue(handlers);

    expect(await wiremock.count('DELETE', ITEM_PATH)).toBe(1);
    expect(await wiremock.count('POST', ITEMS_PATH)).toBe(0);
    expect((await rows())[0]!.status).toBe('DONE');
  });

  it('agente removido sem item na plataforma: nada a remover', async () => {
    await withLocalSubscription();
    await newAgent({ status: 'DELETED', deletedAt: new Date() });
    await wiremock.stub({
      request: { method: 'GET', urlPath: ITEMS_PATH },
      response: ok({ items: [] }),
    });

    await outbox.processDue(handlers);

    expect(await wiremock.unmatched()).toEqual([]);
    expect((await rows())[0]!.status).toBe('DONE');
  });

  it('sem projeção local: busca a assinatura da instalação na plataforma', async () => {
    await newAgent();
    await wiremock.stub({
      request: { method: 'GET', urlPath: `/v1/installations/${installationId}/subscription` },
      response: ok({ subscriptionId: SUB, status: 'trialing', modality: 'stripe', plan: null }),
    });
    await stubItems();

    await outbox.processDue(handlers);

    expect(await wiremock.count('POST', ITEMS_PATH)).toBe(1);
    expect((await rows())[0]!.status).toBe('DONE');
  });

  it.each([
    ['sem assinatura', 'GET', 'NO_SUBSCRIPTION', 404],
    ['assinatura encerrada', 'POST', 'SUBSCRIPTION_ENDED', 422],
  ] as const)('%s: encerra a linha sem espelhar, com o motivo', async (_, method, code, status) => {
    await newAgent();
    await wiremock.stub({
      request: { method: 'GET', urlPath: `/v1/installations/${installationId}/subscription` },
      response:
        method === 'GET'
          ? fail(status, code)
          : ok({ subscriptionId: SUB, status: 'active', modality: 'stripe', plan: null }),
    });
    await wiremock.stub({
      request: { method: 'POST', urlPath: ITEMS_PATH },
      response: fail(status, code),
    });

    await outbox.processDue(handlers);

    const [row] = await rows();
    expect(row).toMatchObject({ status: 'DONE' });
    expect(row!.lastError).toContain(code);
  });

  it('plataforma fora do ar: reagenda com espera e não bloqueia as próximas linhas', async () => {
    await withLocalSubscription();
    await newAgent();
    await wiremock.stub({
      request: { method: 'POST', urlPath: ITEMS_PATH },
      response: fail(503, 'UNAVAILABLE'),
    });

    // A linha reagendada não volta na mesma rodada.
    expect(await outbox.processDue(handlers)).toBe(1);

    const [row] = await rows();
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(row!.lastError).toMatch(/HTTP 503/);
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('esgotadas as tentativas, a linha fica FAILED', async () => {
    await withLocalSubscription();
    await newAgent();
    await db.update(paymentsOutbox).set({ attempts: MAX_OUTBOX_ATTEMPTS - 1 });
    await wiremock.stub({
      request: { method: 'POST', urlPath: ITEMS_PATH },
      response: fail(503, 'UNAVAILABLE'),
    });

    await outbox.processDue(handlers);

    expect((await rows())[0]).toMatchObject({ status: 'FAILED', attempts: MAX_OUTBOX_ATTEMPTS });
  });

  it('funde mudanças pendentes do mesmo agente e cria linha nova depois de aplicada', async () => {
    await withLocalSubscription();
    const row = await newAgent();
    // Reagendada para depois: nova mudança a traz para agora.
    await db.update(paymentsOutbox).set({ nextAttemptAt: new Date(Date.now() + 3_600_000) });
    await outbox.enqueue(tenantId, OUTBOX_OPERATIONS.agentItemSync, row.id);
    expect(await rows()).toHaveLength(1);

    await stubItems({ externalRef: row.id });
    expect(await outbox.processDue(handlers)).toBe(1);

    await outbox.enqueue(tenantId, OUTBOX_OPERATIONS.agentItemSync, row.id);
    const all = await db
      .select()
      .from(paymentsOutbox)
      .where(eq(paymentsOutbox.aggregateRef, row.id));
    expect(all.map((entry) => entry.status).sort()).toEqual(['DONE', 'PENDING']);
  });
});
