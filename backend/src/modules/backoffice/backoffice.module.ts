import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { BillingModule } from '../billing';
import { GptMakerModule } from '../gptmaker';
import { ModelsModule } from '../models';
import { PaymentsModule } from '../payments';
import { ReconciliationModule } from '../reconciliation';
import { TenancyModule } from '../tenancy';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
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
import { SubscriptionAdminService } from './subscription-admin.service';
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
    PaymentsModule,
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
    AuditController,
  ],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    AuditService,
    AuditQueryService,
    AdminAuditInterceptor,
    OperatorService,
    PlanRightsService,
    TenantsAdminService,
    ModelsAdminService,
    WorkspaceAdminService,
    ReconciliationAdminService,
    PartnerReportService,
    SubscriptionAdminService,
  ],
  exports: [AdminAuthService, AdminAuthGuard, AuditService, OperatorService],
})
export class BackofficeModule {}
