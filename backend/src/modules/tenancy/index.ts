// API pública do módulo: outros módulos só importam daqui.
export {
  AppAuth,
  AppSessionGuard,
  CurrentSession,
  type AppAccess,
  type AppSession,
} from './app-session.guard';
export { BitrixEventGuard, BitrixEventTenant } from './bitrix-event.guard';
export { BitrixEventVerifier, type BitrixEventCheck } from './bitrix-event.verifier';
export {
  INSTALLATION_EVENT_TYPES,
  InstallationEventsService,
  isInstallationEvent,
  type InstallationEventType,
} from './installation-events.service';
export { PermissionService, type GrantedUser } from './permission.service';
export { TenancyModule } from './tenancy.module';
export { TenantLifecycle, type TenantLifecycleListener } from './tenant-lifecycle';
export { TenantService, type Tenant, type TenantStatus } from './tenant.service';
