import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Plan } from '@crmthink-sources/platform-sdk';
import type {
  AdminPlatformEvent,
  AdminSubscriptionCheckView,
  AdminSubscriptionView,
} from '@gptmaker/contracts';
import { desc, eq } from 'drizzle-orm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { paymentEvent, subscriptionState, tenant } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import {
  isPlatformUnavailable,
  PlatformApiClient,
} from '../../shared/platform/platform-api.client';
import { SubscriptionConsistencyService } from '../payments';
import { AuditService } from './audit.service';

const EVENTS_LIMIT = 30;

const notFound = () =>
  new DomainError('TENANT_NOT_FOUND', 'Portal não encontrado.', HttpStatus.NOT_FOUND);

/**
 * Assinatura do portal no backoffice (spec admin-backoffice, "Visão de assinaturas"; tarefa
 * 15.5): projeção local, eventos recebidos da plataforma e links para os itens nos SPAs do portal
 * CRMThink (o id da assinatura na plataforma é o id do item no SPA de Assinaturas). Criar ou
 * alterar assinatura manual é no SPA; aqui, no máximo, conferir com a plataforma agora.
 */
@Injectable()
export class SubscriptionAdminService {
  private readonly logger = new Logger(SubscriptionAdminService.name);

  constructor(
    private readonly platform: PlatformApiClient,
    private readonly consistency: SubscriptionConsistencyService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
  ) {}

  async view(tenantId: string): Promise<AdminSubscriptionView> {
    const row = await this.tenantOf(tenantId);
    const [[projection], events, plans] = await Promise.all([
      this.db.select().from(subscriptionState).where(eq(subscriptionState.tenantId, tenantId)),
      this.db
        .select()
        .from(paymentEvent)
        .where(eq(paymentEvent.tenantId, tenantId))
        .orderBy(desc(paymentEvent.receivedAt))
        .limit(EVENTS_LIMIT),
      this.platform.listPlans().catch((error: unknown) => {
        this.logger.warn({ err: error }, 'planos indisponíveis na visão de assinatura');
        return null;
      }),
    ]);
    const plan = (id: string | null) =>
      id ? { id, name: plans?.find((p: Plan) => String(p.id) === id)?.name ?? null } : null;

    return {
      projection: projection
        ? {
            subscriptionId: projection.subscriptionId,
            status: projection.status,
            modality: projection.modality,
            plan: plan(projection.planId),
            nextPlan: plan(projection.nextPlanId),
            periodStart: projection.periodStart?.toISOString() ?? null,
            periodEnd: projection.periodEnd?.toISOString() ?? null,
            graceUntil: projection.graceUntil?.toISOString() ?? null,
            cancelAt: projection.cancelAt?.toISOString() ?? null,
            version: projection.version,
            updatedAt: projection.updatedAt.toISOString(),
          }
        : null,
      links: {
        subscription: projection
          ? this.spaLink(this.env.CRMTHINK_SPA_SUBSCRIPTIONS, projection.subscriptionId)
          : null,
        installation: this.spaLink(this.env.CRMTHINK_SPA_INSTALLATIONS, row.installationId),
      },
      events: events.map((event): AdminPlatformEvent => {
        const payload = event.payload as {
          occurredAt?: string;
          data?: { correction?: unknown };
        } | null;
        return {
          eventId: event.eventId,
          type: event.type,
          occurredAt: payload?.occurredAt ?? null,
          receivedAt: event.receivedAt.toISOString(),
          status: event.status,
          attempts: event.attempts,
          error: event.error,
          correction: Boolean(payload?.data?.correction),
          payload: event.payload,
        };
      }),
      platformError: plans === null,
    };
  }

  /** Confere a projeção com a plataforma agora (o job roda a cada 6 h); corrige o que faltou. */
  async check(tenantId: string, actor: string): Promise<AdminSubscriptionCheckView> {
    const row = await this.tenantOf(tenantId);
    const outcome = await this.consistency.check(row).catch((error: unknown) => {
      if (!isPlatformUnavailable(error)) throw error;
      throw new DomainError(
        'PAYMENTS_UNAVAILABLE',
        'A plataforma de pagamentos não respondeu. Tente de novo em instantes.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    });
    await this.audit.record({
      actorId: actor,
      tenantId,
      action: 'subscription.checked',
      entityType: 'subscription',
      entityId: row.installationId,
      after: { outcome },
    });
    return { outcome, view: await this.view(tenantId) };
  }

  private spaLink(spa: number, itemId: string): string {
    return new URL(`/crm/type/${spa}/details/${itemId}/`, this.env.CRMTHINK_PORTAL_URL).toString();
  }

  private async tenantOf(tenantId: string) {
    const [row] = await this.db.select().from(tenant).where(eq(tenant.id, tenantId));
    if (!row) throw notFound();
    return row;
  }
}
