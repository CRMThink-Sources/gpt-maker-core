import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  type IntentionExecutionView,
  type IntentionInput,
  intentionInputSchema,
  type IntentionView,
} from '@gptmaker/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { IntentionService } from './intention.service';

/** Intenções de um agente do tenant da sessão (spec agent-intentions). */
@Controller('app/agents/:agentId/intentions')
export class IntentionsController {
  constructor(private readonly intentions: IntentionService) {}

  @Get()
  @AppAuth()
  list(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
  ): Promise<IntentionView[]> {
    return this.intentions.list(session.tenantId, agentId);
  }

  @Post()
  @AppAuth('manage')
  create(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Body(new ZodValidationPipe(intentionInputSchema)) body: IntentionInput,
  ): Promise<IntentionView> {
    return this.intentions.create(session.tenantId, agentId, body);
  }

  @Get(':id/executions')
  @AppAuth()
  executions(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
  ): Promise<IntentionExecutionView[]> {
    return this.intentions.executions(session.tenantId, agentId, id);
  }

  @Put(':id')
  @AppAuth('manage')
  update(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(intentionInputSchema)) body: IntentionInput,
  ): Promise<IntentionView> {
    return this.intentions.update(session.tenantId, agentId, id, body);
  }

  @Delete(':id')
  @AppAuth('manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.intentions.remove(session.tenantId, agentId, id);
  }
}
