import { Module } from '@nestjs/common';
import { ModelsModule } from '../models';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AuditService } from './audit.service';
import { OperatorService } from './operator.service';
import { OperatorsController } from './operators.controller';
import { PlanRightsController } from './plan-rights.controller';
import { PlanRightsService } from './plan-rights.service';

@Module({
  imports: [ModelsModule],
  controllers: [AdminAuthController, OperatorsController, PlanRightsController],
  providers: [AdminAuthService, AdminAuthGuard, AuditService, OperatorService, PlanRightsService],
  exports: [AdminAuthService, AdminAuthGuard, AuditService, OperatorService],
})
export class BackofficeModule {}
