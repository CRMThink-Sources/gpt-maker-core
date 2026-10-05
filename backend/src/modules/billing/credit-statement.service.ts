import { Inject, Injectable } from '@nestjs/common';
import {
  CREDITS_TIMEZONE,
  type CreditEntriesView,
  type CreditEntryView,
  type CreditUsageQuery,
  type CreditUsageView,
} from '@gptmaker/contracts';
import { and, desc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, creditLedger } from '../../shared/database/schema/index';

// Literal fixo (não parâmetro): a mesma expressão do dia aparece no SELECT e no GROUP BY.
const TZ = sql.raw(`'${CREDITS_TIMEZONE}'`);

/**
 * Extrato do tenant (spec credit-billing, "Extrato de consumo para o tenant"): consumo por dia e
 * agente a partir dos `DEBIT` e as demais movimentações do ledger. Um débito que atravessa
 * carteiras gera um lançamento por carteira com o mesmo `ref_id`, então respostas contam
 * `ref_id` distintos.
 */
@Injectable()
export class CreditStatementService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Créditos debitados desde `since` (início do ciclo ou do trial). */
  async consumedSince(tenantId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string | null>`-sum(${creditLedger.amount})` })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenantId),
          eq(creditLedger.type, 'DEBIT'),
          gte(creditLedger.createdAt, since),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async usage(tenantId: string, query: CreditUsageQuery): Promise<CreditUsageView> {
    const day = sql<string>`to_char(${creditLedger.createdAt} at time zone ${TZ}, 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({
        day,
        agentId: creditLedger.agentId,
        agentName: agent.name,
        responses: sql<string>`count(distinct ${creditLedger.refId})`,
        credits: sql<string>`-sum(${creditLedger.amount})`,
      })
      .from(creditLedger)
      .leftJoin(agent, eq(agent.id, creditLedger.agentId))
      .where(
        and(
          eq(creditLedger.tenantId, tenantId),
          eq(creditLedger.type, 'DEBIT'),
          // Dias inteiros no fuso do Brasil: [from 00:00, to + 1 dia 00:00).
          gte(creditLedger.createdAt, sql`(${query.from}::date)::timestamp at time zone ${TZ}`),
          lt(creditLedger.createdAt, sql`(${query.to}::date + 1)::timestamp at time zone ${TZ}`),
          query.agentId ? eq(creditLedger.agentId, query.agentId) : undefined,
        ),
      )
      .groupBy(day, creditLedger.agentId, agent.name)
      .orderBy(desc(day), agent.name);

    const view = rows.map((row) => ({
      day: row.day,
      agentId: row.agentId,
      agentName: row.agentName,
      responses: Number(row.responses),
      credits: Number(row.credits),
    }));
    return {
      rows: view,
      totals: {
        responses: view.reduce((sum, row) => sum + row.responses, 0),
        credits: view.reduce((sum, row) => sum + row.credits, 0),
      },
    };
  }

  async entries(
    tenantId: string,
    { limit, before }: { limit: number; before?: string },
  ): Promise<CreditEntriesView> {
    const rows = await this.db
      .select({
        id: creditLedger.id,
        createdAt: creditLedger.createdAt,
        wallet: creditLedger.wallet,
        type: creditLedger.type,
        amount: creditLedger.amount,
        refType: creditLedger.refType,
        reason: creditLedger.reason,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenantId),
          ne(creditLedger.type, 'DEBIT'),
          before ? lt(creditLedger.createdAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    return {
      entries: page.map((row): CreditEntryView => ({
        ...row,
        type: row.type as CreditEntryView['type'],
        createdAt: row.createdAt.toISOString(),
      })),
      nextBefore: rows.length > limit ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }
}
