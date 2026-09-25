import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { TenantAgentLimitService } from '../../src/modules/gptmaker/tenant-agent-limit.service';
import { WorkspaceHealthService } from '../../src/modules/gptmaker/workspace-health.service';
import { WorkspaceStatusStore } from '../../src/modules/gptmaker/workspace-status.store';
import { WorkspaceSyncService } from '../../src/modules/gptmaker/workspace-sync.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { HealthRegistry } from '../../src/shared/health/health-registry';
import { DomainError } from '../../src/shared/http/api-exception.filter';
import { WireMock } from '../support/wiremock';

const { agent, aiModel, tenant, workspaceSyncFinding } = schema;
const WS = 'ws-1';

describe('workspace GPTMaker: sync, health e limite', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let client: GptMakerClient;
  let modelId: string;

  const ok = (jsonBody: unknown) => ({ status: 200, jsonBody });

  async function newTenant() {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    return row!;
  }

  async function newAgent(tenantId: string, status: 'ACTIVE' | 'INACTIVE' | 'DELETED' = 'ACTIVE') {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Bot',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        status,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return row!;
  }

  /** Workspace remoto: página 0 com os agentes, página 1 vazia. */
  async function remoteAgents(items: Array<{ id: string; name?: string; status?: string }>) {
    await wiremock.stub({
      request: {
        method: 'GET',
        urlPath: `/v2/workspace/${WS}/agents`,
        queryParameters: { page: { equalTo: '0' } },
      },
      response: ok(items),
    });
    await wiremock.stub({
      request: {
        method: 'GET',
        urlPath: `/v2/workspace/${WS}/agents`,
        queryParameters: { page: { equalTo: '1' } },
      },
      response: ok([]),
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
    client = new GptMakerClient(
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
    const [model] = await db
      .insert(aiModel)
      .values({
        code: 'GPT_5_MINI',
        displayName: 'GPT-5 Mini',
        creditsPerResponse: 1,
        isDefault: true,
      })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await db.delete(workspaceSyncFinding);
    await db.delete(agent);
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  describe('workspace-sync', () => {
    const sync = () => new WorkspaceSyncService(client, db, redis).sync();

    it('registra órfão sugerindo o tenant pelo prefixo e não duplica na reexecução', async () => {
      const t = await newTenant();
      await remoteAgents([{ id: 'gm-orfao', name: `[${t.tenantCode}] Bot perdido` }]);

      const first = await sync();
      expect(first).toMatchObject({ remoteAgents: 1, orphansFound: 1 });
      const second = await sync();
      expect(second.orphansFound).toBe(0);

      const findings = await db.select().from(workspaceSyncFinding);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        kind: 'ORPHAN',
        gptmakerAgentId: 'gm-orfao',
        details: { suggestedTenantCode: t.tenantCode, suggestedTenantId: t.id },
      });
    });

    it('agente removido localmente que ainda existe no GPTMaker é órfão', async () => {
      const t = await newTenant();
      const removed = await newAgent(t.id, 'DELETED');
      await remoteAgents([{ id: removed.gptmakerAgentId, name: `[${t.tenantCode}] Bot` }]);
      await sync();
      const [finding] = await db.select().from(workspaceSyncFinding);
      expect(finding).toMatchObject({ kind: 'ORPHAN', agentId: removed.id });
    });

    it('marca OUT_OF_SYNC só quando o GET confirma 404', async () => {
      const t = await newTenant();
      const gone = await newAgent(t.id);
      await remoteAgents([]);
      await wiremock.stub({
        request: { method: 'GET', urlPath: `/v2/agent/${gone.gptmakerAgentId}` },
        response: { status: 404, jsonBody: { error: 'not found' } },
      });

      const summary = await sync();
      expect(summary.missingConfirmed).toBe(1);
      const [row] = await db.select().from(agent).where(eq(agent.id, gone.id));
      expect(row!.status).toBe('OUT_OF_SYNC');
      const [finding] = await db.select().from(workspaceSyncFinding);
      expect(finding).toMatchObject({
        kind: 'MISSING',
        agentId: gone.id,
        details: { previousStatus: 'ACTIVE' },
      });
    });

    it('não marca ausente se o GET encontra o agente (listagem incompleta)', async () => {
      const t = await newTenant();
      const present = await newAgent(t.id);
      await remoteAgents([]);
      await wiremock.stub({
        request: { method: 'GET', urlPath: `/v2/agent/${present.gptmakerAgentId}` },
        response: ok({ id: present.gptmakerAgentId, name: 'x' }),
      });
      const summary = await sync();
      expect(summary.missingConfirmed).toBe(0);
      const [row] = await db.select().from(agent).where(eq(agent.id, present.id));
      expect(row!.status).toBe('ACTIVE');
    });

    it('400 genérico no GET fica indeterminado', async () => {
      const t = await newTenant();
      const unsure = await newAgent(t.id, 'INACTIVE');
      await remoteAgents([]);
      await wiremock.stub({
        request: { method: 'GET', urlPath: `/v2/agent/${unsure.gptmakerAgentId}` },
        response: { status: 400, jsonBody: { error: 'Erro inesperado' } },
      });
      const summary = await sync();
      expect(summary).toMatchObject({ missingConfirmed: 0, missingSkipped: 1 });
      const [row] = await db.select().from(agent).where(eq(agent.id, unsure.id));
      expect(row!.status).toBe('INACTIVE');
    });

    it('reaplica o status local quando o GPTMaker diverge e registra a correção', async () => {
      const t = await newTenant();
      const inactive = await newAgent(t.id, 'INACTIVE');
      const active = await newAgent(t.id, 'ACTIVE');
      const same = await newAgent(t.id, 'ACTIVE');
      await remoteAgents([
        { id: inactive.gptmakerAgentId, name: 'a', status: 'ACTIVE' },
        { id: active.gptmakerAgentId, name: 'b', status: 'DISABLED' },
        { id: same.gptmakerAgentId, name: 'c', status: 'ACTIVE' },
      ]);
      for (const [row, action] of [
        [inactive, 'inactive'],
        [active, 'active'],
      ] as const) {
        await wiremock.stub({
          request: { method: 'PUT', urlPath: `/v2/agent/${row.gptmakerAgentId}/${action}` },
          response: ok({ success: true }),
        });
      }

      const summary = await sync();
      expect(summary).toMatchObject({ statusCorrected: 2, statusCorrectionFailed: 0 });
      const findings = await db
        .select()
        .from(workspaceSyncFinding)
        .where(eq(workspaceSyncFinding.kind, 'STATUS_MISMATCH'));
      expect(findings).toHaveLength(2);
      expect(
        findings.every((f) => f.resolvedAt && f.resolution === 'status local reaplicado'),
      ).toBe(true);
      expect(findings.find((f) => f.agentId === inactive.id)?.details).toMatchObject({
        localStatus: 'INACTIVE',
        remoteStatus: 'ACTIVE',
      });
    });

    it('falha ao reaplicar status deixa divergência aberta e fecha quando corrigida', async () => {
      const t = await newTenant();
      const row = await newAgent(t.id, 'INACTIVE');
      await remoteAgents([{ id: row.gptmakerAgentId, name: 'a', status: 'ACTIVE' }]);
      await wiremock.stub({
        request: { method: 'PUT', urlPath: `/v2/agent/${row.gptmakerAgentId}/inactive` },
        response: { status: 400, jsonBody: { error: 'Erro inesperado' } },
      });

      const first = await sync();
      expect(first).toMatchObject({ statusCorrected: 0, statusCorrectionFailed: 1 });
      const second = await sync();
      expect(second.statusCorrectionFailed).toBe(1);
      const open = await db
        .select()
        .from(workspaceSyncFinding)
        .where(isNull(workspaceSyncFinding.resolvedAt));
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ kind: 'STATUS_MISMATCH', agentId: row.id });

      await wiremock.reset();
      await remoteAgents([{ id: row.gptmakerAgentId, name: 'a', status: 'DISABLED' }]);
      const third = await sync();
      expect(third.findingsResolved).toBe(1);
      const stillOpen = await db
        .select()
        .from(workspaceSyncFinding)
        .where(isNull(workspaceSyncFinding.resolvedAt));
      expect(stillOpen).toHaveLength(0);
    });

    it('não compara status ausente ou desconhecido', async () => {
      const t = await newTenant();
      const row = await newAgent(t.id, 'INACTIVE');
      const other = await newAgent(t.id, 'ACTIVE');
      await remoteAgents([
        { id: row.gptmakerAgentId, name: 'a' },
        { id: other.gptmakerAgentId, name: 'b', status: 'PAUSED' },
      ]);
      const summary = await sync();
      expect(summary).toMatchObject({ statusCorrected: 0, statusCorrectionFailed: 0 });
    });

    it('fecha órfão que sumiu do workspace', async () => {
      await remoteAgents([{ id: 'gm-temp', name: 'Temporário' }]);
      await sync();
      await wiremock.reset();
      await remoteAgents([]);
      const summary = await sync();
      expect(summary.findingsResolved).toBe(1);
      const open = await db
        .select()
        .from(workspaceSyncFinding)
        .where(
          and(eq(workspaceSyncFinding.kind, 'ORPHAN'), isNull(workspaceSyncFinding.resolvedAt)),
        );
      expect(open).toHaveLength(0);
    });
  });

  describe('workspace-health', () => {
    function service() {
      const registry = new HealthRegistry();
      const health = new WorkspaceHealthService(
        client,
        new WorkspaceStatusStore(redis),
        registry,
        redis,
      );
      return { health, registry };
    }

    it('up quando o workspace existe e está ACTIVE', async () => {
      await wiremock.stub({
        request: { method: 'GET', urlPath: '/v2/workspaces' },
        response: ok([{ id: WS }]),
      });
      await wiremock.stub({
        request: { method: 'GET', urlPath: `/v2/workspace/${WS}/credits` },
        response: ok({ credits: 900, status: 'ACTIVE' }),
      });
      const { health } = service();
      await expect(health.validateWorkspace()).resolves.toMatchObject({
        state: 'up',
        credits: 900,
      });
    });

    it('down com alerta quando a assinatura do workspace não está ACTIVE', async () => {
      await wiremock.stub({
        request: { method: 'GET', urlPath: '/v2/workspaces' },
        response: ok([{ id: WS }]),
      });
      await wiremock.stub({
        request: { method: 'GET', urlPath: `/v2/workspace/${WS}/credits` },
        response: ok({ credits: 0, status: 'PAST_DUE' }),
      });
      const { health, registry } = service();
      await health.validateWorkspace();
      health.onApplicationBootstrap();
      const components = await registry.checkAll();
      expect(components.gptmaker).toMatchObject({ status: 'down', subscriptionStatus: 'PAST_DUE' });
    });

    it('down quando o workspace configurado não pertence ao token', async () => {
      await wiremock.stub({
        request: { method: 'GET', urlPath: '/v2/workspaces' },
        response: ok([{ id: 'outro' }]),
      });
      const { health } = service();
      await expect(health.validateWorkspace()).resolves.toMatchObject({
        state: 'down',
        reason: expect.stringContaining('não encontrado'),
      });
    });

    it('down quando o token é recusado', async () => {
      await wiremock.stub({
        request: { method: 'GET', urlPath: '/v2/workspaces' },
        response: { status: 403, jsonBody: { error: 'Erro de token' } },
      });
      const { health } = service();
      await expect(health.validateWorkspace()).resolves.toMatchObject({
        state: 'down',
        reason: expect.stringContaining('UNAUTHORIZED'),
      });
    });
  });

  describe('limite de agentes por tenant', () => {
    const limit = () => new TenantAgentLimitService(db, { TENANT_AGENT_LIMIT: 2 } as Env);

    it('conta só agentes não removidos e recusa ao atingir o limite', async () => {
      const t = await newTenant();
      await newAgent(t.id);
      await newAgent(t.id, 'DELETED');
      await expect(limit().assertCanCreate(t.id)).resolves.toBeUndefined();

      await newAgent(t.id, 'INACTIVE');
      const error = await limit()
        .assertCanCreate(t.id)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: 'TENANT_AGENT_LIMIT',
        details: { limit: 2, current: 2 },
      });
    });

    it('limite é por tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await newAgent(a.id);
      await newAgent(a.id);
      await expect(limit().assertCanCreate(b.id)).resolves.toBeUndefined();
    });
  });
});
