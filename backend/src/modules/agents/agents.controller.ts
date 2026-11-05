import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { type AgentView, type AvailableModel, updateAgentSchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { AgentService } from './agent.service';

class UpdateAgentDto extends createZodDto(updateAgentSchema) {}

/**
 * Agentes do tenant da sessão; agente de outro tenant responde 404 (spec agent-management). A
 * criação fica com a função do agente (`AgentFunctionsController`, design D6).
 */
@Controller('app/agents')
export class AgentsController {
  constructor(private readonly agents: AgentService) {}

  @Get()
  @AppAuth()
  async list(@CurrentSession() session: AppSession): Promise<{ agents: AgentView[] }> {
    return { agents: await this.agents.list(session.tenantId) };
  }

  @Get(':id')
  @AppAuth()
  get(@CurrentSession() session: AppSession, @Param('id') id: string): Promise<AgentView> {
    return this.agents.get(session.tenantId, id);
  }

  @Patch(':id')
  @AppAuth('manage')
  update(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Body() body: UpdateAgentDto,
  ): Promise<AgentView> {
    return this.agents.update(session, id, body);
  }

  @Post(':id/inactivate')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  inactivate(@CurrentSession() session: AppSession, @Param('id') id: string): Promise<AgentView> {
    return this.agents.inactivate(session, id);
  }

  @Post(':id/activate')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  activate(@CurrentSession() session: AppSession, @Param('id') id: string): Promise<AgentView> {
    return this.agents.activate(session, id);
  }

  @Delete(':id')
  @AppAuth('manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentSession() session: AppSession, @Param('id') id: string): Promise<void> {
    return this.agents.remove(session, id);
  }
}

/** Modelos oferecidos no formulário do agente, com o custo por resposta (spec ai-model-catalog). */
@Controller('app/models')
export class AppModelsController {
  constructor(private readonly agents: AgentService) {}

  @Get()
  @AppAuth()
  async list(@CurrentSession() session: AppSession): Promise<{ models: AvailableModel[] }> {
    return { models: await this.agents.availableModels(session.tenantId) };
  }
}
