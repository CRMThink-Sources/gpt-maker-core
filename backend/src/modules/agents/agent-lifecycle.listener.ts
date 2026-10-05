import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { GptMakerClient, GptMakerError } from '../gptmaker';
import { OUTBOX_OPERATIONS, PaymentsOutbox } from '../payments';
import { type Tenant, TenantLifecycle, type TenantLifecycleListener } from '../tenancy';
import { DB, type Database } from '../../shared/database/database.module';
import { agent } from '../../shared/database/schema/index';
import {
  AgentAccessPolicy,
  SYSTEM_REASONS,
  type SystemInactiveReason,
} from './agent-access.policy';

/**
 * Inativação e reativação automáticas (spec agent-management): a cada mudança no tenant
 * (desinstalação, reinstalação, suspensão, assinatura), leva os agentes ao estado que a
 * `AgentAccessPolicy` permite. Com bloqueio, os ativos são inativados com o motivo; sem bloqueio,
 * voltam só os inativados pelo sistema. Inativação manual nunca é tocada. Idempotente: cada
 * agente é gravado logo após o GPTMaker confirmar, junto com o espelho do item de assinatura.
 */
@Injectable()
export class AgentLifecycleListener implements TenantLifecycleListener, OnModuleInit {
  readonly name = 'agents';
  private readonly logger = new Logger(AgentLifecycleListener.name);

  constructor(
    private readonly lifecycle: TenantLifecycle,
    private readonly gptmaker: GptMakerClient,
    private readonly outbox: PaymentsOutbox,
    private readonly access: AgentAccessPolicy,
    @Inject(DB) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.lifecycle.register(this);
  }

  async onUninstalled(tenant: Tenant): Promise<void> {
    await this.reconcile(tenant);
  }

  async onInstalled(tenant: Tenant, event: { reinstall: boolean }): Promise<void> {
    if (event.reinstall) await this.reconcile(tenant);
  }

  async onAccessChanged(tenant: Tenant): Promise<void> {
    await this.reconcile(tenant);
  }

  async reconcile(tenant: Pick<Tenant, 'id' | 'status'>): Promise<void> {
    const reason = await this.access.blockingReason(tenant.id, tenant.status);
    if (reason) await this.block(tenant.id, reason);
    else await this.unblock(tenant.id);
  }

  private async block(tenantId: string, reason: SystemInactiveReason): Promise<void> {
    const rows = await this.agents(tenantId);
    let inactivated = 0;
    for (const row of rows) {
      if (row.status === 'ACTIVE') {
        await this.remote(() => this.gptmaker.inactivateAgent(row.gptmakerAgentId));
        await this.save(tenantId, row.id, { status: 'ACTIVE', inactiveReason: null }, reason);
        inactivated += 1;
      } else if (row.inactiveReason !== 'MANUAL' && row.inactiveReason !== reason) {
        // Já inativo por outra causa do sistema: só atualiza o motivo, o item segue `cancelled`.
        await this.db
          .update(agent)
          .set({ inactiveReason: reason })
          .where(and(eq(agent.id, row.id), eq(agent.status, 'INACTIVE')));
      }
    }
    if (inactivated) this.logger.log({ count: inactivated, reason }, 'agentes inativados');
  }

  private async unblock(tenantId: string): Promise<void> {
    const rows = (await this.agents(tenantId)).filter(
      (row) => row.status === 'INACTIVE' && isSystemReason(row.inactiveReason),
    );
    for (const row of rows) {
      await this.remote(() => this.gptmaker.activateAgent(row.gptmakerAgentId));
      await this.save(tenantId, row.id, { status: 'INACTIVE', inactiveReason: row.inactiveReason });
    }
    if (rows.length) this.logger.log({ count: rows.length }, 'agentes reativados');
  }

  /**
   * Grava a transição só se o agente ainda estiver como foi lido (uma ação manual no meio vence)
   * e agenda o espelho na mesma transação. `reason` presente ⇒ inativa; ausente ⇒ reativa.
   */
  private async save(
    tenantId: string,
    id: string,
    from: { status: 'ACTIVE' | 'INACTIVE'; inactiveReason: string | null },
    reason?: SystemInactiveReason,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const changed = await tx
        .update(agent)
        .set(
          reason
            ? { status: 'INACTIVE', inactiveReason: reason }
            : { status: 'ACTIVE', inactiveReason: null },
        )
        .where(
          and(
            eq(agent.id, id),
            eq(agent.status, from.status),
            from.inactiveReason
              ? eq(agent.inactiveReason, from.inactiveReason as SystemInactiveReason)
              : undefined,
          ),
        )
        .returning({ id: agent.id });
      if (changed.length) {
        await this.outbox.enqueue(tenantId, OUTBOX_OPERATIONS.agentItemSync, id, tx);
      }
    });
  }

  /** Ativos e inativos; removidos e fora de sincronia ficam de fora. */
  private agents(tenantId: string) {
    return this.db
      .select({
        id: agent.id,
        gptmakerAgentId: agent.gptmakerAgentId,
        status: agent.status,
        inactiveReason: agent.inactiveReason,
      })
      .from(agent)
      .where(and(eq(agent.tenantId, tenantId), inArray(agent.status, ['ACTIVE', 'INACTIVE'])));
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

function isSystemReason(reason: string | null): reason is SystemInactiveReason {
  return SYSTEM_REASONS.includes(reason as SystemInactiveReason);
}
