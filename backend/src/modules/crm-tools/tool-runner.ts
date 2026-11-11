import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { Counter, Histogram } from 'prom-client';
import type { Env } from '../../config/env';
import type { Database } from '../../shared/database/database.module';
import { agentCrmAccess } from '../../shared/database/schema/index';
import { metricsRegistry } from '../../shared/metrics/metrics';
import { BitrixError } from '../bitrix';
import type { CrmCaller } from './crm-access.guard';

export type ToolName = 'consultar_cliente' | 'negocios_do_cliente' | 'etapas_do_funil';
export type ToolOutcome = 'ok' | 'not_identified' | 'not_found' | 'unavailable' | 'rate_limited';

/** Resposta de uma ferramenta: corpo para o agente e, para métricas, quantos registros. */
export interface ToolResult {
  outcome: ToolOutcome;
  body: Record<string, unknown>;
  count: number;
}

/** Tempo máximo de uma ferramenta (o agente está esperando para responder). */
export const TOOL_TIMEOUT_MS = 10_000;

const calls = new Counter({
  name: 'crm_tool_calls_total',
  help: 'Chamadas às ferramentas do agente sobre o CRM por ferramenta e resultado',
  labelNames: ['tool', 'outcome'],
  registers: [metricsRegistry],
});
const duration = new Histogram({
  name: 'crm_tool_duration_seconds',
  help: 'Duração das ferramentas do agente sobre o CRM',
  labelNames: ['tool'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

class ToolTimeout extends Error {}

export const UNAVAILABLE: ToolResult = {
  outcome: 'unavailable',
  body: {
    erro: 'Os dados do CRM estão temporariamente indisponíveis. Responda sem eles e, se preciso, diga ao cliente que a equipe vai verificar.',
  },
  count: 0,
};

/**
 * Execução comum das ferramentas do agente (spec agent-crm-tools, "Limites e falhas"): limite de
 * chamadas por agente, tempo máximo, indisponibilidade do Bitrix24, métricas, log sem dados
 * pessoais e `last_call_at`. É compartilhada pelas ferramentas do CRM e pelas de agenda, para o
 * limite de 60 por minuto somar as duas (design D1 de `agent-calendar-scheduling`). Sem estado
 * próprio: o contador fica no Redis e as métricas no registro do processo.
 */
export class ToolRunner {
  private readonly logger = new Logger(ToolRunner.name);

  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly env: Pick<Env, 'CRM_TOOLS_RATE_PER_MINUTE'>,
  ) {}

  /** Limite por agente, tempo máximo, métricas, log sem dados e `last_call_at`. */
  async run(caller: CrmCaller, tool: ToolName, fn: () => Promise<ToolResult>): Promise<ToolResult> {
    const end = duration.startTimer({ tool });
    const started = Date.now();
    let result: ToolResult;
    try {
      if (await this.overLimit(caller.agentId)) {
        result = {
          outcome: 'rate_limited',
          count: 0,
          body: { erro: 'Limite de consultas ao CRM atingido. Tente de novo em um minuto.' },
        };
      } else {
        result = await withTimeout(fn(), TOOL_TIMEOUT_MS);
      }
    } catch (error) {
      if (!(error instanceof BitrixError) && !(error instanceof ToolTimeout)) throw error;
      this.logger.warn({ tool, err: error }, 'CRM indisponível para a ferramenta');
      result = UNAVAILABLE;
    }
    end();
    calls.inc({ tool, outcome: result.outcome });
    this.logger.log(
      { tool, outcome: result.outcome, count: result.count, durationMs: Date.now() - started },
      'ferramenta do CRM',
    );
    void this.db
      .update(agentCrmAccess)
      .set({ lastCallAt: new Date() })
      .where(eq(agentCrmAccess.agentId, caller.agentId))
      .catch((error: unknown) => this.logger.warn({ err: error }, 'last_call_at não gravado'));
    return result;
  }

  private async overLimit(agentId: string): Promise<boolean> {
    const key = `crm-tools:rate:${agentId}:${Math.floor(Date.now() / 60_000)}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 120);
      return count > this.env.CRM_TOOLS_RATE_PER_MINUTE;
    } catch (error) {
      // Redis fora: libera (o Bitrix ainda tem o próprio limite por portal).
      this.logger.warn({ err: error }, 'limite das ferramentas do CRM indisponível');
      return false;
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolTimeout(`ferramenta excedeu ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
