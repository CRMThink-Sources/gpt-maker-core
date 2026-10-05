import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type AdminModelCostChange,
  type AdminModelView,
  createModelSchema,
  removeModelSchema,
  updateModelSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import type { AiModel } from '../models';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import { ModelsAdminService } from './models-admin.service';
import type { Operator } from './operator.service';

class CreateModelDto extends createZodDto(createModelSchema) {}
class UpdateModelDto extends createZodDto(updateModelSchema) {}
class RemoveModelDto extends createZodDto(removeModelSchema) {}

/** Catálogo de modelos no backoffice: consulta para todos; alterações só ADMIN (auditadas). */
@Controller('admin/models')
export class ModelsAdminController {
  constructor(private readonly models: ModelsAdminService) {}

  @Get()
  @AdminAuth()
  list(): Promise<AdminModelView[]> {
    return this.models.list();
  }

  @Get(':id/history')
  @AdminAuth()
  history(@Param('id', ParseUUIDPipe) id: string): Promise<AdminModelCostChange[]> {
    return this.models.history(id);
  }

  @Post()
  @AdminAuth('ADMIN')
  create(@CurrentOperator() actor: Operator, @Body() body: CreateModelDto): Promise<AiModel> {
    return this.models.create(body, actor.id);
  }

  @Patch(':id')
  @AdminAuth('ADMIN')
  update(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateModelDto,
  ): Promise<AiModel> {
    return this.models.update(id, body, actor.id);
  }

  @Post(':id/default')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  setDefault(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiModel> {
    return this.models.setDefault(id, actor.id);
  }

  @Post(':id/activate')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  activate(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiModel> {
    return this.models.setActive(id, true, actor.id);
  }

  @Post(':id/deactivate')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiModel> {
    return this.models.setActive(id, false, actor.id);
  }

  /** POST (não DELETE): leva corpo com o substituto. */
  @Post(':id/remove')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RemoveModelDto,
  ): Promise<{ migratedAgents: number }> {
    return this.models.remove(id, body, actor.id);
  }
}
