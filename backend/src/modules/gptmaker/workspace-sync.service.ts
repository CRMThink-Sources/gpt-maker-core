import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, count, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { Gauge } from 'prom-client';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  agentCreationAttempt,
  tenant,
  workspaceReservedAgent,
  workspaceSyncFinding,
} from '../../shared/database/schema/index';
import { metricsRegistry } from '../../shared/metrics/metrics';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { tenantCodeFromGptMakerName } from './agent-naming';
import { collectAllPages } from './collect-pages';
import { GptMakerClient } from './gptmaker.client';
import { GptMakerError } from './gptmaker.errors';
import { GPTMAKER_AGENT_STATUS, type GptMakerAgent } from './gptmaker.schemas';

const PAGE_SIZE = 100;
/** Criação sem resposta do GPTMaker: casa com um órfão de mesmo nome só se for recente. */
const PENDING_ATTEMPT_DAYS = 7;
/** Registros de criação mais antigos já não servem para sugerir dono. */
const ATTEMPT_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_PAGES = 1000;

const orphansGauge = new Gauge({
  name: 'gptmaker_workspace_orphan_agents',
  help: 'Agentes no workspace GPTMaker sem registro local (divergências abertas)',
  registers: [metricsRegistry],
});

const outOfSyncGauge = new Gauge({
  name: 'gptmaker_workspace_out_of_sync_agents',
  help: 'Agentes locais ausentes no workspace GPTMaker (status OUT_OF_SYNC)',
  registers: [metricsRegistry],
});

export interface SyncSummary {
  remoteAgents: number;
  localAgents: number;
  orphansFound: number;
  missingConfirmed: number;
  missingSkipped: number;
  statusCorrected: number;
  statusCorrectionFailed: number;
  findingsResolved: number;
}

type LocalAgent = { id: string; tenantId: string; gptmakerAgentId: string; status: string };

/** Todos os agentes do workspace (paginação tolerante, ver `collectAllPages`). */
export function collectAllAgents(
  fetchPage: (page: number, pageSize: number) => Promise<GptMakerAgent[]>,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
): Promise<GptMakerAgent[]> {
  return collectAllPages(fetchPage, pageSize, maxPages);
}

/**
 * Job `workspace-sync` (spec gptmaker-workspace): compara o workspace com o registro local e
 * grava divergências: órfãos, ausentes e status ativo/inativo divergente (o local é a fonte da
 * verdade e é reaplicado no GPTMaker).
 */
