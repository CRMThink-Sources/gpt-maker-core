import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentService } from '../../src/modules/agents/agent.service';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { WorkspaceAdminService } from '../../src/modules/backoffice/workspace-admin.service';
import type { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerError } from '../../src/modules/gptmaker/gptmaker.errors';
import type { WorkspaceHealthService } from '../../src/modules/gptmaker/workspace-health.service';
import { WorkspaceStatusStore } from '../../src/modules/gptmaker/workspace-status.store';
import type { WorkspaceSyncService } from '../../src/modules/gptmaker/workspace-sync.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const { agent, aiModel, auditLog, tenant, workspaceSyncFinding } = schema;

// Workspace GPTMaker no backoffice (spec admin-backoffice e gptmaker-workspace; tarefa 15.6).
describe('backoffice: workspace GPTMaker', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let service: WorkspaceAdminService;
  let owner: typeof tenant.$inferSelect;
  let modelId: string;
  const actor = randomUUID();
  const deleted: string[] = [];
  const adopted: Array<{ tenantId: string; gptmakerAgentId: string }> = [];
  let deleteFails: GptMakerError | null = null;

  async function orphan(name: string | null, extra: Record<string, unknown> = {}) {
    const [row] = await db
      .insert(workspaceSyncFinding)
      .values({
        kind: 'ORPHAN',
        gptmakerAgentId: `gm-${randomUUID()}`,
        details: { name, suggestedTenantCode: null, suggestedTenantId: null, ...extra },
      })
      .returning();
    return row!;
  }

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const client = {
      deleteAgent: async (id: string) => {
        if (deleteFails) throw deleteFails;
        deleted.push(id);
      },
    } as unknown as GptMakerClient;
    const agents = {
      adopt: async (who: { tenantId: string }, gptmakerAgentId: string) => {
        adopted.push({ tenantId: who.tenantId, gptmakerAgentId });
        return { id: randomUUID(), name: 'Vendedor' };
      },
    } as unknown as AgentService;
    const store = new WorkspaceStatusStore(redis);
    service = new WorkspaceAdminService(
      client,
      { validateWorkspace: async () => undefined } as unknown as WorkspaceHealthService,
      store,
      { syncNow: async () => null } as unknown as WorkspaceSyncService,
      agents,
      new AuditService(db),
      db,
    );
    await store.save({
      state: 'up',
      checkedAt: new Date().toISOString(),
      subscriptionStatus: 'ACTIVE',
      credits: 1234,
    });
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    deleted.length = 0;
    adopted.length = 0;
    deleteFails = null;
    await db.delete(workspaceSyncFinding);
    const code = randomBytes(3).toString('hex');
    [owner] = (await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning()) as [typeof tenant.$inferSelect];
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('visão: saúde, órfãos com portal sugerido, fora de sincronia e resoluções recentes', async () => {
    const suggested = await orphan(`[${owner.tenantCode}] Vendedor`, {
      suggestedTenantId: owner.id,
    });
    const [lost] = await db
      .insert(agent)
      .values({
        tenantId: owner.id,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Sumido',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        status: 'OUT_OF_SYNC',
        webhookTokenHash: randomUUID(),
      })
      .returning();
    await db.insert(workspaceSyncFinding).values({
      kind: 'MISSING',
      gptmakerAgentId: lost!.gptmakerAgentId,
      agentId: lost!.id,
    });
    await db.insert(workspaceSyncFinding).values({
      kind: 'STATUS_MISMATCH',
      gptmakerAgentId: 'gm-x',
      resolvedAt: new Date(),
      resolvedBy: 'system:workspace-sync',
      resolution: 'status reaplicado',
    });

    const view = await service.view();
    expect(view.status).toMatchObject({ state: 'up', credits: 1234, subscriptionStatus: 'ACTIVE' });
    expect(view.orphans).toEqual([
      expect.objectContaining({
        findingId: suggested.id,
        name: `[${owner.tenantCode}] Vendedor`,
        suggestedTenant: { id: owner.id, domain: owner.domain, tenantCode: owner.tenantCode },
        removedLocally: false,
      }),
    ]);
    expect(view.outOfSync).toEqual([
      expect.objectContaining({
        agentId: lost!.id,
        name: 'Sumido',
        tenant: { id: owner.id, domain: owner.domain },
      }),
    ]);
    expect(view.recent.map((r) => r.resolution)).toContain('status reaplicado');
  });

  it('remover órfão: apaga no GPTMaker, resolve e audita; ausente lá conta como removido', async () => {
    const finding = await orphan('Teste');
    const view = await service.removeOrphan(finding.id, actor);
    expect(deleted).toEqual([finding.gptmakerAgentId]);
    expect(view.orphans).toEqual([]);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, finding.gptmakerAgentId));
    expect(audit).toMatchObject({ action: 'workspace.orphan_removed', actorId: actor });

    const gone = await orphan('Já apagado');
    deleteFails = new GptMakerError('NOT_FOUND', 'agent.delete', 'não existe');
    await service.removeOrphan(gone.id, actor);
    const [row] = await db
      .select()
      .from(workspaceSyncFinding)
      .where(eq(workspaceSyncFinding.id, gone.id));
    expect(row!.resolvedAt).not.toBeNull();
  });

  it('vincular órfão a um portal: adota pelo serviço de agentes e resolve a divergência', async () => {
    const finding = await orphan('Vendedor');
    const linked = await service.linkOrphan(finding.id, owner.id, actor);
    expect(linked.name).toBe('Vendedor');
    expect(adopted).toEqual([{ tenantId: owner.id, gptmakerAgentId: finding.gptmakerAgentId }]);
    const [row] = await db
      .select()
      .from(workspaceSyncFinding)
      .where(eq(workspaceSyncFinding.id, finding.id));
    expect(row).toMatchObject({
      resolvedBy: `operator:${actor}`,
      resolution: `vinculado ao portal ${owner.domain}`,
    });

    // Já resolvida: não age de novo.
    const again = await service
      .linkOrphan(finding.id, owner.id, actor)
      .catch((e: { code: string }) => e.code);
    expect(again).toBe('FINDING_NOT_FOUND');
  });

  it('vincular a portal desinstalado é recusado', async () => {
    const finding = await orphan('Vendedor');
    await db.update(tenant).set({ status: 'UNINSTALLED' }).where(eq(tenant.id, owner.id));
    const code = await service
      .linkOrphan(finding.id, owner.id, actor)
      .catch((e: { code: string }) => e.code);
    expect(code).toBe('TENANT_NOT_FOUND');
    expect(adopted).toEqual([]);
  });
});
