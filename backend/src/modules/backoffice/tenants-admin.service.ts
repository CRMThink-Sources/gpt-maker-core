import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminTenantDetail, AdminTenantRow } from '@gptmaker/contracts';
import { and, desc, eq, gte, ilike, ne, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  aiModel,
  creditLedger,
  messageLog,
  notificationLog,
  subscriptionState,
  tenant,
  tenantBalance,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { LedgerService } from '../billing';
import { TenantLifecycle, TenantService } from '../tenancy';
import { AuditService } from './audit.service';

const LIST_LIMIT = 100;
const DAY_MS = 86_400_000;

const notFound = () =>
  new DomainError('TENANT_NOT_FOUND', 'Portal não encontrado.', HttpStatus.NOT_FOUND);

/**
 * Gestão de tenants no backoffice (spec admin-backoffice, "Gestão de tenants"; tarefa 15.4):
 * consulta para todos os operadores; suspender, reativar e conceder créditos só ADMIN, auditados.
 * Troca de plano não é feita aqui (plataforma ou SPA).
 */
@Injectable()
export class TenantsAdminService {
  constructor(
    private readonly tenants: TenantService,
    private readonly lifecycle: TenantLifecycle,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  /** Lista por última mensagem (portais em uso primeiro); `q` busca no domínio ou no código. */
  async list(q?: string): Promise<AdminTenantRow[]> {
    const search = q?.trim();
    const agents = this.db
      .select({
        tenantId: agent.tenantId,
        active: sql<number>`count(*) filter (where ${agent.status} = 'ACTIVE')::int`.as('active'),
        total: sql<number>`count(*) filter (where ${agent.status} <> 'DELETED')::int`.as('total'),
      })
      .from(agent)
      .groupBy(agent.tenantId)
      .as('agents');
    const lastMessage = this.db
      .select({
        tenantId: messageLog.tenantId,
        at: sql<Date>`max(${messageLog.createdAt})`.as('at'),
      })
      .from(messageLog)
      .groupBy(messageLog.tenantId)
      .as('last_message');

    const rows = await this.db
      .select({
        tenant,
        balance: tenantBalance,
        subscription: subscriptionState,
        agentsActive: agents.active,
        agentsTotal: agents.total,
        lastMessageAt: lastMessage.at,
      })
      .from(tenant)
      .leftJoin(tenantBalance, eq(tenantBalance.tenantId, tenant.id))
      .leftJoin(subscriptionState, eq(subscriptionState.tenantId, tenant.id))
      .leftJoin(agents, eq(agents.tenantId, tenant.id))
      .leftJoin(lastMessage, eq(lastMessage.tenantId, tenant.id))
      .where(
        search
          ? or(ilike(tenant.domain, `%${search}%`), ilike(tenant.tenantCode, `%${search}%`))
          : undefined,
      )
      .orderBy(sql`${lastMessage.at} desc nulls last`, desc(tenant.installedAt))
      .limit(LIST_LIMIT);

    return rows.map((row) => ({
      id: row.tenant.id,
      domain: row.tenant.domain,
      tenantCode: row.tenant.tenantCode,
      installationId: row.tenant.installationId,
      status: row.tenant.status,
      isPartner: row.tenant.isPartner,
      subscription: row.subscription
        ? {
            status: row.subscription.status,
            planId: row.subscription.planId,
            modality: row.subscription.modality,
          }
        : null,
      balance: {
        trial: row.balance?.trialBalance ?? 0,
        plan: row.balance?.planBalance ?? 0,
        extra: row.balance?.extraBalance ?? 0,
        total:
          (row.balance?.trialBalance ?? 0) +
          (row.balance?.planBalance ?? 0) +
          (row.balance?.extraBalance ?? 0),
      },
      agents: { active: row.agentsActive ?? 0, total: row.agentsTotal ?? 0 },
      lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
      installedAt: row.tenant.installedAt.toISOString(),
    }));
  }

  async detail(tenantId: string): Promise<AdminTenantDetail> {
    const row = await this.tenants.findById(tenantId);
    if (!row) throw notFound();
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [base] = (await this.list(row.tenantCode)).filter((t) => t.id === tenantId);
    const [[subscription], [balance], agents, entries, [usage], notifications] = await Promise.all([
      this.db.select().from(subscriptionState).where(eq(subscriptionState.tenantId, tenantId)),
      this.db.select().from(tenantBalance).where(eq(tenantBalance.tenantId, tenantId)),
      this.db
        .select({
          id: agent.id,
          name: agent.name,
          gptmakerAgentId: agent.gptmakerAgentId,
          status: agent.status,
          inactiveReason: agent.inactiveReason,
          model: aiModel.displayName,
        })
        .from(agent)
        .leftJoin(aiModel, eq(aiModel.id, agent.modelId))
        .where(and(eq(agent.tenantId, tenantId), ne(agent.status, 'DELETED')))
        .orderBy(agent.name),
      this.db
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.tenantId, tenantId), ne(creditLedger.type, 'DEBIT')))
        .orderBy(desc(creditLedger.createdAt))
        .limit(20),
      this.db
        .select({
          responses: sql<number>`count(distinct ${creditLedger.refId})::int`,
          credits: sql<number>`coalesce(-sum(${creditLedger.amount}), 0)::int`,
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.tenantId, tenantId),
            eq(creditLedger.type, 'DEBIT'),
            gte(creditLedger.createdAt, since),
          ),
        ),
      this.db
        .select()
        .from(notificationLog)
        .where(eq(notificationLog.tenantId, tenantId))
        .orderBy(desc(notificationLog.createdAt))
        .limit(10),
    ]);

    return {
      ...base!,
      suspendedReason: row.suspendedReason,
      uninstalledAt: row.uninstalledAt?.toISOString() ?? null,
      subscriptionDetail: subscription
        ? {
            subscriptionId: subscription.subscriptionId,
            periodStart: subscription.periodStart?.toISOString() ?? null,
            periodEnd: subscription.periodEnd?.toISOString() ?? null,
            graceUntil: subscription.graceUntil?.toISOString() ?? null,
            cancelAt: subscription.cancelAt?.toISOString() ?? null,
            nextPlanId: subscription.nextPlanId,
          }
        : null,
      trialEndsAt: balance?.trialEndsAt?.toISOString() ?? null,
      expiresAt: balance?.expiresAt?.toISOString() ?? null,
      agentList: agents,
      entries: entries.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        type: e.type,
        wallet: e.wallet,
        amount: e.amount,
        reason: e.reason,
        createdBy: e.createdBy,
      })),
      usage7d: { responses: usage?.responses ?? 0, credits: usage?.credits ?? 0 },
      notifications: notifications.map((n) => ({
        type: n.type,
        status: n.status,
        createdAt: n.createdAt.toISOString(),
        sentTo: n.sentTo,
      })),
    };
  }

  /** Suspende e avisa `onAccessChanged`: a `AgentAccessPolicy` inativa os agentes (7.6). */
  async suspend(tenantId: string, reason: string, actor: string): Promise<AdminTenantDetail> {
    const before = await this.tenants.findById(tenantId);
    if (!before) throw notFound();
    const after = await this.tenants.suspend(tenantId, reason);
    if (!after) {
      throw new DomainError(
        'TENANT_STATUS_CONFLICT',
        before.status === 'SUSPENDED'
          ? 'O portal já está suspenso.'
          : 'Portal desinstalado não pode ser suspenso.',
        HttpStatus.CONFLICT,
      );
    }
    await this.lifecycle.emit('onAccessChanged', after);
    await this.audit.record({
      actorId: actor,
      tenantId,
      action: 'tenant.suspended',
      entityType: 'tenant',
      entityId: tenantId,
      before: { status: before.status },
      after: { status: after.status },
      reason,
    });
    return this.detail(tenantId);
  }

  /**
   * Marca ou desmarca o portal como parceiro: só parceiros assumem o controle do comportamento.
   * Desmarcar não mexe nos agentes já assumidos (spec admin-backoffice, "Tenant parceiro").
   */
  async setPartner(tenantId: string, partner: boolean, actor: string): Promise<AdminTenantDetail> {
    const before = await this.tenants.findById(tenantId);
    if (!before) throw notFound();
    if (before.isPartner !== partner) {
      await this.db.update(tenant).set({ isPartner: partner }).where(eq(tenant.id, tenantId));
      await this.audit.record({
        actorId: actor,
        tenantId,
        action: partner ? 'tenant.partner_set' : 'tenant.partner_unset',
        entityType: 'tenant',
        entityId: tenantId,
        before: { isPartner: before.isPartner },
        after: { isPartner: partner },
      });
    }
    return this.detail(tenantId);
  }

  async reactivate(tenantId: string, actor: string): Promise<AdminTenantDetail> {
    const before = await this.tenants.findById(tenantId);
    if (!before) throw notFound();
    const after = await this.tenants.reactivate(tenantId);
    if (!after) {
      throw new DomainError(
        'TENANT_STATUS_CONFLICT',
        'O portal não está suspenso.',
        HttpStatus.CONFLICT,
      );
    }
    await this.lifecycle.emit('onAccessChanged', after);
    await this.audit.record({
      actorId: actor,
      tenantId,
      action: 'tenant.reactivated',
      entityType: 'tenant',
      entityId: tenantId,
      before: { status: before.status, reason: before.suspendedReason },
      after: { status: after.status },
    });
    return this.detail(tenantId);
  }

  /**
   * Concessão de créditos (spec: `TOPUP` em `EXTRA`, expira com o ciclo do plano), com autor e
   * justificativa. O `requestId` do navegador faz o pedido repetido conceder uma vez.
   */
  async grantCredits(
    tenantId: string,
    input: { amount: number; reason: string; requestId: string },
    actor: string,
  ): Promise<AdminTenantDetail> {
    if (!(await this.tenants.findById(tenantId))) throw notFound();
    const result = await this.ledger.credit({
      tenantId,
      key: `backoffice-grant:${input.requestId}`,
      wallet: 'EXTRA',
      type: 'TOPUP',
      amount: input.amount,
      refType: 'backoffice',
      refId: input.requestId,
      reason: input.reason,
      createdBy: `operator:${actor}`,
    });
    if (result.applied) {
      await this.audit.record({
        actorId: actor,
        tenantId,
        action: 'tenant.credits_granted',
        entityType: 'tenant',
        entityId: tenantId,
        after: { amount: input.amount, wallet: 'EXTRA' },
        reason: input.reason,
      });
    }
    return this.detail(tenantId);
  }
}
