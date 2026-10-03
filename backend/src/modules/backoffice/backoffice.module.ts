import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AuditService } from './audit.service';
import { OperatorService } from './operator.service';
import { OperatorsController } from './operators.controller';

@Module({
  controllers: [AdminAuthController, OperatorsController],
  providers: [AdminAuthService, AdminAuthGuard, AuditService, OperatorService],
  exports: [AdminAuthService, AdminAuthGuard, AuditService, OperatorService],
})
export class BackofficeModule {}
