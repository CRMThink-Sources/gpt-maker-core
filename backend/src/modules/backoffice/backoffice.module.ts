import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { ModelsModule } from '../models';
import { ReconciliationModule } from '../reconciliation';
import { TenancyModule } from '../tenancy';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AuditService } from './audit.service';
import { ModelsAdminController } from './models-admin.controller';
import { ModelsAdminService } from './models-admin.service';
import { OperatorService } from './operator.service';
import { OperatorsController } from './operators.controller';
import { PlanRightsController } from './plan-rights.controller';
import { PlanRightsService } from './plan-rights.service';
import { TenantsAdminController } from './tenants-admin.controller';
import { TenantsAdminService } from './tenants-admin.service';

@Module({
  imports: [BillingModule, ModelsModule, ReconciliationModule, TenancyModule],
  controllers: [
    AdminAuthController,
    OperatorsController,
    PlanRightsController,
    TenantsAdminController,
    ModelsAdminController,
  ],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    AuditService,
    OperatorService,
    PlanRightsService,
    TenantsAdminService,
    ModelsAdminService,
  ],
  exports: [AdminAuthService, AdminAuthGuard, AuditService, OperatorService],
})
export class BackofficeModule {}
