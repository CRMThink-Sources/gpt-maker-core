import { z } from 'zod';

/** Fuso das datas do extrato: o dia de consumo é o dia no Brasil, não em UTC. */
export const CREDITS_TIMEZONE = 'America/Sao_Paulo';

/** Maior intervalo do extrato por dia, em dias (inclusive). */
export const USAGE_MAX_DAYS = 92;

export type CreditWallet = 'TRIAL' | 'PLAN' | 'EXTRA';

/**
 * Saldo e ciclo do tenant (spec credit-billing, "Consulta de saldo"). Datas em ISO; `null` quando
 * não se aplica (ex.: sem trial, sem plano ou com cancelamento agendado).
 */
export interface CreditSummaryView {
  trial: { balance: number; endsAt: string | null };
  plan: { balance: number };
  extra: { balance: number };
  total: number;
  /** Fim do ciclo corrente: quando `PLAN` e `EXTRA` expiram. */
  expiresAt: string | null;
  /** Próxima renovação da assinatura paga; `null` em trial, sem plano ou com cancelamento agendado. */
  renewsAt: string | null;
  /** Encerramento agendado da assinatura. */
  cancelAt: string | null;
  /** Pagamento pendente: quando os agentes são pausados se não for regularizado. */
  graceUntil: string | null;
  subscription: {
    status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'trial_expired';
    planId: string | null;
  } | null;
  /** Início do ciclo corrente (ou do trial) e créditos consumidos desde então. */
  cycleStart: string | null;
  consumedInCycle: number;
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');

/** Filtro do consumo por dia: período (dias no fuso de `CREDITS_TIMEZONE`) e agente opcional. */
export const creditUsageQuerySchema = z
  .object({
    from: isoDay,
    to: isoDay,
    agentId: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'início depois do fim', path: ['from'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < USAGE_MAX_DAYS, {
    message: `período maior que ${USAGE_MAX_DAYS} dias`,
    path: ['to'],
  });

export type CreditUsageQuery = z.infer<typeof creditUsageQuerySchema>;

export interface CreditUsageRow {
  /** AAAA-MM-DD no fuso de `CREDITS_TIMEZONE`. */
  day: string;
  agentId: string | null;
  agentName: string | null;
  responses: number;
  credits: number;
}

export interface CreditUsageView {
  rows: CreditUsageRow[];
  totals: { responses: number; credits: number };
}

/** Movimentações do extrato: tudo menos os débitos por resposta, que aparecem no consumo. */
export interface CreditEntryView {
  id: string;
  createdAt: string;
  wallet: CreditWallet;
  type: 'GRANT' | 'TOPUP' | 'ADJUSTMENT' | 'EXPIRE' | 'REFUND';
  amount: number;
  refType: string | null;
  reason: string | null;
}

export const creditEntriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Cursor: devolve lançamentos anteriores a este instante (ISO). */
  before: z.iso.datetime({ offset: true }).optional(),
});

export interface CreditEntriesView {
  entries: CreditEntryView[];
  /** Cursor para a próxima página; `null` quando acabou. */
  nextBefore: string | null;
}
