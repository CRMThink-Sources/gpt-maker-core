import { Module } from '@nestjs/common';
import { AgentFunctionsModule } from '../agent-functions';
import { AgentsModule } from '../agents';
import { BillingModule } from '../billing';
import { CrmToolsModule } from '../crm-tools';
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
import { CrmGuidanceAdminController } from './crm-guidance-admin.controller';
import { CrmGuidanceAdminService } from './crm-guidance-admin.service';
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
import { DeadLetterInspector } from './dead-letter-inspector';
import { FailuresService } from './failures.service';
import {
  FunctionBlocksAdminController,
  FunctionsAdminController,
} from './functions-admin.controller';
import { FunctionsAdminService } from './functions-admin.service';
import { OperationsAdminController } from './operations-admin.controller';
import { OperationsAdminService } from './operations-admin.service';
import { TenantsAdminController } from './tenants-admin.controller';
import { TenantsAdminService } from './tenants-admin.service';
import { WorkspaceAdminController } from './workspace-admin.controller';
import { WorkspaceAdminService } from './workspace-admin.service';

@Module({
  imports: [
    AgentFunctionsModule,
    AgentsModule,
    BillingModule,
    CrmToolsModule,
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
    OperationsAdminController,
    FunctionsAdminController,
    FunctionBlocksAdminController,
    CrmGuidanceAdminController,
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
    DeadLetterInspector,
    FailuresService,
    OperationsAdminService,
    FunctionsAdminService,
    CrmGuidanceAdminService,
  ],
  exports: [AdminAuthService, AdminAuthGuard, AuditService, OperatorService],
})
export class BackofficeModule {}
