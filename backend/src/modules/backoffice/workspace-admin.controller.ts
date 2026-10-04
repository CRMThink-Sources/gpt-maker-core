import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  type AdminWorkspaceView,
  type AgentView,
  linkOrphanSchema,
  type WorkspaceSyncView,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import type { Operator } from './operator.service';
import { WorkspaceAdminService } from './workspace-admin.service';

class LinkOrphanDto extends createZodDto(linkOrphanSchema) {}

/** Workspace GPTMaker: consulta e checagem de saúde para todos; ações nos agentes só ADMIN. */
@Controller('admin/workspace')
export class WorkspaceAdminController {
  constructor(private readonly workspace: WorkspaceAdminService) {}

  @Get()
  @AdminAuth()
  view(): Promise<AdminWorkspaceView> {
    return this.workspace.view();
  }

  @Post('health')
  @AdminAuth()
  @HttpCode(HttpStatus.OK)
  refreshHealth(): Promise<AdminWorkspaceView> {
    return this.workspace.refreshHealth();
  }

  @Post('sync')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  sync(@CurrentOperator() actor: Operator): Promise<WorkspaceSyncView> {
    return this.workspace.syncNow(actor.id);
  }

  @Post('orphans/:findingId/remove')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  removeOrphan(
    @CurrentOperator() actor: Operator,
    @Param('findingId', ParseUUIDPipe) findingId: string,
  ): Promise<AdminWorkspaceView> {
    return this.workspace.removeOrphan(findingId, actor.id);
  }

  @Post('orphans/:findingId/link')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  linkOrphan(
    @CurrentOperator() actor: Operator,
    @Param('findingId', ParseUUIDPipe) findingId: string,
    @Body() body: LinkOrphanDto,
  ): Promise<AgentView> {
    return this.workspace.linkOrphan(findingId, body.tenantId, actor.id);
  }
}
