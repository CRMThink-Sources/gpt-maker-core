import { randomBytes, randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
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
import { CrmAccessGuard } from '../../src/modules/crm-tools/crm-access.guard';
import { CrmAccessService } from '../../src/modules/crm-tools/crm-access.service';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { IntentionService } from '../../src/modules/intentions/intention.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import type { Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { WireMock } from '../support/wiremock';

const { agent, agentCrmAccess, aiModel, tenant } = schema;
const REMOTE_AGENT = 'gm-agent-crm';
const INTENTIONS = `/v2/agent/${REMOTE_AGENT}/intentions`;
const MCP_ADD = `/v2/agent/${REMOTE_AGENT}/mcp/add`;
const PUBLIC_URL = 'https://api.exemplo.com';

// Acesso do agente ao CRM (spec agent-crm-tools; tarefas 4.2 a 4.4).
describe('acesso do agente ao CRM', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let events: AgentEvents;
  let service: CrmAccessService;
  let guard: CrmAccessGuard;
  let intentions: IntentionService;
  let tenantId: string;
  let agentId: string;
  let modelId: string;

  const env = { API_PUBLIC_URL: PUBLIC_URL, CRM_TOOLS_ENABLED: true } as Env;

  async function stub(method: string, urlPath: string, status: number, jsonBody: unknown) {
    await wiremock.stub({ request: { method, urlPath }, response: { status, jsonBody } });
  }

  async function stubHappyPath() {
    await stub('POST', INTENTIONS, 200, { id: 'int-sys', tenant: 'x' });
    await stub('POST', MCP_ADD, 200, { connected: true, success: true, id: 'mcp-1', url: '' });
    await stub('GET', '/v2/mcp/mcp-1/tools', 200, [
      { id: 'tool-1', name: 'negocios_do_cliente', active: false },
      { id: 'tool-2', name: 'etapas_do_funil', active: true },
    ]);
    await stub('GET', '/v2/mcp/mcp-1/tool/tool-1/active', 200, { success: true });
    await stub('DELETE', '/v2/mcp/mcp-1', 200, { success: true });
    await stub('DELETE', '/v2/intention/int-sys', 200, { success: true });
  }

  /** Credencial em claro, tirada do cabeçalho que o app mandou ao GPTMaker. */
  async function issuedToken(): Promise<string> {
    const [body] = (await wiremock.bodies('POST', MCP_ADD)) as Array<{
      headers: { Authorization: string };
    }>;
    return body!.headers.Authorization.replace('Bearer ', '');
  }

  async function authenticate(token: string): Promise<unknown> {
    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    try {
      await guard.canActivate(context);
      return request.crmCaller;
    } catch (error) {
      return (error as { status?: number }).status;
    }
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
    const database = db as unknown as Database;
    events = new AgentEvents();
    const agents = new AgentRepository(database);
    service = new CrmAccessService(agents, client, events, database, redis, env);
    service.onModuleInit();
    guard = new CrmAccessGuard(database, env);
    intentions = new IntentionService(agents, client, events, database, redis, env);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await redis.flushall();
    await db.delete(agentCrmAccess);
    await db.delete(agent);
    const code = randomBytes(3).toString('hex');
    const [t] = await db
      .insert(tenant)
      .values({
        installationId: '101',
        memberId: code,
        domain: `${code}.b24.com`,
        tenantCode: code,
      })
      .onConflictDoUpdate({ target: tenant.installationId, set: { status: 'ACTIVE' } })
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

  it('ativa: intenção de sistema, conexão MCP e ferramentas ativas com a mesma credencial', async () => {
    await stubHappyPath();
    const view = await service.update(tenantId, agentId, { enabled: true });
    expect(view).toMatchObject({ available: true, status: 'CONNECTED', lastError: null });

    const token = await issuedToken();
    const [intention] = (await wiremock.bodies('POST', INTENTIONS)) as Array<
      Record<string, unknown>
    >;
    expect(intention).toMatchObject({
      description: 'Consultar cliente no CRM',
      type: 'WEBHOOK',
      httpMethod: 'POST',
      url: `${PUBLIC_URL}/gptmaker/crm/client`,
      fields: [],
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
      requestBody: '{"chat":"{{chat_id}}"}',
    });
    const [connection] = await wiremock.bodies('POST', MCP_ADD);
    expect(connection).toMatchObject({
      mcpUrl: `${PUBLIC_URL}/mcp`,
      urlType: 'STREAMABLEHTTP',
      authType: 'HEADERS',
    });
    expect(await wiremock.count('GET', '/v2/mcp/mcp-1/tool/tool-1/active')).toBe(1);
    expect(await wiremock.count('GET', '/v2/mcp/mcp-1/tool/tool-2/active')).toBe(0);

    const [row] = await db.select().from(agentCrmAccess).where(eq(agentCrmAccess.agentId, agentId));
    expect(row).toMatchObject({ gptmakerIntentionId: 'int-sys', gptmakerMcpId: 'mcp-1' });
    expect(row!.tokenHash).not.toBe(token);

    expect(await authenticate(token)).toEqual({ tenantId, agentId, installationId: 101 });
    // Ativar de novo não recria nada.
    await service.update(tenantId, agentId, { enabled: true });
    expect(await wiremock.count('POST', MCP_ADD)).toBe(1);
  });

  it('falha no meio desfaz o que criou e deixa erro com a credencial inválida', async () => {
    await stub('POST', INTENTIONS, 200, { id: 'int-sys' });
    await stub('POST', MCP_ADD, 400, { error: 'url inacessível' });
    await stub('DELETE', '/v2/intention/int-sys', 200, { success: true });

    const view = await service.update(tenantId, agentId, { enabled: true });
    expect(view.status).toBe('ERROR');
    expect(view.lastError).toContain('url inacessível');
    expect(await wiremock.count('DELETE', '/v2/intention/int-sys')).toBe(1);

    const [intention] = (await wiremock.bodies('POST', INTENTIONS)) as Array<{
      headers: Array<{ value: string }>;
    }>;
    expect(await authenticate(intention!.headers[0]!.value.replace('Bearer ', ''))).toBe(401);
  });

  it('nenhuma ferramenta descoberta pelo GPTMaker é falha', async () => {
    await stubHappyPath();
    await stub('GET', '/v2/mcp/mcp-1/tools', 200, []);
    const view = await service.update(tenantId, agentId, { enabled: true });
    expect(view).toMatchObject({ status: 'ERROR' });
    expect(await wiremock.count('DELETE', '/v2/mcp/mcp-1')).toBe(1);
  });

  it('desativa: credencial recusada na hora e remoção no GPTMaker', async () => {
    await stubHappyPath();
    await service.update(tenantId, agentId, { enabled: true });
    const token = await issuedToken();

    const view = await service.update(tenantId, agentId, { enabled: false });
    expect(view.status).toBe('DISABLED');
    expect(await authenticate(token)).toBe(401);
    expect(await wiremock.count('DELETE', '/v2/mcp/mcp-1')).toBe(1);
    expect(await wiremock.count('DELETE', '/v2/intention/int-sys')).toBe(1);
  });

  it('agente inativo ou tenant desinstalado: credencial recusada', async () => {
    await stubHappyPath();
    await service.update(tenantId, agentId, { enabled: true });
    const token = await issuedToken();

    await db.update(agent).set({ status: 'INACTIVE' }).where(eq(agent.id, agentId));
    expect(await authenticate(token)).toBe(401);
    await db.update(agent).set({ status: 'ACTIVE' }).where(eq(agent.id, agentId));
    await db.update(tenant).set({ status: 'UNINSTALLED' }).where(eq(tenant.id, tenantId));
    expect(await authenticate(token)).toBe(401);
    expect(await authenticate('qualquer')).toBe(401);
  });

  it('agente removido apaga a credencial', async () => {
    await stubHappyPath();
    await service.update(tenantId, agentId, { enabled: true });
    const token = await issuedToken();
    await events.emit({ agentId, tenantId, kind: 'removed' });
    expect(await authenticate(token)).toBe(401);
    expect((await service.view(tenantId, agentId)).status).toBe('DISABLED');
  });

  it('agente de outro tenant não é encontrado', async () => {
    await expect(service.view(randomUUID(), agentId)).rejects.toMatchObject({ status: 404 });
  });

  it('o cliente não cria intenção com o nome reservado', async () => {
    await expect(
      intentions.create(tenantId, agentId, {
        name: 'consultar cliente no crm',
        whenToUse: 'Sempre',
        fields: [],
        httpMethod: 'GET',
        url: 'https://exemplo.com',
        headers: [],
        params: [],
        body: null,
        autoGenerateParams: false,
        autoGenerateBody: false,
        responseMode: 'API',
        instructions: null,
        active: true,
      }),
    ).rejects.toMatchObject({ code: 'INTENTION_NAME_RESERVED' });
  });
});
