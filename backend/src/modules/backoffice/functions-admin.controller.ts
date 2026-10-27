import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  type AdminFunctionBlockView,
  type AdminFunctionTemplateSummary,
  type AdminFunctionTemplateView,
  type AdminFunctionVersionView,
  createFunctionBlockSchema,
  createFunctionTemplateSchema,
  type FunctionDraftPreview,
  type FunctionVersionDiff,
  previewFunctionDraftSchema,
  saveFunctionBlockSchema,
  saveFunctionTemplateSchema,
  setFunctionTenantsSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { FunctionCatalog, type SandboxResult } from '../agent-functions';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import { FunctionsAdminService } from './functions-admin.service';
import type { Operator } from './operator.service';

class CreateTemplateDto extends createZodDto(createFunctionTemplateSchema) {}
class SaveTemplateDto extends createZodDto(saveFunctionTemplateSchema) {}
class PreviewDraftDto extends createZodDto(previewFunctionDraftSchema) {}
class CreateBlockDto extends createZodDto(createFunctionBlockSchema) {}
class SaveBlockDto extends createZodDto(saveFunctionBlockSchema) {}
class SetTenantsDto extends createZodDto(setFunctionTenantsSchema) {}

/** Templates de função: consulta para todos os operadores; alterações só ADMIN (auditadas). */
@Controller('admin/functions')
export class FunctionsAdminController {
  constructor(
    private readonly catalog: FunctionCatalog,
    private readonly admin: FunctionsAdminService,
  ) {}

  @Get()
  @AdminAuth()
  list(): Promise<AdminFunctionTemplateSummary[]> {
    return this.catalog.listTemplates();
  }

  @Get(':code')
  @AdminAuth()
  get(@Param('code') code: string): Promise<AdminFunctionTemplateView> {
    return this.catalog.getTemplate(code);
  }

  @Post()
  @AdminAuth('ADMIN')
  create(
    @CurrentOperator() actor: Operator,
    @Body() body: CreateTemplateDto,
  ): Promise<AdminFunctionTemplateView> {
    return this.admin.createTemplate(body, actor.id);
  }

  @Put(':code/draft')
  @AdminAuth('ADMIN')
  save(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
    @Body() body: SaveTemplateDto,
  ): Promise<AdminFunctionTemplateView> {
    return this.admin.saveTemplate(code, body, actor.id);
  }

  @Post(':code/preview')
  @AdminAuth()
  @HttpCode(HttpStatus.OK)
  preview(
    @Param('code') code: string,
    @Body() body: PreviewDraftDto,
  ): Promise<FunctionDraftPreview> {
    return this.catalog.previewDraft(code, body);
  }

  @Post(':code/publish')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
  ): Promise<AdminFunctionTemplateView> {
    return this.admin.publishTemplate(code, actor.id);
  }

  @Post(':code/inactivate')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  inactivate(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
  ): Promise<AdminFunctionTemplateView> {
    return this.admin.setActive(code, false, actor.id);
  }

  @Post(':code/activate')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  activate(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
  ): Promise<AdminFunctionTemplateView> {
    return this.admin.setActive(code, true, actor.id);
  }

  /** Portais em que a função aparece na criação de agentes; lista vazia = todos. */
  @Put(':code/tenants')
  @AdminAuth('ADMIN')
  setTenants(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
    @Body() body: SetTenantsDto,
  ): Promise<AdminFunctionTemplateView> {
    return this.admin.setTenants(code, body, actor.id);
  }

  @Delete(':code')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentOperator() actor: Operator, @Param('code') code: string): Promise<void> {
    return this.admin.remove(code, actor.id);
  }

  @Post(':code/sandbox')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  sandbox(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
    @Body() body: PreviewDraftDto,
  ): Promise<SandboxResult> {
    return this.admin.publishSandbox(code, body, actor.id);
  }

  @Get(':code/versions/:version')
  @AdminAuth()
  version(
    @Param('code') code: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<AdminFunctionVersionView> {
    return this.catalog.getVersion(code, version);
  }

  @Get(':code/versions/:from/diff/:to')
  @AdminAuth()
  diff(
    @Param('code') code: string,
    @Param('from', ParseIntPipe) from: number,
    @Param('to', ParseIntPipe) to: number,
  ): Promise<FunctionVersionDiff> {
    return this.catalog.diffVersions(code, from, to);
  }

  @Post(':code/versions/:version/restore')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<AdminFunctionTemplateView> {
    return this.admin.restoreVersion(code, version, actor.id);
  }
}

/** Blocos compartilhados entre os templates. */
@Controller('admin/function-blocks')
export class FunctionBlocksAdminController {
  constructor(
    private readonly catalog: FunctionCatalog,
    private readonly admin: FunctionsAdminService,
  ) {}

  @Get()
  @AdminAuth()
  list(): Promise<AdminFunctionBlockView[]> {
    return this.catalog.listBlocks();
  }

  @Get(':code')
  @AdminAuth()
  get(@Param('code') code: string): Promise<AdminFunctionBlockView> {
    return this.catalog.getBlock(code);
  }

  @Post()
  @AdminAuth('ADMIN')
  create(
    @CurrentOperator() actor: Operator,
    @Body() body: CreateBlockDto,
  ): Promise<AdminFunctionBlockView> {
    return this.admin.createBlock(body, actor.id);
  }

  @Put(':code/draft')
  @AdminAuth('ADMIN')
  save(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
    @Body() body: SaveBlockDto,
  ): Promise<AdminFunctionBlockView> {
    return this.admin.saveBlock(code, body, actor.id);
  }

  @Post(':code/publish')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentOperator() actor: Operator,
    @Param('code') code: string,
  ): Promise<AdminFunctionBlockView> {
    return this.admin.publishBlock(code, actor.id);
  }

  @Delete(':code')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentOperator() actor: Operator, @Param('code') code: string): Promise<void> {
    return this.admin.removeBlock(code, actor.id);
  }
}
