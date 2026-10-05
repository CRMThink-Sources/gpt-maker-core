import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Plan, PlatformEvent } from '@crmthink-sources/platform-sdk';
import type { PartnerCredits, PartnerReportView, PartnerRevenue } from '@gptmaker/contracts';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  creditLedger,
  paymentEvent,
  reconciliationAdjustment,
  tenant,
  usageDailyReal,
  usageDailyUnlinked,
  workspaceSyncFinding,
} from '../../shared/database/schema/index';
import { PlatformApiClient } from '../../shared/platform/platform-api.client';
import { dayIn } from '../reconciliation';

const DAY_MS = 86_400_000;
/** Eventos que movem receita (valores em centavos). */
const REVENUE_EVENTS = [
  'subscription.activated',
  'subscription.renewed',
  'subscription.plan_changed',
  'purchase.paid',
  'charge.refunded',
];

/** Primeiro dia do mês seguinte (AAAA-MM-DD). */
function nextMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Dias do mês já encerrados no fuso (o mês corrente conta até ontem). */
export function closedDays(month: string, now: Date, timeZone: string): number {
  const start = Date.parse(`${month}-01T00:00:00Z`);
  const end = Date.parse(`${nextMonth(month)}T00:00:00Z`);
  const today = Date.parse(`${dayIn(now, timeZone)}T00:00:00Z`);
  return Math.max(0, Math.round((Math.min(end, today) - start) / DAY_MS));
}

const emptyCredits = (): PartnerCredits => ({ consumed: 0, debited: 0, adjusted: 0, charged: 0 });
const emptyRevenue = (): PartnerRevenue => ({
  subscriptions: 0,
  packages: 0,
  refunds: 0,
  total: 0,
});

/**
 * Receita do mês a partir dos eventos da plataforma já processados. `purchase.paid` e
 * `charge.refunded` trazem o valor cobrado; ativação, renovação e upgrade imediato não, então
 * a assinatura é estimada pelo preço do plano (upgrade: diferença × fração restante). Reembolso
 * conta o maior `amountRefunded` de cada cobrança (o valor é acumulado).
 */
export function revenueOf(events: PlatformEvent[], plans: Plan[] | null): PartnerRevenue {
  const revenue = emptyRevenue();
  const price = (planId: number | undefined) => {
    const plan = plans?.find((p) => p.id === planId);
    return plan && !plan.trial ? plan.amount : 0;
  };
  const refunded = new Map<string, number>();
  for (const event of events) {
    switch (event.type) {
      case 'purchase.paid':
        revenue.packages += event.data.amount;
        break;
      case 'subscription.activated':
      case 'subscription.renewed':
        revenue.subscriptions += price(event.subscription?.planId);
        break;
      case 'subscription.plan_changed': {
        const { effective, remainingFraction, planId, previousPlanId } = event.data;
        if (effective !== 'immediate' || !remainingFraction) break;
        const diff = (price(planId) - price(previousPlanId)) * remainingFraction;
        if (diff > 0) revenue.subscriptions += Math.round(diff);
        break;
      }
      case 'charge.refunded': {
        const { chargeId, amountRefunded } = event.data;
        refunded.set(chargeId, Math.max(refunded.get(chargeId) ?? 0, amountRefunded));
        break;
      }
    }
  }
  revenue.refunds = [...refunded.values()].reduce((sum, value) => sum + value, 0);
  revenue.total = revenue.subscriptions + revenue.packages - revenue.refunds;
  return revenue;
}

function addRevenue(into: PartnerRevenue, from: PartnerRevenue): void {
  into.subscriptions += from.subscriptions;
  into.packages += from.packages;
  into.refunds += from.refunds;
  into.total += from.total;
}

function addCredits(into: PartnerCredits, from: PartnerCredits): void {
  into.consumed += from.consumed;
  into.debited += from.debited;
  into.adjusted += from.adjusted;
  into.charged += from.charged;
}

