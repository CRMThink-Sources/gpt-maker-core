import { Inject, Injectable } from '@nestjs/common';
import type { TestClientType } from '@gptmaker/contracts';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agentTestConversation } from '../../shared/database/schema/index';
import { testContextId } from './test-dialog';

/**
 * Cliente simulado de uma conversa de teste, para a intenção "Consultar cliente no CRM" (spec
 * agent-crm-tools): só do tenant da credencial (o contexto já leva o tenant); conversa excluída
 * ou sem cliente ⇒ `null`.
 */
@Injectable()
export class TestConversations {
  constructor(@Inject(DB) private readonly db: Database) {}

  async simulatedClient(
    tenantId: string,
    dialogKey: string,
  ): Promise<{ type: TestClientType; id: number } | null> {
    const [row] = await this.db
      .select({ type: agentTestConversation.clientType, id: agentTestConversation.clientId })
      .from(agentTestConversation)
      .where(
        and(
          eq(agentTestConversation.contextId, testContextId(tenantId, dialogKey)),
          eq(agentTestConversation.tenantId, tenantId),
        ),
      );
    return row?.type && row.id ? { type: row.type, id: row.id } : null;
  }
}
