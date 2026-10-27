import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agentFunctionConfig } from '../../shared/database/schema/index';
import { type AgentChange, type AgentChangeListener, AgentEvents } from '../agents';

/** Motivo mostrado ao cliente na página do agente que transferia para o removido. */
export const TRANSFER_TARGET_GONE_REASON =
  'Um agente usado numa transferência foi removido. Escolha outro e publique de novo.';

/**
 * Agente removido que é destino de transferência (design D17): os agentes que o escolheram no
 * formulário ficam marcados para republicar. A remoção não é bloqueada; a regra no GPTMaker só
 * sai na próxima publicação deles, que pede outro agente.
 */
@Injectable()
export class FunctionTransferTargets implements AgentChangeListener, OnModuleInit {
  readonly name = 'function-transfer-targets';

  constructor(
    private readonly events: AgentEvents,
    @Inject(DB) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.events.register(this);
  }

  async onAgentChanged(change: AgentChange): Promise<void> {
    if (change.kind !== 'removed') return;
    // O id do agente só aparece nas respostas como valor de um campo "Agente" (uuid).
    await this.db
      .update(agentFunctionConfig)
      .set({ needsRepublishReason: TRANSFER_TARGET_GONE_REASON })
      .where(
        and(
          eq(agentFunctionConfig.tenantId, change.tenantId),
          ne(agentFunctionConfig.agentId, change.agentId),
          sql`${agentFunctionConfig.answers}::text like ${`%"${change.agentId}"%`}`,
        ),
      );
  }
}
