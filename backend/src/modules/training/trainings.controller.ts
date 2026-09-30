import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  type CreateTrainingInput,
  createTrainingSchema,
  type TrainingView,
} from '@gptmaker/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { DocumentUploadInterceptor } from './document-upload.interceptor';
import { TrainingService } from './training.service';

/** Treinamentos de um agente do tenant da sessão (spec agent-training). */
@Controller('app/agents/:agentId/trainings')
export class TrainingsController {
  constructor(private readonly trainings: TrainingService) {}

  @Get()
  @AppAuth()
  async list(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
  ): Promise<{ trainings: TrainingView[] }> {
    return { trainings: await this.trainings.list(session.tenantId, agentId) };
  }

  /** Texto, site ou vídeo (JSON). */
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

  /** Documento (`multipart/form-data`, campo `file`). */
  @Post('document')
  @AppAuth('manage')
  @UseInterceptors(DocumentUploadInterceptor)
  createDocument(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<TrainingView> {
    if (!file) {
      throw new DomainError(
        'TRAINING_FILE_INVALID',
        'Envie o arquivo no campo "file"',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.trainings.createDocument(session.tenantId, agentId, {
      originalName: file.originalname,
      buffer: file.buffer,
    });
  }
}
