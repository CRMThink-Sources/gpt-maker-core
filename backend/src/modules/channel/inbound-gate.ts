import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, tenant } from '../../shared/database/schema/index';
import { BalanceReader } from '../billing';
import { HumanAttendance } from './human-attendance';
import type { InboundMessage } from './inbound-message';

/** Para onde a mensagem liberada vai: agente no GPTMaker e portal do tenant. */
export interface ForwardTarget {
  gptmakerAgentId: string;
  installationId: number;
}

export type GateDecision =
  | { kind: 'forward'; target: ForwardTarget }
  /** Agente não está `ACTIVE` (inativo, removido, fora do GPTMaker) ou o portal não está ativo. */
  | { kind: 'skip-inactive'; reason: 'agent' | 'tenant' }
  /** Operador atendendo o diálogo: o agente não responde. */
  | { kind: 'skip-human' }
  /** Saldo total ≤ 0: não vai ao GPTMaker (tratamento na 9.7). */
  | { kind: 'no-credit'; balance: number };

/**
 * Checagens do worker antes de encaminhar ao GPTMaker (design D5), nesta ordem: agente e portal
 * ativos, atendimento humano, saldo. Agente e portal vêm do banco (inativação vale na hora);
 * atendimento humano e saldo, do Redis com o banco como reserva.
 */
@Injectable()
export class InboundGate {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly human: HumanAttendance,
    private readonly balance: BalanceReader,
  ) {}

  async check(message: InboundMessage): Promise<GateDecision> {
    const [row] = await this.db
      .select({
        agentStatus: agent.status,
        gptmakerAgentId: agent.gptmakerAgentId,
        tenantStatus: tenant.status,
        installationId: tenant.installationId,
      })
      .from(agent)
      .innerJoin(tenant, eq(tenant.id, agent.tenantId))
      .where(and(eq(agent.id, message.agentId), eq(agent.tenantId, message.tenantId)));
    if (!row || row.agentStatus !== 'ACTIVE') return { kind: 'skip-inactive', reason: 'agent' };
    // `AUTH_ERROR` pausa o processamento (sem token não há como responder no portal).
    if (row.tenantStatus !== 'ACTIVE') return { kind: 'skip-inactive', reason: 'tenant' };

    if (await this.human.isActive(message.tenantId, message.dialogId)) {
      return { kind: 'skip-human' };
    }

    const balance = await this.balance.total(message.tenantId);
    if (balance <= 0) return { kind: 'no-credit', balance };
    return {
      kind: 'forward',
      target: {
        gptmakerAgentId: row.gptmakerAgentId,
        installationId: Number(row.installationId),
      },
    };
  }
}
