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
  type AdminSubscriptionCheckView,
  type AdminSubscriptionView,
  type AdminTenantDetail,
  type AdminTenantFailures,
  type AdminTenantRow,
  grantCreditsSchema,
  setTenantPartnerSchema,
  suspendTenantSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import type { Operator } from './operator.service';
import { FailuresService } from './failures.service';
import { SubscriptionAdminService } from './subscription-admin.service';
import { TenantsAdminService } from './tenants-admin.service';

class SuspendDto extends createZodDto(suspendTenantSchema) {}
class GrantCreditsDto extends createZodDto(grantCreditsSchema) {}
class SetPartnerDto extends createZodDto(setTenantPartnerSchema) {}

/** Tenants no backoffice: consulta para todos; suspender, reativar e conceder créditos só ADMIN. */
@Controller('admin/tenants')
export class TenantsAdminController {
  constructor(
    private readonly tenants: TenantsAdminService,
    private readonly subscriptions: SubscriptionAdminService,
    private readonly failures: FailuresService,
  ) {}

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

  /** Assinatura: projeção, eventos da plataforma e links para os SPAs (15.5). */
  @Get(':id/subscription')
  @AdminAuth()
  subscription(@Param('id', ParseUUIDPipe) id: string): Promise<AdminSubscriptionView> {
    return this.subscriptions.view(id);
  }

  /** Falhas definitivas do portal nos últimos 30 dias (15.7). */
  @Get(':id/failures')
  @AdminAuth()
  tenantFailures(@Param('id', ParseUUIDPipe) id: string): Promise<AdminTenantFailures> {
    return this.failures.ofTenant(id);
  }

  @Post(':id/subscription/check')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  checkSubscription(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminSubscriptionCheckView> {
    return this.subscriptions.check(id, actor.id);
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

  @Post(':id/partner')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  setPartner(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPartnerDto,
  ): Promise<AdminTenantDetail> {
    return this.tenants.setPartner(id, body.partner, actor.id);
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
