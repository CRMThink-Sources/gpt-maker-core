import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminWorkspaceView, AgentView, WorkspaceSyncView } from '@gptmaker/contracts';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, tenant, workspaceSyncFinding } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AgentService } from '../agents';
import {
  GptMakerClient,
  GptMakerError,
  WorkspaceHealthService,
  WorkspaceStatusStore,
  WorkspaceSyncService,
} from '../gptmaker';
import { AuditService } from './audit.service';

interface OrphanDetails {
  name?: string | null;
  suggestedTenantId?: string | null;
  note?: string;
}

const findingNotFound = () =>
  new DomainError(
    'FINDING_NOT_FOUND',
    'Divergência não encontrada ou já resolvida.',
    HttpStatus.NOT_FOUND,
  );

/**
 * Workspace GPTMaker no backoffice (spec admin-backoffice e gptmaker-workspace; tarefa 15.6):
 * saúde e créditos (job `workspace-health`), órfãos e agentes fora de sincronia (job
 * `workspace-sync`). Ações do ADMIN: remover órfão do GPTMaker, vincular órfão a um portal
 * (`AgentService.adopt`) e sincronizar agora. Tudo auditado.
 */
@Injectable()
export class WorkspaceAdminService {
  constructor(
    private readonly client: GptMakerClient,
    private readonly health: WorkspaceHealthService,
    private readonly statusStore: WorkspaceStatusStore,
    private readonly sync: WorkspaceSyncService,
    private readonly agents: AgentService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async view(): Promise<AdminWorkspaceView> {
    const [status, open, outOfSync, recent] = await Promise.all([
      this.statusStore.load(),
      this.db
        .select()
        .from(workspaceSyncFinding)
        .where(
          and(eq(workspaceSyncFinding.kind, 'ORPHAN'), isNull(workspaceSyncFinding.resolvedAt)),
        )
        .orderBy(desc(workspaceSyncFinding.detectedAt)),
      this.db
        .select({
          agentId: agent.id,
          name: agent.name,
          gptmakerAgentId: agent.gptmakerAgentId,
          tenantId: tenant.id,
          domain: tenant.domain,
          detectedAt: workspaceSyncFinding.detectedAt,
        })
        .from(agent)
        .innerJoin(tenant, eq(tenant.id, agent.tenantId))
        .leftJoin(
          workspaceSyncFinding,
          and(
            eq(workspaceSyncFinding.agentId, agent.id),
            eq(workspaceSyncFinding.kind, 'MISSING'),
            isNull(workspaceSyncFinding.resolvedAt),
          ),
        )
        .where(eq(agent.status, 'OUT_OF_SYNC')),
      this.db
        .select()
        .from(workspaceSyncFinding)
        .where(isNotNull(workspaceSyncFinding.resolvedAt))
        .orderBy(desc(workspaceSyncFinding.resolvedAt))
        .limit(20),
    ]);

    const suggestedIds = open
      .map((f) => (f.details as OrphanDetails | null)?.suggestedTenantId)
      .filter((id): id is string => Boolean(id));
    const suggested = suggestedIds.length
      ? await this.db
          .select({ id: tenant.id, domain: tenant.domain, tenantCode: tenant.tenantCode })
          .from(tenant)
          .where(inArray(tenant.id, suggestedIds))
      : [];

    return {
      status: status
        ? {
            state: status.state,
            checkedAt: status.checkedAt,
            reason: status.reason ?? null,
            subscriptionStatus: status.subscriptionStatus ?? null,
            credits: status.credits ?? null,
          }
        : null,
      orphans: open.map((f) => {
        const details = (f.details ?? {}) as OrphanDetails;
        return {
          findingId: f.id,
          gptmakerAgentId: f.gptmakerAgentId,
          name: details.name ?? null,
          detectedAt: f.detectedAt.toISOString(),
          suggestedTenant: suggested.find((t) => t.id === details.suggestedTenantId) ?? null,
          removedLocally: f.agentId !== null,
        };
      }),
      outOfSync: outOfSync.map((row) => ({
        agentId: row.agentId,
        name: row.name,
        gptmakerAgentId: row.gptmakerAgentId,
        tenant: { id: row.tenantId, domain: row.domain },
        detectedAt: row.detectedAt?.toISOString() ?? null,
      })),
      recent: recent.map((f) => ({
        kind: f.kind,
        gptmakerAgentId: f.gptmakerAgentId,
        resolvedAt: f.resolvedAt!.toISOString(),
        resolvedBy: f.resolvedBy,
        resolution: f.resolution,
      })),
    };
  }

  /** Checagem de saúde e créditos agora (o job roda a cada 15 min). */
  async refreshHealth(): Promise<AdminWorkspaceView> {
    await this.health.validateWorkspace();
    return this.view();
  }

  async syncNow(actor: string): Promise<WorkspaceSyncView> {
    const summary = await this.sync.syncNow();
    await this.audit.record({
      actorId: actor,
      action: 'workspace.sync_requested',
      entityType: 'workspace',
      after: summary,
    });
    return {
      summary: summary && {
        remoteAgents: summary.remoteAgents,
        localAgents: summary.localAgents,
        orphansFound: summary.orphansFound,
        missingConfirmed: summary.missingConfirmed,
        statusCorrected: summary.statusCorrected,
        findingsResolved: summary.findingsResolved,
      },
    };
  }

  /** Remove o órfão do GPTMaker (já ausente conta como removido) e fecha a divergência. */
  async removeOrphan(findingId: string, actor: string): Promise<AdminWorkspaceView> {
    const finding = await this.openOrphan(findingId);
    try {
      await this.client.deleteAgent(finding.gptmakerAgentId);
    } catch (error) {
      if (!(error instanceof GptMakerError && error.kind === 'NOT_FOUND')) throw error;
    }
    await this.resolve(findingId, actor, 'removido do GPTMaker pelo backoffice');
    await this.audit.record({
      actorId: actor,
      action: 'workspace.orphan_removed',
      entityType: 'gptmaker_agent',
      entityId: finding.gptmakerAgentId,
      before: finding.details,
    });
    return this.view();
  }

  /** Vincula o órfão a um portal: vira agente do tenant (sem o prefixo legado no nome). */
  async linkOrphan(findingId: string, tenantId: string, actor: string): Promise<AgentView> {
    const finding = await this.openOrphan(findingId);
    const [owner] = await this.db.select().from(tenant).where(eq(tenant.id, tenantId));
    if (!owner || owner.status === 'UNINSTALLED') {
      throw new DomainError(
        'TENANT_NOT_FOUND',
        'Portal não encontrado ou desinstalado.',
        HttpStatus.NOT_FOUND,
      );
    }
    const linked = await this.agents.adopt({ tenantId: owner.id }, finding.gptmakerAgentId);
    await this.resolve(findingId, actor, `vinculado ao portal ${owner.domain}`);
    await this.audit.record({
      actorId: actor,
      tenantId: owner.id,
      action: 'workspace.orphan_linked',
      entityType: 'agent',
      entityId: linked.id,
      before: finding.details,
      after: { tenantId: owner.id, agentId: linked.id, name: linked.name },
    });
    return linked;
  }

  private async openOrphan(findingId: string) {
    const [finding] = await this.db
      .select()
      .from(workspaceSyncFinding)
      .where(
        and(
          eq(workspaceSyncFinding.id, findingId),
          eq(workspaceSyncFinding.kind, 'ORPHAN'),
          isNull(workspaceSyncFinding.resolvedAt),
        ),
      );
    if (!finding) throw findingNotFound();
    return finding;
  }

  private async resolve(findingId: string, actor: string, resolution: string): Promise<void> {
    await this.db
      .update(workspaceSyncFinding)
      .set({ resolvedAt: new Date(), resolvedBy: `operator:${actor}`, resolution })
      .where(eq(workspaceSyncFinding.id, findingId));
  }
}
