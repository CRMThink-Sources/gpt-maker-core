import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AdminTenantDetail,
  type AdminTenantRow,
  grantCreditsSchema,
  suspendTenantSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import type { Operator } from './operator.service';
import { TenantsAdminService } from './tenants-admin.service';

class SuspendDto extends createZodDto(suspendTenantSchema) {}
class GrantCreditsDto extends createZodDto(grantCreditsSchema) {}

/** Tenants no backoffice: consulta para todos; suspender, reativar e conceder créditos só ADMIN. */
@Controller('admin/tenants')
export class TenantsAdminController {
  constructor(private readonly tenants: TenantsAdminService) {}

  @Get()
  @AdminAuth()
  list(@Query('q') q?: string): Promise<AdminTenantRow[]> {
    return this.tenants.list(q);
  }

  @Get(':id')
  @AdminAuth()
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminTenantDetail> {
    return this.tenants.detail(id);
  }

  @Post(':id/suspend')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SuspendDto,
  ): Promise<AdminTenantDetail> {
    return this.tenants.suspend(id, body.reason, actor.id);
  }

  @Post(':id/reactivate')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminTenantDetail> {
    return this.tenants.reactivate(id, actor.id);
  }

  @Post(':id/credits')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  grantCredits(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GrantCreditsDto,
  ): Promise<AdminTenantDetail> {
    return this.tenants.grantCredits(id, body, actor.id);
  }
}
