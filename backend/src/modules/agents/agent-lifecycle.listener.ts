import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { GptMakerClient, GptMakerError } from '../gptmaker';
import { OUTBOX_OPERATIONS, PaymentsOutbox } from '../payments';
import { type Tenant, TenantLifecycle, type TenantLifecycleListener } from '../tenancy';
import { DB, type Database } from '../../shared/database/database.module';
import { agent } from '../../shared/database/schema/index';

/**
 * Desinstalação inativa no GPTMaker todos os agentes ativos do tenant (motivo `UNINSTALLED`);
 * reinstalação reativa só os que a desinstalação inativou, preservando inativações manuais e
 * por assinatura. Idempotente: cada agente é atualizado no banco logo após o GPTMaker confirmar,
 * junto com o espelho do item de assinatura.
 */
@Injectable()
export class AgentLifecycleListener implements TenantLifecycleListener, OnModuleInit {
  readonly name = 'agents';
  private readonly logger = new Logger(AgentLifecycleListener.name);

  constructor(
    private readonly lifecycle: TenantLifecycle,
    private readonly gptmaker: GptMakerClient,
    private readonly outbox: PaymentsOutbox,
    @Inject(DB) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.lifecycle.register(this);
  }

  async onUninstalled(tenant: Tenant): Promise<void> {
    const active = await this.agents(tenant.id, 'ACTIVE');
    for (const row of active) {
      await this.remote(() => this.gptmaker.inactivateAgent(row.gptmakerAgentId));
      await this.db.transaction(async (tx) => {
        await tx
          .update(agent)
          .set({ status: 'INACTIVE', inactiveReason: 'UNINSTALLED' })
          .where(and(eq(agent.id, row.id), eq(agent.status, 'ACTIVE')));
        await this.outbox.enqueue(tenant.id, OUTBOX_OPERATIONS.agentItemSync, row.id, tx);
      });
    }
    if (active.length)
      this.logger.log({ count: active.length }, 'agentes inativados na desinstalação');
  }

  async onInstalled(tenant: Tenant, event: { reinstall: boolean }): Promise<void> {
    if (!event.reinstall) return;
    const inactive = (await this.agents(tenant.id, 'INACTIVE')).filter(
      (row) => row.inactiveReason === 'UNINSTALLED',
    );
    for (const row of inactive) {
      await this.remote(() => this.gptmaker.activateAgent(row.gptmakerAgentId));
      await this.db.transaction(async (tx) => {
        await tx
          .update(agent)
          .set({ status: 'ACTIVE', inactiveReason: null })
          .where(and(eq(agent.id, row.id), eq(agent.inactiveReason, 'UNINSTALLED')));
        await this.outbox.enqueue(tenant.id, OUTBOX_OPERATIONS.agentItemSync, row.id, tx);
      });
    }
    if (inactive.length)
      this.logger.log({ count: inactive.length }, 'agentes reativados na reinstalação');
  }

  private agents(tenantId: string, status: 'ACTIVE' | 'INACTIVE') {
    return this.db
      .select({
        id: agent.id,
        gptmakerAgentId: agent.gptmakerAgentId,
        inactiveReason: agent.inactiveReason,
      })
      .from(agent)
      .where(and(eq(agent.tenantId, tenantId), eq(agent.status, status)));
  }

  /** Agente que sumiu do GPTMaker não bloqueia: o `workspace-sync` o marca `OUT_OF_SYNC`. */
  private async remote(call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch (error) {
      if (error instanceof GptMakerError && error.kind === 'NOT_FOUND') return;
      throw error;
    }
  }
}
