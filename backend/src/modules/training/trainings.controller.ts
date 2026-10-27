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
import {
  type CreateTrainingInput,
  createTrainingSchema,
  type TrainingUsage,
  type TrainingView,
  updateTrainingSchema,
} from '@gptmaker/contracts';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { TrainingService } from './training.service';

class UpdateTrainingDto extends createZodDto(updateTrainingSchema) {}

/** Treinamentos de um agente do tenant da sessão (spec agent-training). */
@Controller('app/agents/:agentId/trainings')
export class TrainingsController {
  constructor(private readonly trainings: TrainingService) {}

  @Get()
  @AppAuth()
  async list(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
  ): Promise<{ trainings: TrainingView[]; usage: TrainingUsage }> {
    const [trainings, usage] = await Promise.all([
      this.trainings.list(session.tenantId, agentId),
      this.trainings.usage(session.tenantId),
    ]);
    return { trainings, usage };
  }

  /** Texto, site ou vídeo (JSON); documento não é mais aceito (spec agent-training). */
  @Post()
  @AppAuth('manage')
  create(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    // União por tipo: validada pelo pipe (DTO do nestjs-zod só aceita objeto).
    @Body(new ZodValidationPipe(createTrainingSchema)) body: CreateTrainingInput,
  ): Promise<TrainingView> {
    return this.trainings.create(session.tenantId, agentId, body);
  }

  /** Só treinamentos de texto. */
  @Patch(':id')
  @AppAuth('manage')
  update(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
    @Body() body: UpdateTrainingDto,
  ): Promise<TrainingView> {
    return this.trainings.updateText(session.tenantId, agentId, id, body);
  }

  /** Reenvia um treinamento com falha, com o mesmo conteúdo. */
  @Post(':id/retry')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  retry(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
  ): Promise<TrainingView> {
    return this.trainings.retry(session.tenantId, agentId, id);
  }

  @Delete(':id')
  @AppAuth('manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.trainings.remove(session.tenantId, agentId, id);
  }
}
