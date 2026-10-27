import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  type CompiledAgent,
  type FunctionTemplateContent,
  flattenFields,
} from '@gptmaker/contracts';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, agentFunctionConfig } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { type AgentChange, type AgentChangeListener, AgentEvents } from '../agents';

/** Motivo mostrado ao cliente na página do agente que transferia para o removido. */
export const TRANSFER_TARGET_GONE_REASON =
  'Um agente usado numa transferência foi removido. Escolha outro e publique de novo.';

/**
 * Agente de destino de cada transferência compilada, no GPTMaker (design D17): do mesmo portal, não
 * removido e diferente do próprio agente (`agentId` nulo na criação). Recusa nomeando o campo. Vale
 * no pedido de criação e de publicação (resposta na hora) e de novo no worker, antes de aplicar.
 */
export async function transferTargets(
  db: Database,
  tenantId: string,
  agentId: string | null,
  compiled: Pick<CompiledAgent, 'transfers'>,
  content: Pick<FunctionTemplateContent, 'fields'>,
): Promise<Map<string, string>> {
  const labels = new Map(flattenFields(content.fields).map((field) => [field.id, field.label]));
  const targets = new Map<string, string>();
  for (const transfer of compiled.transfers) {
    const [row] = await db
      .select({ gptmakerAgentId: agent.gptmakerAgentId })
      .from(agent)
      .where(
        and(eq(agent.id, transfer.agentId), eq(agent.tenantId, tenantId), isNull(agent.deletedAt)),
      );
    if (!row || transfer.agentId === agentId) {
      throw new DomainError(
        'FUNCTION_TRANSFER_AGENT_INVALID',
        `Escolha outro agente em "${labels.get(transfer.fieldId) ?? transfer.fieldId}"`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    targets.set(transfer.key, row.gptmakerAgentId);
  }
  return targets;
}

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
