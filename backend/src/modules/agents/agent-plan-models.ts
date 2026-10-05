import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, subscriptionState } from '../../shared/database/schema/index';
import { GptMakerClient } from '../gptmaker';
import { ModelCatalogService } from '../models';
import { MESSAGES, NotificationService } from '../notifications';
import { type Tenant, TenantLifecycle, type TenantLifecycleListener } from '../tenancy';

/**
 * Modelos dos agentes conforme o plano vigente (spec payments-integration, "Downgrade com modelo
 * não permitido"; tarefa 12.6): a cada mudança da assinatura (`onAccessChanged`), agente com
 * modelo que o plano não permite (nem é o padrão do catálogo, sempre permitido) passa para o
 * modelo padrão, no GPTMaker e localmente, e os destinatários recebem `MODEL_DOWNGRADED`.
 * Idempotente: sem divergência, nada muda. Falha num agente não impede os demais; a próxima
 * mudança da assinatura tenta de novo.
 */
@Injectable()
export class AgentPlanModels implements TenantLifecycleListener, OnModuleInit {
  readonly name = 'agent-plan-models';
  private readonly logger = new Logger(AgentPlanModels.name);

  constructor(
    private readonly lifecycle: TenantLifecycle,
    private readonly gptmaker: GptMakerClient,
    private readonly models: ModelCatalogService,
    private readonly notifications: NotificationService,
    @Inject(DB) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.lifecycle.register(this);
  }

  async onAccessChanged(tenant: Tenant): Promise<void> {
    await this.enforce(tenant.id);
  }

  /** Agentes trocados para o modelo padrão. */
  async enforce(tenantId: string): Promise<string[]> {
    const [projection] = await this.db
      .select({ planId: subscriptionState.planId })
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, tenantId));
    if (!projection?.planId) return [];

    const fallback = (await this.models.list()).find((model) => model.isDefault && model.active);
    if (!fallback) {
      this.logger.error({ alert: true, tenantId }, 'sem modelo padrão para o downgrade de plano');
      return [];
    }
    const allowed = new Set(
      (await this.models.listAllowedForPlan(projection.planId)).map((model) => model.id),
    );
    allowed.add(fallback.id);

    const rows = await this.db
      .select({
        id: agent.id,
        name: agent.name,
        modelId: agent.modelId,
        gptmakerAgentId: agent.gptmakerAgentId,
        status: agent.status,
        settings: agent.settings,
      })
      .from(agent)
      .where(
        and(
          eq(agent.tenantId, tenantId),
          inArray(agent.status, ['ACTIVE', 'INACTIVE', 'OUT_OF_SYNC']),
        ),
      );
    const changed: Array<{ id: string; name: string }> = [];
    for (const row of rows) {
      if (allowed.has(row.modelId)) continue;
      try {
        // Fora de sincronia não existe no GPTMaker: só o registro local muda.
        if (row.status !== 'OUT_OF_SYNC') {
          await this.gptmaker.updateAgentSettings(row.gptmakerAgentId, {
            ...row.settings,
            prefferModel: fallback.code,
          });
        }
        const updated = await this.db
          .update(agent)
          .set({ modelId: fallback.id })
          .where(and(eq(agent.id, row.id), eq(agent.modelId, row.modelId)))
          .returning({ id: agent.id });
        if (updated.length) changed.push({ id: row.id, name: row.name });
      } catch (error) {
        this.logger.error(
          { alert: true, err: error, tenantId, agentId: row.id },
          'falha ao trocar o modelo do agente no downgrade',
        );
      }
    }

    if (changed.length) {
      this.logger.warn(
        { tenantId, planId: projection.planId, agents: changed.map((a) => a.id) },
        'agentes passaram para o modelo padrão (plano não permite o modelo)',
      );
      await this.notifications.notify({
        tenantId,
        type: 'MODEL_DOWNGRADED',
        dedupeKey: `${projection.planId}:${changed
          .map((a) => a.id)
          .sort()
          .join(',')}`,
        message: MESSAGES.modelDowngraded({
          agents: changed.map((a) => a.name),
          model: fallback.displayName,
        }),
      });
    }
    return changed.map((a) => a.id);
  }
}
