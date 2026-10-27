import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  type AgentFunctionConfigView,
  type AgentFunctionView,
  type AgentView,
  createAgentSchema,
  type FunctionPreview,
  functionPublishSchema,
  type FunctionTemplateContent,
  previewNewAgentSchema,
  saveFunctionDraftSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { AgentFunctionService, type PublishResult } from './agent-function.service';

class CreateAgentDto extends createZodDto(createAgentSchema) {}
class PreviewNewDto extends createZodDto(previewNewAgentSchema) {}
class SaveDraftDto extends createZodDto(saveFunctionDraftSchema) {}
class PublishDto extends createZodDto(functionPublishSchema) {}

/** Funções que o cliente pode escolher e a criação do agente por função (design D6). */
@Controller('app')
export class AgentFunctionsController {
  constructor(private readonly functions: AgentFunctionService) {}

  @Get('agent-functions')
  @AppAuth()
  async list(@CurrentSession() session: AppSession): Promise<{ functions: AgentFunctionView[] }> {
    return { functions: await this.functions.listFunctions(session.tenantId) };
  }

  @Get('agent-functions/:code')
  @AppAuth()
  form(
    @CurrentSession() session: AppSession,
    @Param('code') code: string,
  ): Promise<AgentFunctionView & { form: FunctionTemplateContent }> {
    return this.functions.functionForm(session.tenantId, code);
  }

  @Post('agent-functions/preview')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  previewNew(
    @CurrentSession() session: AppSession,
    @Body() body: PreviewNewDto,
  ): Promise<FunctionPreview> {
    return this.functions.previewNew(session.tenantId, body);
  }

  @Post('agents')
  @AppAuth('manage')
  create(@CurrentSession() session: AppSession, @Body() body: CreateAgentDto): Promise<AgentView> {
    return this.functions.create(session, body);
  }

  @Get('agents/:id/function')
  @AppAuth()
  get(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
  ): Promise<AgentFunctionConfigView> {
    return this.functions.view(session.tenantId, id);
  }

  @Put('agents/:id/function/draft')
  @AppAuth('manage')
  saveDraft(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Body() body: SaveDraftDto,
  ): Promise<AgentFunctionConfigView> {
    return this.functions.saveDraft(session.tenantId, id, body);
  }

  @Post('agents/:id/function/preview')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  preview(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Body() body: PublishDto,
  ): Promise<FunctionPreview> {
    return this.functions.preview(session.tenantId, id, body);
  }

  @Post('agents/:id/function/publish')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Body() body: PublishDto,
  ): Promise<PublishResult> {
    return this.functions.publish(session.tenantId, id, body);
  }

  @Post('agents/:id/function/retry')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  retry(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
  ): Promise<AgentFunctionConfigView> {
    return this.functions.retry(session.tenantId, id);
  }
}
