import { Inject, Injectable } from '@nestjs/common';
import type { CreditSummaryView } from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { subscriptionState } from '../../shared/database/schema/index';
import { CreditStatementService, LedgerService } from '../billing';

/**
 * Saldo e ciclo para a tela "Créditos e plano" (spec credit-billing, "Consulta de saldo"): saldos
 * do ledger e período da projeção da assinatura. Renovação só existe em assinatura paga sem
 * cancelamento agendado; no trial o ciclo é o próprio trial.
 */
@Injectable()
export class CreditSummaryService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly statement: CreditStatementService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async summary(tenantId: string): Promise<CreditSummaryView> {
    const [balance, [projection]] = await Promise.all([
      this.ledger.balance(tenantId),
      this.db.select().from(subscriptionState).where(eq(subscriptionState.tenantId, tenantId)),
    ]);
    const paid = projection?.status === 'active' || projection?.status === 'past_due';
    const cycleStart = projection?.periodStart ?? null;

    return {
      trial: { balance: balance.trial, endsAt: iso(balance.trialEndsAt) },
      plan: { balance: balance.plan },
      extra: { balance: balance.extra },
      total: balance.total,
      expiresAt: iso(balance.expiresAt),
      renewsAt: paid && !projection.cancelAt ? iso(projection.periodEnd) : null,
      cancelAt: iso(projection?.cancelAt ?? null),
      subscription: projection ? { status: projection.status, planId: projection.planId } : null,
      cycleStart: iso(cycleStart),
      consumedInCycle: cycleStart ? await this.statement.consumedSince(tenantId, cycleStart) : 0,
    };
  }
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}
