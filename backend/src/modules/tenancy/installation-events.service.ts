import { Injectable, Logger } from '@nestjs/common';
import type { PlatformEvent } from '@gptmaker/platform-sdk';
import { PlatformTokenProvider } from '../bitrix';
import { enrichContext } from '../../shared/context/request-context';
import { BitrixEventVerifier } from './bitrix-event.verifier';
import { TenantLifecycle } from './tenant-lifecycle';
import { TenantService } from './tenant.service';

export const INSTALLATION_EVENT_TYPES = [
  'installation.created',
  'installation.reinstalled',
  'installation.removed',
  'installation.auth_error',
  'installation.auth_restored',
] as const;

export type InstallationEventType = (typeof INSTALLATION_EVENT_TYPES)[number];

export function isInstallationEvent(type: string): type is InstallationEventType {
  return (INSTALLATION_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Efeitos dos eventos `installation.*` da plataforma (design D3). Idempotente: a entrega é
 * "pelo menos uma vez" e o mesmo evento pode ser reprocessado após falha.
 */
@Injectable()
export class InstallationEventsService {
  private readonly logger = new Logger(InstallationEventsService.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly lifecycle: TenantLifecycle,
    private readonly tokens: PlatformTokenProvider,
    private readonly eventVerifier: BitrixEventVerifier,
  ) {}

  async handle(event: PlatformEvent): Promise<void> {
    const tenant = await this.tenants.findByInstallationId(event.installationId);
    if (!tenant) {
      // Instalador ainda não concluiu (ou falhou): nada a desfazer; o instalador cria o tenant.
      this.logger.warn(
        { installationId: event.installationId, type: event.type },
        'evento de instalação sem tenant',
      );
      return;
    }
    enrichContext({ tenantId: tenant.id });

    switch (event.type as InstallationEventType) {
      case 'installation.created':
        return;
      case 'installation.reinstalled':
        // O instalador já reativou; aqui só garante que não sobra application_token antigo.
        await this.eventVerifier.invalidate(event.installationId);
        return;
      case 'installation.removed':
        await this.tenants.markUninstalled(tenant.id);
        await Promise.all([
          this.tokens.forget(event.installationId),
          this.eventVerifier.invalidate(event.installationId),
        ]);
        await this.lifecycle.emit('onUninstalled', { ...tenant, status: 'UNINSTALLED' });
        this.logger.log({ installationId: event.installationId }, 'tenant desinstalado');
        return;
      case 'installation.auth_error':
        if (await this.tenants.markAuthError(tenant.id)) {
          await this.tokens.forget(event.installationId);
          await this.lifecycle.emit('onAuthError', { ...tenant, status: 'AUTH_ERROR' });
          this.logger.warn(
            { alert: true, installationId: event.installationId, data: event.data },
            'portal com erro de autorização; processamento pausado',
          );
        }
        return;
      case 'installation.auth_restored':
        if (await this.tenants.markAuthRestored(tenant.id)) {
          await this.lifecycle.emit('onAuthRestored', { ...tenant, status: 'ACTIVE' });
          this.logger.log({ installationId: event.installationId }, 'autorização restabelecida');
        }
        return;
    }
  }
}
