import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminReconciliationReview,
  AdminReconciliationReviewsView,
} from '@gptmaker/contracts';
import { desc, eq, inArray } from 'drizzle-orm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  backofficeUser,
  reconciliationAdjustment,
  tenant,
} from '../../shared/database/schema/index';
import { ReconciliationService } from '../reconciliation';
import { AuditService } from './audit.service';

type Row = typeof reconciliationAdjustment.$inferSelect;

/**
 * Revisão dos ajustes da reconciliação acima do limite (spec usage-reconciliation; design D7):
 * a diferença não é lançada sozinha e espera um operador aprovar (lança) ou descartar.
 */
@Injectable()
export class ReconciliationAdminService {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
  ) {}

  async reviews(): Promise<AdminReconciliationReviewsView> {
    const [open, recent] = await Promise.all([
      this.select()
        .where(eq(reconciliationAdjustment.status, 'REVIEW'))
        .orderBy(reconciliationAdjustment.day),
      this.select()
        .where(inArray(reconciliationAdjustment.status, ['APPROVED', 'DISMISSED']))
        .orderBy(desc(reconciliationAdjustment.reviewedAt))
        .limit(20),
    ]);
    const operators = await this.db
      .select({ id: backofficeUser.id, name: backofficeUser.name })
      .from(backofficeUser);
    const view = (row: Awaited<typeof open>[number]) => this.view(row, operators);
    return {
      open: open.map(view),
      recent: recent.map(view),
      reviewThreshold: this.env.RECONCILIATION_REVIEW_THRESHOLD_CREDITS,
    };
  }

  async decide(
    agentId: string,
    day: string,
    decision: 'approve' | 'dismiss',
    actor: string,
  ): Promise<AdminReconciliationReviewsView> {
    const updated = await this.reconciliation.resolveReview(agentId, day, decision, actor);
    await this.audit.record({
      actorId: actor,
      tenantId: updated.tenantId,
      action: decision === 'approve' ? 'reconciliation.approved' : 'reconciliation.dismissed',
      entityType: 'reconciliation_adjustment',
      entityId: `${agentId}:${day}`,
      after: {
        real: updated.realTotal,
        debited: updated.debitedTotal,
        adjusted: updated.adjustedTotal,
        status: updated.status,
      },
    });
    return this.reviews();
  }

  private select() {
    return this.db
      .select({
        row: reconciliationAdjustment,
        agentName: agent.name,
        domain: tenant.domain,
      })
      .from(reconciliationAdjustment)
      .innerJoin(agent, eq(agent.id, reconciliationAdjustment.agentId))
      .innerJoin(tenant, eq(tenant.id, reconciliationAdjustment.tenantId))
      .$dynamic();
  }

  private view(
    { row, agentName, domain }: { row: Row; agentName: string; domain: string },
    operators: Array<{ id: string; name: string }>,
  ): AdminReconciliationReview {
    return {
      agentId: row.agentId,
      agentName,
      tenant: { id: row.tenantId, domain },
      day: row.day,
      real: row.realTotal,
      debited: row.debitedTotal,
      adjusted: row.adjustedTotal,
      pending: row.debitedTotal - row.realTotal - row.adjustedTotal,
      status: row.status as AdminReconciliationReview['status'],
      reviewedBy: row.reviewedBy
        ? (operators.find((op) => op.id === row.reviewedBy)?.name ?? row.reviewedBy)
        : null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    };
  }
}
