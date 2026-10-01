import { Injectable, Logger } from '@nestjs/common';
import type { Tenant } from './tenant.service';

/**
 * Reações de outros módulos ao ciclo de vida da instalação. Os módulos que dependem de tenancy
 * (agentes, canal) se registram no `onModuleInit`; assim tenancy não depende deles.
 */
export interface TenantLifecycleListener {
  /** Nome estável para logs (ex.: `agents`). */
  readonly name: string;
  /** Instalador concluindo; `reinstall` também em nova tentativa de instalação já iniciada. */
  onInstalled?(tenant: Tenant, event: { reinstall: boolean }): Promise<void>;
  onUninstalled?(tenant: Tenant): Promise<void>;
  onAuthError?(tenant: Tenant): Promise<void>;
  onAuthRestored?(tenant: Tenant): Promise<void>;
  /** Suspensão ou assinatura do tenant mudou (backoffice, eventos da plataforma, carência). */
  onAccessChanged?(tenant: Tenant): Promise<void>;
}

type Hook = 'onInstalled' | 'onUninstalled' | 'onAuthError' | 'onAuthRestored' | 'onAccessChanged';

@Injectable()
export class TenantLifecycle {
  private readonly logger = new Logger(TenantLifecycle.name);
  private readonly listeners: TenantLifecycleListener[] = [];

  register(listener: TenantLifecycleListener): void {
    this.listeners.push(listener);
  }

  /**
   * Chama os ouvintes em ordem de registro; o primeiro erro interrompe e sobe (o chamador
   * responde erro e a entrega é repetida, então cada ouvinte precisa ser idempotente).
   */
  async emit<H extends Hook>(
    hook: H,
    ...args: Parameters<NonNullable<TenantLifecycleListener[H]>>
  ): Promise<void> {
    for (const listener of this.listeners) {
      const fn = listener[hook] as ((...a: typeof args) => Promise<void>) | undefined;
      if (!fn) continue;
      try {
        await fn.apply(listener, args);
      } catch (error) {
        this.logger.error(
          { listener: listener.name, hook, err: error },
          'ouvinte do ciclo de vida falhou',
        );
        throw error;
      }
    }
  }
}