@Injectable()
export class WorkspaceSyncService {
  private readonly logger = new Logger(WorkspaceSyncService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly client: GptMakerClient,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @Cron('0 * * * *', { name: 'workspace-sync' })
  async runScheduled(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive('job:workspace-sync', 30 * 60_000, () =>
          this.sync(),
        );
        if (outcome.ran) this.logger.log({ summary: outcome.result }, 'workspace-sync concluído');
      } catch (error) {
        this.logger.error({ alert: true, err: error }, 'workspace-sync falhou');
      }
    });
  }

  /** Sincronização pedida pelo backoffice, no mesmo lock do job; `null` se ele já está rodando. */
  async syncNow(): Promise<SyncSummary | null> {
    const outcome = await this.lock.runExclusive('job:workspace-sync', 30 * 60_000, () =>
      this.sync(),
    );
    return outcome.ran ? outcome.result : null;
  }

  async sync(): Promise<SyncSummary> {
    const remote = await collectAllAgents((page, pageSize) =>
      this.client.listWorkspaceAgents({ page, pageSize }),
    );
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const local = await this.db
      .select({
        id: agent.id,
        tenantId: agent.tenantId,
        gptmakerAgentId: agent.gptmakerAgentId,
        status: agent.status,
      })
      .from(agent);
    const localByRemoteId = new Map(local.map((row) => [row.gptmakerAgentId, row]));
    // Agentes do próprio app (sandbox dos templates) não têm dono por desenho.
    const reserved = new Set(
      (
        await this.db
          .select({ id: workspaceReservedAgent.gptmakerAgentId })
          .from(workspaceReservedAgent)
      ).map((row) => row.id),
    );

    const summary: SyncSummary = {
      remoteAgents: remote.length,
      localAgents: local.filter((row) => row.status !== 'DELETED').length,
      orphansFound: 0,
      missingConfirmed: 0,
      missingSkipped: 0,
      statusCorrected: 0,
      statusCorrectionFailed: 0,
      findingsResolved: 0,
    };

    for (const item of remote) {
      if (reserved.has(item.id)) continue;
      const owner = localByRemoteId.get(item.id);
      if (owner && owner.status !== 'DELETED') continue;
      if (await this.recordOrphan(item, owner?.id)) summary.orphansFound++;
    }

    for (const row of local) {
      if (row.status !== 'ACTIVE' && row.status !== 'INACTIVE') continue;
      if (remoteById.has(row.gptmakerAgentId)) continue;
      const missing = await this.confirmMissing(row.gptmakerAgentId);
      if (missing === 'missing') {
        await this.markOutOfSync(row);
        summary.missingConfirmed++;
      } else if (missing === 'unknown') {
        summary.missingSkipped++;
      }
    }

    const failedCorrections = new Set<string>();
    for (const row of local) {
      if (row.status !== 'ACTIVE' && row.status !== 'INACTIVE') continue;
      const remoteStatus = remoteById.get(row.gptmakerAgentId)?.status;
      if (!remoteStatus) continue;
      const remoteAsLocal =
        GPTMAKER_AGENT_STATUS[remoteStatus as keyof typeof GPTMAKER_AGENT_STATUS];
      if (!remoteAsLocal) {
        this.logger.warn(
          { gptmakerAgentId: row.gptmakerAgentId, remoteStatus },
          'status de agente desconhecido no GPTMaker; divergência não avaliada',
        );
        continue;
      }
      if (remoteAsLocal === row.status) continue;
      const outcome = await this.reapplyStatus(row, remoteStatus);
      if (outcome === 'corrected') summary.statusCorrected++;
      if (outcome === 'failed') {
        summary.statusCorrectionFailed++;
        failedCorrections.add(row.gptmakerAgentId);
      }
    }

    summary.findingsResolved =
      (await this.resolveStaleOrphans(remoteById, localByRemoteId)) +
      (await this.resolveStatusMismatches(failedCorrections));
    await this.db
      .delete(agentCreationAttempt)
      .where(
        lt(agentCreationAttempt.createdAt, new Date(Date.now() - ATTEMPT_RETENTION_DAYS * DAY_MS)),
      );
    await this.updateGauges();
    return summary;
  }

  /** Grava a divergência (uma aberta por agente), com o tenant sugerido como dono. */
  private async recordOrphan(item: GptMakerAgent, deletedLocalAgentId?: string): Promise<boolean> {
    const suggestedTenant = await this.suggestOwner(item);
    const suggestedTenantCode = suggestedTenant?.tenantCode ?? null;
    const inserted = await this.db
      .insert(workspaceSyncFinding)
      .values({
        kind: 'ORPHAN',
        gptmakerAgentId: item.id,
        agentId: deletedLocalAgentId,
        details: {
          name: item.name ?? null,
          suggestedTenantCode,
          suggestedTenantId: suggestedTenant?.id ?? null,
          ...(deletedLocalAgentId ? { note: 'removido localmente, ainda existe no GPTMaker' } : {}),
        },
      })
      .onConflictDoNothing()
      .returning({ id: workspaceSyncFinding.id });
    if (inserted.length > 0) {
      this.logger.warn({ gptmakerAgentId: item.id, name: item.name }, 'agente órfão no workspace');
    }
    return inserted.length > 0;
  }

  /**
   * Dono provável de um órfão: a criação que recebeu este id do GPTMaker; senão, uma criação
   * recente sem resposta com o mesmo nome (se só um tenant tiver uma); senão, o prefixo legado.
   */
  private async suggestOwner(
    item: GptMakerAgent,
  ): Promise<{ id: string; tenantCode: string } | null> {
    const owner = { id: tenant.id, tenantCode: tenant.tenantCode };
    const [byId] = await this.db
      .select(owner)
      .from(agentCreationAttempt)
      .innerJoin(tenant, eq(tenant.id, agentCreationAttempt.tenantId))
      .where(eq(agentCreationAttempt.gptmakerAgentId, item.id))
      .limit(1);
    if (byId) return byId;

    const name = item.name?.trim();
    if (!name) return null;
    const byName = await this.db
      .selectDistinct(owner)
      .from(agentCreationAttempt)
      .innerJoin(tenant, eq(tenant.id, agentCreationAttempt.tenantId))
      .where(
        and(
          isNull(agentCreationAttempt.gptmakerAgentId),
          sql`lower(trim(${agentCreationAttempt.name})) = lower(${name})`,
          gte(agentCreationAttempt.createdAt, new Date(Date.now() - PENDING_ATTEMPT_DAYS * DAY_MS)),
        ),
      );
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) return null;

    const legacyCode = tenantCodeFromGptMakerName(name);
    if (!legacyCode) return null;
    const [byPrefix] = await this.db
      .select(owner)
      .from(tenant)
      .where(eq(tenant.tenantCode, legacyCode));
    return byPrefix ?? null;
  }

  /**
   * Ausência na listagem não basta (paginação não documentada): confirma com GET e só marca
   * ausente com 404. A API documenta apenas 400 ("Erro inesperado") e 403; um 400 fica
   * indeterminado para um erro genérico não derrubar o chatbot de um cliente.
   */
  private async confirmMissing(
    gptmakerAgentId: string,
  ): Promise<'missing' | 'present' | 'unknown'> {
    try {
      await this.client.getAgent(gptmakerAgentId);
      this.logger.warn({ gptmakerAgentId }, 'agente fora da listagem, mas existe no GET');
      return 'present';
    } catch (error) {
      if (error instanceof GptMakerError && error.kind === 'NOT_FOUND') {
        return 'missing';
      }
      this.logger.warn({ gptmakerAgentId, err: error }, 'não foi possível confirmar ausência');
      return 'unknown';
    }
  }

  private async markOutOfSync(row: LocalAgent) {
    await this.db.transaction(async (tx) => {
      await tx.update(agent).set({ status: 'OUT_OF_SYNC' }).where(eq(agent.id, row.id));
      await tx
        .insert(workspaceSyncFinding)
        .values({
          kind: 'MISSING',
          gptmakerAgentId: row.gptmakerAgentId,
          agentId: row.id,
          details: { tenantId: row.tenantId, previousStatus: row.status },
        })
        .onConflictDoNothing();
    });
    this.logger.error(
      {
        alert: true,
        agentId: row.id,
        tenantId: row.tenantId,
        gptmakerAgentId: row.gptmakerAgentId,
      },
      'agente ausente no workspace GPTMaker; marcado OUT_OF_SYNC',
    );
  }

  /**
   * Reaplica o status local no GPTMaker. Relê o status local antes de agir, para não
   * desfazer uma troca feita pelo cliente durante o job. Correção feita vira divergência já
   * resolvida (registro da correção); falha fica aberta, com alerta.
   */
  private async reapplyStatus(
    row: LocalAgent,
    remoteStatus: string,
  ): Promise<'corrected' | 'failed' | 'skipped'> {
    const [current] = await this.db
      .select({ status: agent.status })
      .from(agent)
      .where(eq(agent.id, row.id));
    if (current?.status !== row.status) return 'skipped';

    const context = {
      agentId: row.id,
      tenantId: row.tenantId,
      gptmakerAgentId: row.gptmakerAgentId,
      localStatus: row.status,
      remoteStatus,
    };
    const details = { tenantId: row.tenantId, localStatus: row.status, remoteStatus };
    try {
      if (row.status === 'ACTIVE') await this.client.activateAgent(row.gptmakerAgentId);
      else await this.client.inactivateAgent(row.gptmakerAgentId);
    } catch (error) {
      await this.db
        .insert(workspaceSyncFinding)
        .values({
          kind: 'STATUS_MISMATCH',
          gptmakerAgentId: row.gptmakerAgentId,
          agentId: row.id,
          details,
        })
        .onConflictDoNothing();
      this.logger.error(
        { alert: true, ...context, err: error },
        'status divergente no GPTMaker; falha ao reaplicar o status local',
      );
      return 'failed';
    }

    const resolution = {
      resolvedAt: new Date(),
      resolvedBy: 'system:workspace-sync',
      resolution: 'status local reaplicado',
    };
    const closed = await this.db
      .update(workspaceSyncFinding)
      .set(resolution)
      .where(
        and(
          eq(workspaceSyncFinding.kind, 'STATUS_MISMATCH'),
          eq(workspaceSyncFinding.gptmakerAgentId, row.gptmakerAgentId),
          isNull(workspaceSyncFinding.resolvedAt),
        ),
      )
      .returning({ id: workspaceSyncFinding.id });
    if (closed.length === 0) {
      await this.db.insert(workspaceSyncFinding).values({
        kind: 'STATUS_MISMATCH',
        gptmakerAgentId: row.gptmakerAgentId,
        agentId: row.id,
        details,
        ...resolution,
      });
    }
    this.logger.warn(context, 'status divergente no GPTMaker; status local reaplicado');
    return 'corrected';
  }

  /** Fecha divergências de status abertas cujo agente não falhou de novo nesta execução. */
  private async resolveStatusMismatches(failed: Set<string>): Promise<number> {
    const open = await this.db
      .select({
        id: workspaceSyncFinding.id,
        gptmakerAgentId: workspaceSyncFinding.gptmakerAgentId,
      })
      .from(workspaceSyncFinding)
      .where(
        and(
          eq(workspaceSyncFinding.kind, 'STATUS_MISMATCH'),
          isNull(workspaceSyncFinding.resolvedAt),
        ),
      );
    const stale = open.filter((finding) => !failed.has(finding.gptmakerAgentId));
    if (stale.length === 0) return 0;
    await this.db
      .update(workspaceSyncFinding)
      .set({
        resolvedAt: new Date(),
        resolvedBy: 'system:workspace-sync',
        resolution: 'resolvido automaticamente',
      })
      .where(
        inArray(
          workspaceSyncFinding.id,
          stale.map((finding) => finding.id),
        ),
      );
    return stale.length;
  }

  /** Fecha divergências de órfão que deixaram de existir no workspace ou já têm dono local. */
  private async resolveStaleOrphans(
    remoteById: Map<string, GptMakerAgent>,
    localByRemoteId: Map<string, { status: string }>,
  ): Promise<number> {
    const open = await this.db
      .select({
        id: workspaceSyncFinding.id,
        gptmakerAgentId: workspaceSyncFinding.gptmakerAgentId,
      })
      .from(workspaceSyncFinding)
      .where(and(eq(workspaceSyncFinding.kind, 'ORPHAN'), isNull(workspaceSyncFinding.resolvedAt)));
    const stale = open.filter((finding) => {
      const owner = localByRemoteId.get(finding.gptmakerAgentId);
      return !remoteById.has(finding.gptmakerAgentId) || (owner && owner.status !== 'DELETED');
    });
    if (stale.length === 0) return 0;
    await this.db
      .update(workspaceSyncFinding)
      .set({
        resolvedAt: new Date(),
        resolvedBy: 'system:workspace-sync',
        resolution: 'resolvido automaticamente',
      })
      .where(
        inArray(
          workspaceSyncFinding.id,
          stale.map((finding) => finding.id),
        ),
      );
    return stale.length;
  }

  private async updateGauges(): Promise<void> {
    const [orphans] = await this.db
      .select({ total: count() })
      .from(workspaceSyncFinding)
      .where(and(eq(workspaceSyncFinding.kind, 'ORPHAN'), isNull(workspaceSyncFinding.resolvedAt)));
    const [outOfSync] = await this.db
      .select({ total: count() })
      .from(agent)
      .where(eq(agent.status, 'OUT_OF_SYNC'));
    orphansGauge.set(orphans?.total ?? 0);
    outOfSyncGauge.set(outOfSync?.total ?? 0);
  }
}
