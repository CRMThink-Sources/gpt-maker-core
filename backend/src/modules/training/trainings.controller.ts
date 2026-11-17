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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type CreateTrainingInput,
  createTrainingSchema,
  type ListTrainingsQuery,
  listTrainingsQuerySchema,
  type TrainingExport,
  type TrainingImportResult,
  type TrainingListResponse,
  TRAINING_IMAGE_MAX_BYTES,
  type TrainingView,
  type UploadedTrainingImage,
  updateTrainingSchema,
  updateTrainingSettingsSchema,
} from '@gptmaker/contracts';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import type { Response } from 'express';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { TrainingService } from './training.service';
import { TrainingTransferService } from './training-transfer.service';

class UpdateTrainingDto extends createZodDto(updateTrainingSchema) {}
class UpdateTrainingSettingsDto extends createZodDto(updateTrainingSettingsSchema) {}

/** Treinamentos de um agente do tenant da sessão (spec agent-training). */
@Controller('app/agents/:agentId/trainings')
export class TrainingsController {
  constructor(
    private readonly trainings: TrainingService,
    private readonly transfer: TrainingTransferService,
  ) {}

  /** Treinamentos manuais do agente num JSON para baixar (spec agent-training-transfer). */
  @Get('export')
  @AppAuth()
  async export(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TrainingExport> {
    const { file, fileName } = await this.transfer.export(session.tenantId, agentId);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return file;
  }

  /**
   * Cria os treinamentos de um arquivo exportado. O envelope e cada item são validados no serviço
   * (um item inválido não derruba os demais); a resposta traz o resultado item a item.
   */
  @Post('import')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  import(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Body() body: unknown,
  ): Promise<TrainingImportResult> {
    return this.transfer.import(session.tenantId, agentId, body);
  }

  /** Página de treinamentos com filtros (spec training-listing). */
  @Get()
  @AppAuth()
  list(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Query(new ZodValidationPipe(listTrainingsQuerySchema)) query: ListTrainingsQuery,
  ): Promise<TrainingListResponse> {
    return this.trainings.list(session.tenantId, agentId, query);
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

  /** Tags e expiração de qualquer tipo; não reenvia nada ao GPTMaker (spec training-tags). */
  @Patch(':id/settings')
  @AppAuth('manage')
  updateSettings(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Param('id') id: string,
    @Body() body: UpdateTrainingSettingsDto,
  ): Promise<TrainingView> {
    return this.trainings.updateSettings(session.tenantId, agentId, id, body);
  }

  /**
   * Imagem para um treinamento de texto (`multipart/form-data`, campo `file`). Devolve o `imageId`
   * para criar ou editar o treinamento; o limite exato (5 MB) e o tipo são conferidos no serviço.
   */
  @Post('images')
  @AppAuth('manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: TRAINING_IMAGE_MAX_BYTES + 1024 * 1024 } }),
  )
  uploadImage(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @UploadedFile() file: { originalname?: string; buffer?: Buffer } | undefined,
  ): Promise<UploadedTrainingImage> {
    return this.trainings.uploadImage(session.tenantId, agentId, file);
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
