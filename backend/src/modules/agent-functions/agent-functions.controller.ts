import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  type AgentFunctionConfigView,
  type AgentFunctionView,
  type AgentView,
  createAgentSchema,
  type FunctionPreview,
  functionPublishSchema,
  type FunctionTemplateContent,
  type Locale,
  previewNewAgentSchema,
  saveFunctionDraftSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { RequestLocale } from '../../shared/http/request-locale';
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
  async list(
    @CurrentSession() session: AppSession,
    @RequestLocale() locale: Locale,
  ): Promise<{ functions: AgentFunctionView[] }> {
    return { functions: await this.functions.listFunctions(session.tenantId, locale) };
  }

  @Get('agent-functions/:code')
  @AppAuth()
  form(
    @CurrentSession() session: AppSession,
    @Param('code') code: string,
    @RequestLocale() locale: Locale,
  ): Promise<AgentFunctionView & { form: FunctionTemplateContent }> {
    return this.functions.functionForm(session.tenantId, code, locale);
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
    @RequestLocale() locale: Locale,
  ): Promise<AgentFunctionConfigView> {
    return this.functions.view(session.tenantId, id, locale);
  }

  @Put('agents/:id/function/draft')
  @AppAuth('manage')
  saveDraft(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Body() body: SaveDraftDto,
    @RequestLocale() locale: Locale,
  ): Promise<AgentFunctionConfigView> {
    return this.functions.saveDraft(session.tenantId, id, body, locale);
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
    @RequestLocale() locale: Locale,
  ): Promise<AgentFunctionConfigView> {
    return this.functions.retry(session.tenantId, id, locale);
  }
}
