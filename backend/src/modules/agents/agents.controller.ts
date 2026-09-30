import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { type AgentView, createAgentSchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { AgentService } from './agent.service';

class CreateAgentDto extends createZodDto(createAgentSchema) {}

/** Agentes do tenant da sessão; agente de outro tenant responde 404 (spec agent-management). */
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

  @Post()
  @AppAuth('manage')
  create(@CurrentSession() session: AppSession, @Body() body: CreateAgentDto): Promise<AgentView> {
    return this.agents.create(session, body);
  }
}
