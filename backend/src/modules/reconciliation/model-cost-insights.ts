import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import {
  creditLedger,
  reconciliationAdjustment,
  usageDailyReal,
} from '../../shared/database/schema/index';
import { previousDays } from './reconciliation.service';

/** Dias seguidos com a média fora do custo para destacar o modelo (spec usage-reconciliation). */
export const STALE_DAYS = 7;
/** Diferença mínima entre média e custo para contar o dia: absoluta e relativa. */
const MIN_ABS_DIFF = 0.5;
const MIN_REL_DIFF = 0.1;

export interface ModelDay {
  day: string;
  real: number;
  responses: number;
}

export interface ModelCostInsight {
  modelCode: string;
  /** Média real (créditos do GPTMaker ÷ respostas) no período inteiro; `null` sem respostas. */
  average: number | null;
  real: number;
  responses: number;
  /** Média dos últimos `STALE_DAYS` dias, arredondada: o custo sugerido. */
  suggestion: number | null;
  /** `STALE_DAYS` dias seguidos (até ontem) com a média fora do custo cadastrado. */
  stale: boolean;
}

export function deviates(average: number, cost: number): boolean {
  const diff = Math.abs(average - cost);
  return diff >= MIN_ABS_DIFF && diff >= MIN_REL_DIFF * cost;
}

/**
 * Decide o destaque de um modelo a partir dos dias (do mais antigo ao mais recente, todos os dias
 * do período, inclusive os sem respostas). Dia sem respostas quebra a sequência.
 */
export function insightFor(modelCode: string, cost: number, days: ModelDay[]): ModelCostInsight {
  const real = days.reduce((sum, d) => sum + d.real, 0);
  const responses = days.reduce((sum, d) => sum + d.responses, 0);
  const recent = days.slice(-STALE_DAYS);
  const recentReal = recent.reduce((sum, d) => sum + d.real, 0);
  const recentResponses = recent.reduce((sum, d) => sum + d.responses, 0);
  const stale =
    recent.length === STALE_DAYS &&
    recent.every((d) => d.responses > 0 && deviates(d.real / d.responses, cost));
  return {
    modelCode,
    average: responses ? Math.round((real / responses) * 100) / 100 : null,
    real,
    responses,
    suggestion: recentResponses ? Math.max(1, Math.round(recentReal / recentResponses)) : null,
    stale,
  };
}

/**
 * Média real de créditos por resposta por modelo (tarefa 14.3): consumo do GPTMaker por modelo e
 * dia (`usage_daily_real`, da reconciliação) dividido pelas respostas debitadas com aquele modelo
 * no dia (fuso `RECONCILIATION_TIMEZONE`), para o backoffice sugerir o custo do catálogo.
 */
@Injectable()
export class ModelCostInsights {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
  ) {}

  /** Últimos `periodDays` dias até ontem, por modelo. */
  async byModel(
    costs: Map<string, number>,
    periodDays = 30,
    now = new Date(),
  ): Promise<Map<string, ModelCostInsight>> {
    const days = previousDays(now, this.env.RECONCILIATION_TIMEZONE, periodDays);
    const first = days[0]!;
    const last = days[days.length - 1]!;
    const tz = sql.raw(`'${this.env.RECONCILIATION_TIMEZONE.replace(/'/g, '')}'`);
    const day = sql<string>`to_char(${creditLedger.createdAt} at time zone ${tz}, 'YYYY-MM-DD')`;

    const [reconciled, realRows, responseRows] = await Promise.all([
      // Dias que a reconciliação já processou (grava uma linha por agente e dia, mesmo com zero).
      this.db
        .selectDistinct({ day: reconciliationAdjustment.day })
        .from(reconciliationAdjustment)
        .where(
          and(
            gte(reconciliationAdjustment.day, first),
            sql`${reconciliationAdjustment.day} <= ${last}`,
          ),
        ),
      this.db
        .select({
          modelCode: usageDailyReal.modelCode,
          day: usageDailyReal.day,
          real: sql<number>`sum(${usageDailyReal.credits})::int`,
        })
        .from(usageDailyReal)
        .where(and(gte(usageDailyReal.day, first), sql`${usageDailyReal.day} <= ${last}`))
        .groupBy(usageDailyReal.modelCode, usageDailyReal.day),
      this.db
        .select({
          modelCode: creditLedger.modelCode,
          day,
          responses: sql<number>`count(distinct ${creditLedger.refId})::int`,
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.type, 'DEBIT'),
            gte(creditLedger.createdAt, sql`(${first}::date)::timestamp at time zone ${tz}`),
            lt(creditLedger.createdAt, sql`(${last}::date + 1)::timestamp at time zone ${tz}`),
          ),
        )
        .groupBy(creditLedger.modelCode, day),
    ]);

    const result = new Map<string, ModelCostInsight>();
    for (const [code, cost] of costs) {
      const series = days.map((d) => ({
        day: d,
        real: realRows.find((r) => r.modelCode === code && r.day === d)?.real ?? 0,
        responses: responseRows.find((r) => r.modelCode === code && r.day === d)?.responses ?? 0,
      }));
      // Só dias reconciliados e com respostas entram na média: dia ainda não coletado não é "custo
      // zero", e consumo sem resposta debitada (testes no painel do GPTMaker) não é custo por resposta.
      const done = new Set(reconciled.map((r) => r.day));
      const answered = series.map((d) =>
        done.has(d.day) && d.responses ? d : { ...d, real: 0, responses: 0 },
      );
      result.set(code, insightFor(code, cost, answered));
    }
    return result;
  }
}
