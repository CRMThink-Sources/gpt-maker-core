import type { PlatformEvent } from '@crmthink-sources/platform-sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, subscriptionState } from '../../shared/database/schema/index';
import { CreditCycleService } from '../billing';
import { type Tenant, TenantLifecycle, TenantService } from '../tenancy';
import { graceDeadline } from './grace-period';
import { OUTBOX_OPERATIONS, PaymentsOutbox } from './payments-outbox';

/** Prefixos dos tipos tratados aqui (os de instalação ficam no `InstallationEventsConsumer`). */
export const SUBSCRIPTION_EVENT_PREFIXES = ['subscription.', 'purchase.'] as const;

export function isSubscriptionEvent(type: string): boolean {
  return SUBSCRIPTION_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

type Snapshot = Partial<{
  id: number;
  status: (typeof subscriptionState.$inferSelect)['status'];
  modality: (typeof subscriptionState.$inferSelect)['modality'];
  planId: number;
  periodStart: string;
  periodEnd: string;
  version: number;
}>;

export type ProjectionOutcome =
  { kind: 'none' } | { kind: 'obsolete' } | { kind: 'applied'; newSubscription: boolean };

/**
 * Eventos de assinatura e compra do crmthink-platform (spec payments-integration, design D9):
 * grava a projeção `subscription_state` (evento com `version` menor que a aplicada é obsoleto e
 * não tem efeito) e aplica os efeitos nos créditos. Assinatura nova agenda o espelho dos agentes
 * como itens dela; toda mudança da projeção avisa o `TenantLifecycle` (`onAccessChanged`), que
 * reativa ou inativa os agentes. `past_due` marca o fim da carência (`grace_until`, 12.5), e
 * `recovered`/`renewed`/`activated` a limpam. Troca de plano (12.6), avisos (12.7) e estornos
 * (12.8) ficam nas suas tarefas: por ora esses eventos só atualizam a projeção.
 */
@Injectable()
export class SubscriptionEventsService {
  private readonly logger = new Logger(SubscriptionEventsService.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly lifecycle: TenantLifecycle,
    private readonly cycles: CreditCycleService,
    private readonly outbox: PaymentsOutbox,
    @Inject(DB) private readonly db: Database,
  ) {}

  async handle(event: PlatformEvent): Promise<ProjectionOutcome> {
    const tenant = await this.tenants.findByInstallationId(event.installationId);
    if (!tenant) {
      // A instalação chega antes pelo instalador; sem tenant, o evento é de outro ambiente.
      this.logger.warn(
        { eventId: event.eventId, type: event.type },
        'evento de instalação desconhecida',
      );
      return { kind: 'none' };
    }
    const snapshot = (event.subscription ?? null) as Snapshot | null;
    const projection = await this.project(tenant.id, snapshot);
    if (projection.kind === 'obsolete' && !isFinancial(event.type)) {
      this.logger.log(
        { eventId: event.eventId, type: event.type },
        'evento de assinatura obsoleto',
      );
      return projection;
    }

    await this.applyEffects(tenant, event, snapshot);

    if (projection.kind === 'applied') {
      if (projection.newSubscription) await this.mirrorAgents(tenant.id);
      await this.lifecycle.emit('onAccessChanged', tenant);
    }
    return projection;
  }

  private async applyEffects(
    tenant: Tenant,
    event: PlatformEvent,
    snapshot: Snapshot | null,
  ): Promise<void> {
    const subscriptionId = snapshot?.id !== undefined ? String(snapshot.id) : null;
    switch (event.type) {
      case 'subscription.trial_started': {
        if (!subscriptionId) return;
        await this.cycles.startTrial({
          tenantId: tenant.id,
          subscriptionId,
          trialEndsAt: new Date(event.data.trialEndsAt),
        });
        return;
      }
      case 'subscription.past_due': {
        // A primeira falha marca o prazo; novas falhas na mesma carência não o estendem.
        await this.db
          .update(subscriptionState)
          .set({ graceUntil: graceDeadline(new Date(event.occurredAt)) })
          .where(
            and(
              eq(subscriptionState.tenantId, tenant.id),
              eq(subscriptionState.status, 'past_due'),
              isNull(subscriptionState.graceUntil),
            ),
          );
        return;
      }
      case 'subscription.recovered': {
        await this.clearGrace(tenant.id);
        return;
      }
      case 'subscription.activated':
      case 'subscription.renewed': {
        await this.clearGrace(tenant.id);
        if (
          !subscriptionId ||
          snapshot?.planId === undefined ||
          !snapshot.periodStart ||
          !snapshot.periodEnd
        ) {
          this.logger.error(
            { alert: true, eventId: event.eventId },
            'virada de ciclo sem assinatura completa',
          );
          return;
        }
        await this.cycles.startCycle({
          tenantId: tenant.id,
          subscriptionId,
          planId: String(snapshot.planId),
          periodStart: new Date(snapshot.periodStart),
          periodEnd: new Date(snapshot.periodEnd),
        });
        return;
      }
      case 'subscription.ended': {
        if (!subscriptionId) return;
        await this.cycles.endSubscription({ tenantId: tenant.id, subscriptionId });
        return;
      }
      case 'purchase.paid': {
        await this.cycles.creditPurchase({
          tenantId: tenant.id,
          purchaseId: String(event.data.purchaseId),
          planId: String(event.data.planId),
          quantity: event.data.quantity,
        });
        return;
      }
      default:
        return;
    }
  }

  /**
   * Projeção com controle de versão. Outra assinatura (nova contratação, inclusive depois de
   * encerrada) substitui a anterior. Evento sem `version` (ex.: `ended`) mantém a última versão.
   */
  async project(tenantId: string, snapshot: Snapshot | null): Promise<ProjectionOutcome> {
    if (!snapshot?.id || !snapshot.status) return { kind: 'none' };
    const [stored] = await this.db
      .select()
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, tenantId));
    const sameSubscription = stored?.subscriptionId === String(snapshot.id);
    if (sameSubscription && snapshot.version !== undefined && snapshot.version < stored.version) {
      return { kind: 'obsolete' };
    }

    const values = {
      subscriptionId: String(snapshot.id),
      status: snapshot.status,
      modality: snapshot.modality ?? stored?.modality ?? 'stripe',
      planId: snapshot.planId !== undefined ? String(snapshot.planId) : (stored?.planId ?? null),
      periodStart: snapshot.periodStart
        ? new Date(snapshot.periodStart)
        : (stored?.periodStart ?? null),
      periodEnd: snapshot.periodEnd
        ? new Date(snapshot.periodEnd)
        : sameSubscription
          ? (stored?.periodEnd ?? null)
          : null,
      version: snapshot.version ?? (sameSubscription ? stored!.version : 0),
      ...(sameSubscription ? {} : { graceUntil: null, cancelAt: null, nextPlanId: null }),
    };
    await this.db
      .insert(subscriptionState)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: subscriptionState.tenantId, set: values });
    return { kind: 'applied', newSubscription: !sameSubscription };
  }

  /** Pagamento em dia: sem carência (e a marca de aviso do vencimento deixa de valer). */
  private async clearGrace(tenantId: string): Promise<void> {
    await this.db
      .update(subscriptionState)
      .set({ graceUntil: null })
      .where(eq(subscriptionState.tenantId, tenantId));
  }

  /** Assinatura nova: os agentes não removidos viram itens dela (o espelho sem assinatura é descartado). */
  private async mirrorAgents(tenantId: string): Promise<void> {
    const rows = await this.db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.tenantId, tenantId), ne(agent.status, 'DELETED')));
    for (const row of rows) {
      await this.outbox.enqueue(tenantId, OUTBOX_OPERATIONS.agentItemSync, row.id);
    }
  }
}

/** Compras e cobranças valem mesmo fora de ordem (design D9: exceto financeiros). */
function isFinancial(type: string): boolean {
  return type.startsWith('purchase.') || type.startsWith('charge.');
}