/**
 * Relatório mensal do partner (spec usage-reconciliation, "Relatório de consumo do partner";
 * tarefas 14.4 e 15.7): consumo real no GPTMaker (custo do partner, pós-pago) contra créditos
 * cobrados dos clientes e receita, por portal e agente, com o consumo de agentes sem vínculo.
 * Dias pelo fuso da reconciliação; o consumo vem de `usage_daily_real` (só dias já coletados).
 */
@Injectable()
export class PartnerReportService {
  private readonly logger = new Logger(PartnerReportService.name);

  constructor(
    private readonly platform: PlatformApiClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
  ) {}

  async report(month: string, now = new Date()): Promise<PartnerReportView> {
    const start = `${month}-01`;
    const end = nextMonth(month);
    const timeZone = this.env.RECONCILIATION_TIMEZONE;
    const tz = sql.raw(`'${timeZone.replace(/'/g, '')}'`);
    const inMonth = (column: AnyPgColumn) => and(gte(column, start), lt(column, end));

    const [consumed, adjusted, debited, unlinked, reconciled, reviews, events, plans] =
      await Promise.all([
        this.db
          .select({
            agentId: usageDailyReal.agentId,
            total: sql<number>`sum(${usageDailyReal.credits})::int`,
          })
          .from(usageDailyReal)
          .where(inMonth(usageDailyReal.day))
          .groupBy(usageDailyReal.agentId),
        this.db
          .select({
            agentId: reconciliationAdjustment.agentId,
            total: sql<number>`sum(${reconciliationAdjustment.adjustedTotal})::int`,
          })
          .from(reconciliationAdjustment)
          .where(inMonth(reconciliationAdjustment.day))
          .groupBy(reconciliationAdjustment.agentId),
        this.db
          .select({
            agentId: creditLedger.agentId,
            total: sql<number>`(-sum(${creditLedger.amount}))::int`,
          })
          .from(creditLedger)
          .where(
            and(
              eq(creditLedger.type, 'DEBIT'),
              gte(creditLedger.createdAt, sql`(${start}::date)::timestamp at time zone ${tz}`),
              lt(creditLedger.createdAt, sql`(${end}::date)::timestamp at time zone ${tz}`),
            ),
          )
          .groupBy(creditLedger.agentId),
        this.db
          .select({
            gptmakerAgentId: usageDailyUnlinked.gptmakerAgentId,
            total: sql<number>`sum(${usageDailyUnlinked.credits})::int`,
          })
          .from(usageDailyUnlinked)
          .where(inMonth(usageDailyUnlinked.day))
          .groupBy(usageDailyUnlinked.gptmakerAgentId),
        this.db
          .select({ days: sql<number>`count(distinct ${reconciliationAdjustment.day})::int` })
          .from(reconciliationAdjustment)
          .where(inMonth(reconciliationAdjustment.day)),
        this.db
          .select({ total: sql<number>`count(*)::int` })
          .from(reconciliationAdjustment)
          .where(
            and(
              inMonth(reconciliationAdjustment.day),
              eq(reconciliationAdjustment.status, 'REVIEW'),
            ),
          ),
        // Margem de 2 dias no recebimento; o filtro pelo `occurredAt` no fuso vem abaixo.
        this.db
          .select({ tenantId: paymentEvent.tenantId, payload: paymentEvent.payload })
          .from(paymentEvent)
          .where(
            and(
              inArray(paymentEvent.type, REVENUE_EVENTS),
              eq(paymentEvent.status, 'PROCESSED'),
              gte(paymentEvent.receivedAt, new Date(Date.parse(`${start}T00:00:00Z`) - 2 * DAY_MS)),
              lt(paymentEvent.receivedAt, new Date(Date.parse(`${end}T00:00:00Z`) + 2 * DAY_MS)),
            ),
          ),
        this.platform.listPlans().catch((error: unknown) => {
          this.logger.warn(
            { err: error },
            'planos indisponíveis: receita de assinaturas sem estimativa',
          );
          return null;
        }),
      ]);

    const agentIds = [
      ...new Set([...consumed, ...adjusted, ...debited].map((row) => row.agentId)),
    ].filter((id): id is string => id !== null);
    const eventsByTenant = new Map<string, PlatformEvent[]>();
    for (const row of events) {
      const event = row.payload as PlatformEvent;
      if (!row.tenantId || !dayIn(new Date(event.occurredAt), timeZone).startsWith(month)) continue;
      eventsByTenant.set(row.tenantId, [...(eventsByTenant.get(row.tenantId) ?? []), event]);
    }
    const tenantIds = [...new Set([...eventsByTenant.keys()])];
    const agents = agentIds.length
      ? await this.db
          .select({
            id: agent.id,
            name: agent.name,
            tenantId: agent.tenantId,
            status: agent.status,
          })
          .from(agent)
          .where(inArray(agent.id, agentIds))
      : [];
    for (const row of agents) if (!tenantIds.includes(row.tenantId)) tenantIds.push(row.tenantId);
    const tenants = tenantIds.length
      ? await this.db
          .select({ id: tenant.id, domain: tenant.domain })
          .from(tenant)
          .where(inArray(tenant.id, tenantIds))
      : [];
    const names = unlinked.length
      ? await this.db
          .select({
            gptmakerAgentId: workspaceSyncFinding.gptmakerAgentId,
            name: sql<string | null>`${workspaceSyncFinding.details}->>'name'`,
          })
          .from(workspaceSyncFinding)
          .where(
            and(
              eq(workspaceSyncFinding.kind, 'ORPHAN'),
              inArray(
                workspaceSyncFinding.gptmakerAgentId,
                unlinked.map((row) => row.gptmakerAgentId),
              ),
            ),
          )
          .orderBy(workspaceSyncFinding.detectedAt)
      : [];

    const cost = this.env.GPTMAKER_CREDIT_COST_CENTS ?? null;
    const costOf = (credits: number) => (cost === null ? null : Math.round(credits * cost));
    const sumOf = (rows: Array<{ agentId: string | null; total: number }>, id: string) =>
      rows.find((row) => row.agentId === id)?.total ?? 0;

    const tenantViews = tenants.map((t) => {
      const credits = emptyCredits();
      const agentViews = agents
        .filter((a) => a.tenantId === t.id)
        .map((a) => {
          const view = {
            agentId: a.id,
            name: a.name,
            removed: a.status === 'DELETED',
            consumed: sumOf(consumed, a.id),
            debited: sumOf(debited, a.id),
            adjusted: sumOf(adjusted, a.id),
            charged: 0,
          };
          view.charged = view.debited - view.adjusted;
          addCredits(credits, view);
          return view;
        })
        .sort((a, b) => b.consumed - a.consumed);
      const revenue = revenueOf(eventsByTenant.get(t.id) ?? [], plans);
      const costCents = costOf(credits.consumed);
      return {
        tenant: t,
        ...credits,
        revenue,
        costCents,
        marginCents: costCents === null ? null : revenue.total - costCents,
        agents: agentViews,
      };
    });
    tenantViews.sort((a, b) => b.consumed - a.consumed || b.revenue.total - a.revenue.total);

    const unlinkedViews = unlinked
      .map((row) => ({
        gptmakerAgentId: row.gptmakerAgentId,
        // A divergência mais recente traz o nome atual.
        name: names.filter((n) => n.gptmakerAgentId === row.gptmakerAgentId).at(-1)?.name ?? null,
        consumed: row.total,
      }))
      .sort((a, b) => b.consumed - a.consumed);

    const totals = { ...emptyCredits(), unlinked: 0, revenue: emptyRevenue() };
    for (const view of tenantViews) {
      addCredits(totals, view);
      addRevenue(totals.revenue, view.revenue);
    }
    totals.unlinked = unlinkedViews.reduce((sum, row) => sum + row.consumed, 0);
    totals.consumed += totals.unlinked;
    const costCents = costOf(totals.consumed);

    return {
      month,
      timeZone,
      daysInPeriod: closedDays(month, now, timeZone),
      daysReconciled: reconciled[0]?.days ?? 0,
      creditCostCents: cost,
      platformError: plans === null,
      pendingReviews: reviews[0]?.total ?? 0,
      totals: {
        ...totals,
        costCents,
        marginCents: costCents === null ? null : totals.revenue.total - costCents,
      },
      tenants: tenantViews,
      unlinked: unlinkedViews,
    };
  }
}
