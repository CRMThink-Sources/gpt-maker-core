import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { BillingModule } from '../billing';
import { GptMakerModule } from '../gptmaker';
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
import { PartnerReportService } from './partner-report.service';
import { ReconciliationAdminController } from './reconciliation-admin.controller';
import { ReconciliationAdminService } from './reconciliation-admin.service';
import { TenantsAdminController } from './tenants-admin.controller';
import { TenantsAdminService } from './tenants-admin.service';
import { WorkspaceAdminController } from './workspace-admin.controller';
import { WorkspaceAdminService } from './workspace-admin.service';

@Module({
  imports: [
    AgentsModule,
    BillingModule,
    GptMakerModule,
    ModelsModule,
    ReconciliationModule,
    TenancyModule,
  ],
  controllers: [
    AdminAuthController,
    OperatorsController,
    PlanRightsController,
    TenantsAdminController,
    ModelsAdminController,
    WorkspaceAdminController,
    ReconciliationAdminController,
  ],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    AuditService,
    OperatorService,
    PlanRightsService,
    TenantsAdminService,
    ModelsAdminService,
    WorkspaceAdminService,
    ReconciliationAdminService,
    PartnerReportService,
  ],
  exports: [AdminAuthService, AdminAuthGuard, AuditService, OperatorService],
})
export class BackofficeModule {}
