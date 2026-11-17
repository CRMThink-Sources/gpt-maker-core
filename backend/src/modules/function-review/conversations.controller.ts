import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  type ConversationList,
  type ConversationMessages,
  conversationMessagesQuerySchema,
  listConversationsQuerySchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { ConversationSourceService } from './conversation-source.service';

class ListConversationsDto extends createZodDto(listConversationsQuerySchema) {}
class ConversationMessagesDto extends createZodDto(conversationMessagesQuerySchema) {}

/**
 * Conversas do agente para a análise de alucinação (spec agent-hallucination-analysis): acesso
 * `manage`, como a revisão por IA; o texto das conversas é de clientes finais.
 */
@Controller('app/agents/:id/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationSourceService) {}

  @Get()
  @AppAuth('manage')
  list(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Query() query: ListConversationsDto,
  ): Promise<ConversationList> {
    return this.conversations.list(session.tenantId, id, query.source, query.cursor);
  }

  /** `conversationId` é o id local (teste) ou o chat do GPTMaker (real); chega codificado na URL. */
  @Get(':conversationId/messages')
  @AppAuth('manage')
  messages(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
    @Query() query: ConversationMessagesDto,
  ): Promise<ConversationMessages> {
    return this.conversations.messages(session.tenantId, id, query.source, conversationId);
  }
}
