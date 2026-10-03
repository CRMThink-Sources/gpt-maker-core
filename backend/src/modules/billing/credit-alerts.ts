import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { creditLedger } from '../../shared/database/schema/index';
import { MESSAGES, NotificationService } from '../notifications';
import type { BalanceView } from './ledger.service';

/** Fração consumida do ciclo que dispara o primeiro alerta. */
export const CREDIT_ALERT_THRESHOLD = 0.8;

export type CreditAlert = 'CREDIT_80' | 'CREDIT_ZERO' | null;

/**
 * Alerta devido para o consumo do ciclo (spec credit-billing, "Alertas de consumo"). `consumed` é
 * o debitado desde o início do ciclo e `total`, o saldo agora: o disponível no ciclo é a soma
 * dos dois. Saldo zerado (100% consumido) é o `CREDIT_ZERO`.
 */
export function creditAlertFor(consumed: number, total: number): CreditAlert {
  if (total <= 0) return 'CREDIT_ZERO';
  if (consumed >= CREDIT_ALERT_THRESHOLD * (consumed + total)) return 'CREDIT_80';
  return null;
}

/**
 * Avisa 80% e saldo zerado uma vez por ciclo (tarefa 11.5). O ciclo começa no último `GRANT`
 * (trial ou plano), cujo id é a chave de deduplicação: pacotes comprados no meio do ciclo entram
 * no disponível sem reabrir os avisos. Chamado depois de cada débito; nunca lança.
 */
@Injectable()
export class CreditAlerts {
  private readonly logger = new Logger(CreditAlerts.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async afterDebit(tenantId: string, balance: BalanceView): Promise<CreditAlert> {
    try {
      const [grant] = await this.db
        .select({ id: creditLedger.id, createdAt: creditLedger.createdAt })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.tenantId, tenantId),
            eq(creditLedger.type, 'GRANT'),
            inArray(creditLedger.wallet, ['TRIAL', 'PLAN']),
          ),
        )
        .orderBy(desc(creditLedger.createdAt))
        .limit(1);
      if (!grant) return null;

      const [row] = await this.db
        .select({ consumed: sql<string | null>`-sum(${creditLedger.amount})` })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.tenantId, tenantId),
            eq(creditLedger.type, 'DEBIT'),
            gte(creditLedger.createdAt, grant.createdAt),
          ),
        );
      const consumed = Number(row?.consumed ?? 0);
      const alert = creditAlertFor(consumed, balance.total);
      if (!alert) return null;

      const message =
        alert === 'CREDIT_ZERO'
          ? MESSAGES.creditZero()
          : MESSAGES.credit80({
              consumedPercent: Math.floor((100 * consumed) / (consumed + balance.total)),
              remaining: balance.total,
            });
      await this.notifications.notify({ tenantId, type: alert, dedupeKey: grant.id, message });
      return alert;
    } catch (error) {
      this.logger.error({ err: error, tenantId }, 'avaliação dos alertas de crédito falhou');
      return null;
    }
  }
}
