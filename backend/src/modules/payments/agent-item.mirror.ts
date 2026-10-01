import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, subscriptionState, tenant } from '../../shared/database/schema/index';
import { PlatformApiClient, PlatformError } from '../../shared/platform/platform-api.client';
import type { OutboxOutcome, OutboxRow } from './payments-outbox';

/** Sem assinatura que aceite itens: nada a espelhar até a próxima assinatura (seção 12). */
const NO_SUBSCRIPTION_CODES = new Set(['NO_SUBSCRIPTION', 'SUBSCRIPTION_ENDED']);
const ENDED_STATUSES = new Set(['cancelled', 'trial_expired']);

/**
 * Espelha o agente como item não cobrável (`billable = false`) da assinatura do tenant
 * (spec payments-integration), com `externalRef` = id local do agente. Leva o estado atual do
 * agente ao serviço, então reprocessar ou fundir mudanças dá o mesmo resultado: ativo ⇒ item
 * `active`; inativo ou fora de sincronia ⇒ `cancelled`; removido ⇒ item removido.
 */
@Injectable()
export class AgentItemMirror {
  constructor(
    private readonly platform: PlatformApiClient,
    @Inject(DB) private readonly db: Database,
  ) {}

  async sync(row: OutboxRow): Promise<OutboxOutcome> {
    const [current] = await this.db
      .select({ id: agent.id, name: agent.name, status: agent.status })
      .from(agent)
      .where(eq(agent.id, row.aggregateRef));
    if (!current) return { skipped: 'agente inexistente' };

    try {
      const subscriptionId = await this.subscriptionOf(row.tenantId);
      if (current.status === 'DELETED') {
        await this.remove(subscriptionId, current.id);
        return;
      }
      const item = await this.platform.createItem(subscriptionId, {
        externalRef: current.id,
        title: current.name,
        billable: false,
      });
      const status = current.status === 'ACTIVE' ? 'active' : 'cancelled';
      if (item.title !== current.name || item.status !== status) {
        await this.platform.updateItem(subscriptionId, item.itemId, {
          title: current.name,
          status,
        });
      }
    } catch (error) {
      if (error instanceof PlatformError && NO_SUBSCRIPTION_CODES.has(error.code)) {
        return { skipped: `sem assinatura que aceite itens (${error.code})` };
      }
      throw error;
    }
  }

  private async remove(subscriptionId: number, agentId: string): Promise<void> {
    const items = await this.platform.listItems(subscriptionId);
    const item = items.find((entry) => entry.externalRef === agentId && !entry.deletedAt);
    if (!item) return;
    try {
      await this.platform.removeItem(subscriptionId, item.itemId);
    } catch (error) {
      // Removido numa tentativa anterior cuja resposta se perdeu.
      if (!(error instanceof PlatformError && error.code === 'ITEM_NOT_FOUND')) throw error;
    }
  }

  /**
   * Assinatura da projeção local; sem projeção ou com a local encerrada, pergunta à plataforma
   * (a projeção pode estar atrasada em relação aos eventos).
   */
  private async subscriptionOf(tenantId: string): Promise<number> {
    const [local] = await this.db
      .select({
        subscriptionId: subscriptionState.subscriptionId,
        status: subscriptionState.status,
      })
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, tenantId));
    if (local && !ENDED_STATUSES.has(local.status)) return Number(local.subscriptionId);

    const [owner] = await this.db
      .select({ installationId: tenant.installationId })
      .from(tenant)
      .where(eq(tenant.id, tenantId));
    const remote = await this.platform.getSubscription(Number(owner!.installationId));
    return remote.subscriptionId;
  }
}
