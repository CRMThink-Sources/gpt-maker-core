import { randomBytes, randomUUID } from 'node:crypto';
import type { IntentionInput } from '@gptmaker/contracts';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AgentEvents } from '../../src/modules/agents/agent-events';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { IntentionService } from '../../src/modules/intentions/intention.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { WireMock } from '../support/wiremock';

const { agent, agentIntention, aiModel, tenant } = schema;
const REMOTE_AGENT = 'gm-agent-int';
const LIST = `/v2/agent/${REMOTE_AGENT}/intentions`;

// Intenções do agente (spec agent-intentions; tarefas 17.2 a 17.4).
describe('serviço de intenções', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let events: AgentEvents;
  let service: IntentionService;
  let tenantId: string;
  let agentId: string;
  let modelId: string;

  const errorOf = (promise: Promise<unknown>) =>
    promise.catch((error: { code?: string }) => error.code ?? error);

  const form = (extra: Partial<IntentionInput> = {}): IntentionInput => ({
    name: 'Consultar cotação',
    whenToUse: 'Quando o cliente pedir a cotação de uma moeda',
    fields: [
      { name: 'Moeda', description: 'Sigla da moeda: USD ou EUR', type: 'STRING', required: true },
    ],
    httpMethod: 'GET',
    url: 'https://economia.awesomeapi.com.br/json/last/{{moeda}}',
    headers: [{ name: 'X-Api-Key', value: 'chave-secreta' }],
    params: [{ name: 'formato', value: 'json' }],
    body: null,
    autoGenerateParams: false,
    autoGenerateBody: false,
    responseMode: 'API',
    instructions: null,
    active: true,
    ...extra,
  });

  async function stubList(items: Array<{ id: string; description: string }>) {
    await wiremock.stub({
      request: { method: 'GET', urlPath: LIST },
      response: { status: 200, jsonBody: { data: items, count: items.length } },
    });
  }

  async function stubWrite(method: 'POST' | 'PUT' | 'DELETE', urlPath: string, status = 200) {
    await wiremock.stub({
      request: { method, urlPath },
      response:
        status === 200
          ? { status, jsonBody: { success: true } }
          : { status, jsonBody: { error: 'recusado' } },
    });
  }

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
    events = new AgentEvents();
    service = new IntentionService(new AgentRepository(db), client, events, db, redis, {
      API_PUBLIC_URL: 'https://app.exemplo.com',
    } as Env);
    service.onModuleInit();
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await redis.flushall();
    await db.delete(agentIntention);
    await db.delete(agent);
    const code = randomBytes(3).toString('hex');
    const [t] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    tenantId = t!.id;
    const [a] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: REMOTE_AGENT,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    agentId = a!.id;
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  it('cria no GPTMaker com o corpo certo, acha o id pela listagem e cifra o cabeçalho', async () => {
    await stubWrite('POST', LIST);
    await stubList([
      { id: 'outra', description: 'Outra intenção' },
      { id: 'int-1', description: 'consultar cotação' },
    ]);

    const view = await service.create(tenantId, agentId, form());
    expect(view).toMatchObject({
      name: 'Consultar cotação',
      synced: true,
      fields: [{ name: 'Moeda', jsonName: 'moeda', type: 'STRING', required: true }],
      headers: [{ name: 'X-Api-Key', hasValue: true }],
    });
    expect(JSON.stringify(view)).not.toContain('chave-secreta');

    expect(await wiremock.bodies('POST', LIST)).toEqual([
      {
        description: 'Consultar cotação',
        details: 'Quando o cliente pedir a cotação de uma moeda',
        manualOutput: false,
        type: 'WEBHOOK',
        httpMethod: 'GET',
        url: 'https://economia.awesomeapi.com.br/json/last/{{moeda}}',
        fields: [
          {
            name: 'Moeda',
            jsonName: 'moeda',
            description: 'Sigla da moeda: USD ou EUR',
            type: 'STRING',
            required: true,
          },
        ],
        headers: [{ name: 'X-Api-Key', value: 'chave-secreta' }],
        params: [{ name: 'formato', value: 'json' }],
        autoGenerateParams: false,
        autoGenerateBody: false,
        preprocessingMessage: 'DISABLED',
        active: true,
      },
    ]);
    const [row] = await db.select().from(agentIntention);
    expect(row).toMatchObject({ gptmakerIntentionId: 'int-1' });
    expect(row!.headers[0]!.valueEncrypted).not.toContain('chave-secreta');

    expect(
      await errorOf(service.create(tenantId, agentId, form({ name: ' CONSULTAR cotação ' }))),
    ).toBe('INTENTION_NAME_TAKEN');
  });

  it('edita mantendo o segredo do cabeçalho quando o valor não é reenviado', async () => {
    await stubWrite('POST', LIST);
    await stubList([{ id: 'int-1', description: 'Consultar cotação' }]);
    const created = await service.create(tenantId, agentId, form());
    await stubWrite('PUT', '/v2/intention/int-1');

    const updated = await service.update(
      tenantId,
      agentId,
      created.id,
      form({
        httpMethod: 'POST',
        body: '{"moeda": "{{moeda}}", "quantidade": 1}',
        headers: [{ name: 'X-Api-Key', value: null }],
        responseMode: 'INSTRUCTIONS',
        instructions: 'Responda só o valor de compra',
      }),
    );
    expect(updated).toMatchObject({ httpMethod: 'POST', responseMode: 'INSTRUCTIONS' });
    expect(await wiremock.bodies('PUT', '/v2/intention/int-1')).toEqual([
      expect.objectContaining({
        id: 'int-1',
        httpMethod: 'POST',
        requestBody: '{"moeda": "{{moeda}}", "quantidade": 1}',
        manualOutput: true,
        instructions: 'Responda só o valor de compra',
        headers: [{ name: 'X-Api-Key', value: 'chave-secreta' }],
      }),
    ]);
  });

  it('sem o id na hora da criação: fica pendente e a listagem seguinte localiza', async () => {
    await stubWrite('POST', LIST);
    await stubList([]);
    const created = await service.create(tenantId, agentId, form());
    expect(created.synced).toBe(false);

    await stubList([{ id: 'int-tarde', description: 'Consultar cotação' }]);
    expect(await service.list(tenantId, agentId)).toEqual([
      expect.objectContaining({ id: created.id, synced: true }),
    ]);
  });

  it('GPTMaker recusa: nada fica gravado', async () => {
    await stubWrite('POST', LIST, 400);
    expect(await errorOf(service.create(tenantId, agentId, form()))).toBe('GPTMAKER_REJECTED');
    expect(await db.select().from(agentIntention)).toEqual([]);
  });

  it('remove (ausente no GPTMaker conta como removida); agente removido leva as intenções', async () => {
    await stubWrite('POST', LIST);
    await stubList([
      { id: 'int-1', description: 'Consultar cotação' },
      { id: 'int-2', description: 'Segunda via' },
    ]);
    const first = await service.create(tenantId, agentId, form());
    await service.create(tenantId, agentId, form({ name: 'Segunda via' }));

    await stubWrite('DELETE', '/v2/intention/int-1', 404);
    await service.remove(tenantId, agentId, first.id);
    expect((await service.list(tenantId, agentId)).map((i) => i.name)).toEqual(['Segunda via']);

    await events.emit({ agentId, tenantId, kind: 'removed' });
    const rows = await db.select().from(agentIntention).where(eq(agentIntention.agentId, agentId));
    expect(rows.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it('Ação no Bitrix24: aponta para o app com token próprio, mantido nas edições', async () => {
    await stubWrite('POST', LIST);
    await stubList([{ id: 'int-bx', description: 'Registrar pedido' }]);
    const created = await service.create(
      tenantId,
      agentId,
      form({
        kind: 'BITRIX',
        name: 'Registrar pedido',
        url: '',
        headers: [],
        params: [],
        actions: [
          {
            type: 'CREATE_LEAD',
            config: { fields: { TITLE: 'Pedido de {{fields.moeda}}' } },
          },
        ],
      }),
    );
    expect(created).toMatchObject({ kind: 'BITRIX', synced: true, headers: [], url: '' });
    const [sent] = (await wiremock.bodies('POST', LIST)) as Array<Record<string, unknown>>;
    expect(sent).toMatchObject({
      httpMethod: 'POST',
      url: `https://app.exemplo.com/gptmaker/intentions/${created.id}`,
      autoGenerateBody: false,
    });
    expect(JSON.parse(sent!.requestBody as string)).toEqual({
      fields: { moeda: '{{moeda}}' },
      chat: '{{chat_id}}',
      contact: { name: '{{contact_name}}', phone: '{{contact_phone}}' },
    });
    const token = (sent!.headers as Array<{ name: string; value: string }>)[0]!;
    expect(token.name).toBe('X-Intention-Token');
    expect(token.value.length).toBeGreaterThan(30);

    await stubWrite('PUT', '/v2/intention/int-bx');
    await service.update(
      tenantId,
      agentId,
      created.id,
      form({
        kind: 'BITRIX',
        name: 'Registrar pedido',
        url: '',
        headers: [],
        params: [],
        whenToUse: 'Quando o cliente quiser fazer um pedido',
        actions: [{ type: 'TIMELINE_COMMENT', config: { text: 'Pedido: {{fields.moeda}}' } }],
      }),
    );
    const [updated] = (await wiremock.bodies('PUT', '/v2/intention/int-bx')) as Array<{
      headers: Array<{ value: string }>;
    }>;
    expect(updated!.headers[0]!.value).toBe(token.value);
  });

  it('agente de outro tenant responde como inexistente', async () => {
    expect(await errorOf(service.list(randomUUID(), agentId))).toBe('AGENT_NOT_FOUND');
  });
});
