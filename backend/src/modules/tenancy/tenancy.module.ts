import { Module } from '@nestjs/common';
import { BitrixModule } from '../bitrix';
import { AppSessionController } from './app-session.controller';
import { AppSessionGuard } from './app-session.guard';
import { BitrixEventGuard } from './bitrix-event.guard';
import { BitrixEventVerifier } from './bitrix-event.verifier';
import { InstallationEventsService } from './installation-events.service';
import { InstallerController } from './installer.controller';
import { InstallerService } from './installer.service';
import { PermissionService } from './permission.service';
import { TenantLifecycle } from './tenant-lifecycle';
import { TenantService } from './tenant.service';

@Module({
  imports: [BitrixModule],
  controllers: [InstallerController, AppSessionController],
  providers: [
    TenantService,
    TenantLifecycle,
    PermissionService,
    InstallerService,
    InstallationEventsService,
    BitrixEventVerifier,
    BitrixEventGuard,
    AppSessionGuard,
  ],
  exports: [
    TenantService,
    TenantLifecycle,
    PermissionService,
    InstallationEventsService,
    BitrixEventVerifier,
    BitrixEventGuard,
    AppSessionGuard,
  ],
})
export class TenancyModule {}
