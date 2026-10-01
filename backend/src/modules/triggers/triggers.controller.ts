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
  Query,
} from '@nestjs/common';
import {
  type CreateTriggerInput,
  createTriggerSchema,
  type TriggerExecutionView,
  type TriggerView,
  type TriggerWriteResult,
  type UpdateTriggerInput,
  updateTriggerSchema,
} from '@gptmaker/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { TriggerService } from './trigger.service';

/** Gatilhos de um agente do tenant da sessão (spec agent-triggers: cadastro). */
@Controller('app/agents/:agentId/triggers')
export class TriggersController {
  constructor(private readonly triggers: TriggerService) {}

  @Get()
  @AppAuth()
  async list(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
  ): Promise<{ triggers: TriggerView[] }> {
    return { triggers: await this.triggers.list(session.tenantId, agentId) };
  }

  @Post()
  @AppAuth('manage')
  create(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    // Ações são união por tipo: validada pelo pipe (DTO do nestjs-zod só aceita objeto).
    @Body(new ZodValidationPipe(createTriggerSchema)) body: CreateTriggerInput,
  ): Promise<TriggerWriteResult> {
    return this.triggers.create(session.tenantId, agentId, body);
  }

  /** Editar, ativar e desativar (`active`). */
  @Patch(':id')
  @AppAuth('manage')
  update(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTriggerSchema)) body: UpdateTriggerInput,
  ): Promise<TriggerWriteResult> {
    return this.triggers.update(session.tenantId, agentId, id, body);
  }

  /** Histórico de execuções (`?limit=`, padrão 50, máximo 100). */
  @Get(':id/executions')
  @AppAuth()
  async executions(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ): Promise<{ executions: TriggerExecutionView[] }> {
    const parsed = Number(limit);
    return {
      executions: await this.triggers.executions(
        session.tenantId,
        agentId,
        id,
        Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
      ),
    };
  }

  @Delete(':id')
  @AppAuth('manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.triggers.remove(session.tenantId, agentId, id);
  }
}
