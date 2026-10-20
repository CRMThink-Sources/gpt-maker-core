import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  type NewTestConversationInput,
  newTestConversationSchema,
  type TestConversationSummary,
  type TestConversationView,
  type TestExchangeView,
  type TestMessageInput,
  testMessageInputSchema,
} from '@gptmaker/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { AgentTestService, type Tester } from './agent-test.service';

/** Conversas de teste de um agente do tenant da sessão (spec agent-test-chat): só quem gerencia. */
@Controller('app/agents/:agentId/tests')
export class AgentTestsController {
  constructor(private readonly tests: AgentTestService) {}

  @Get()
  @AppAuth('manage')
  list(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
  ): Promise<TestConversationSummary[]> {
    return this.tests.list(testerOf(session), agentId);
  }

  @Post()
  @AppAuth('manage')
  create(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Body(new ZodValidationPipe(newTestConversationSchema)) body: NewTestConversationInput,
  ): Promise<TestConversationView> {
    return this.tests.create(testerOf(session), agentId, body);
  }

  @Get(':id')
  @AppAuth('manage')
  get(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
  ): Promise<TestConversationView> {
    return this.tests.get(testerOf(session), agentId, id);
  }

  @Delete(':id')
  @AppAuth('manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.tests.remove(testerOf(session), agentId, id);
  }

  @Post(':id/messages')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  send(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(testMessageInputSchema)) body: TestMessageInput,
  ): Promise<TestExchangeView> {
    return this.tests.send(testerOf(session), agentId, id, body);
  }
}

function testerOf(session: AppSession): Tester {
  return {
    tenantId: session.tenantId,
    tenantStatus: session.tenantStatus,
    userId: session.userId,
    userName: session.userName,
  };
}
