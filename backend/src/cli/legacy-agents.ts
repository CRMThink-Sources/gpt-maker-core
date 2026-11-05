import { and, eq, isNull, ne } from 'drizzle-orm';
import type { AgentService } from '../modules/agents';
import type { Database } from '../shared/database/database.module';
import { agent, agentFunctionConfig } from '../shared/database/schema/index';

export interface LegacyDiscardResult {
  removed: number;
  pending: number;
  failed: number;
}

/**
 * Descarta os agentes criados antes das funções (tarefa 2.2): os que não têm configuração de
 * função. Passa pelo `AgentService.remove` (GPTMaker, soft delete, espelho da assinatura, chatbot e
 * intenções). Sem `apply`, só lista. Idempotente: removidos não voltam à lista e agente já
 * ausente no GPTMaker só é marcado.
 */
export async function discardLegacyAgents(deps: {
  db: Database;
  agents: Pick<AgentService, 'remove'>;
  apply: boolean;
  log: (line: string) => void;
}): Promise<LegacyDiscardResult> {
  const rows = await deps.db
    .select({
      id: agent.id,
      tenantId: agent.tenantId,
      name: agent.name,
      gptmakerAgentId: agent.gptmakerAgentId,
    })
    .from(agent)
    .leftJoin(agentFunctionConfig, eq(agentFunctionConfig.agentId, agent.id))
    .where(and(ne(agent.status, 'DELETED'), isNull(agentFunctionConfig.agentId)));

  const result: LegacyDiscardResult = { removed: 0, pending: 0, failed: 0 };
  for (const row of rows) {
    const label = `${row.name} (${row.gptmakerAgentId})`;
    if (!deps.apply) {
      result.pending++;
      deps.log(`- ${label}: sem função; será removido`);
      continue;
    }
    try {
      await deps.agents.remove({ tenantId: row.tenantId }, row.id);
      result.removed++;
      deps.log(`- ${label}: removido`);
    } catch (error) {
      result.failed++;
      deps.log(`- ${label}: falhou (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return result;
}
