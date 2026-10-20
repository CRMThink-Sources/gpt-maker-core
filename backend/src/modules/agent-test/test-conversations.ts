import { Inject, Injectable } from '@nestjs/common';
import type { TestClientType } from '@gptmaker/contracts';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agentTestConversation } from '../../shared/database/schema/index';

/**
 * Cliente simulado de uma conversa de teste, para a intenção "Consultar cliente no CRM" (spec
 * agent-crm-tools): só do tenant da credencial; conversa excluída ou sem cliente ⇒ `null`.
 */
@Injectable()
export class TestConversations {
  constructor(@Inject(DB) private readonly db: Database) {}

  async simulatedClient(
    tenantId: string,
    conversationId: string,
  ): Promise<{ type: TestClientType; id: number } | null> {
    const [row] = await this.db
      .select({ type: agentTestConversation.clientType, id: agentTestConversation.clientId })
      .from(agentTestConversation)
      .where(
        and(
          eq(agentTestConversation.id, conversationId),
          eq(agentTestConversation.tenantId, tenantId),
        ),
      );
    return row?.type && row.id ? { type: row.type, id: row.id } : null;
  }
}
