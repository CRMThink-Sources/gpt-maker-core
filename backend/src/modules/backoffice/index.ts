// API pública do módulo: outros módulos só importam daqui.
export { AdminAuth, AdminAuthGuard, CurrentOperator } from './admin-auth.guard';
export { AdminAuthService } from './admin-auth.service';
export { AuditService, type AuditEntry } from './audit.service';
export { BackofficeModule } from './backoffice.module';
export { type Operator, OperatorService } from './operator.service';
