import {
  type CreateItemRequest,
  type CurrentSubscription,
  type Installation,
  PlatformClient,
  PlatformError,
  PlatformRequestError,
  type PlatformToken,
  type SubscriptionItem,
  type UpdateItemRequest,
} from '@crmthink-sources/platform-sdk';
import { ExponentialBackoff, handleWhen, retry } from 'cockatiel';
import { Histogram } from 'prom-client';
import { metricsRegistry } from '../metrics/metrics';

export { PlatformError };

/** Plataforma fora do ar, 5xx ou tempo esgotado; `status` 0 quando nem houve resposta. */
export const PLATFORM_UNAVAILABLE = 'PLATFORM_UNAVAILABLE';

export function isPlatformUnavailable(error: unknown): boolean {
  return error instanceof PlatformError && error.code === PLATFORM_UNAVAILABLE;
}

export interface PlatformApiOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  /** Tentativas por chamada em falha transitória (todas as rotas usadas aqui são idempotentes). */
  maxAttempts?: number;
}

const duration = new Histogram({
  name: 'platform_request_duration_seconds',
  help: 'Duração das chamadas ao crmthink-platform por operação e resultado',
  labelNames: ['operation', 'outcome'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

/**
 * Cliente da API do crmthink-platform sobre o `PlatformClient` do SDK oficial
 * (`@crmthink-sources/platform-sdk`), com retentativa em falha transitória e métrica por
 * operação. Erros saem como `PlatformError` com o código estável do envelope `{ error: { code } }`;
 * decida pelo código, nunca pela mensagem.
 */
export class PlatformApiClient {
  private readonly client: PlatformClient;

  constructor(
    private readonly options: PlatformApiOptions,
    fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.client = new PlatformClient({
      platformUrl: options.baseUrl,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
      fetch: fetchFn,
    });
  }

  getInstallation(installationId: number): Promise<Installation> {
    return this.call('installation.get', () => this.client.getInstallation(installationId));
  }

  /**
   * Sempre vai à plataforma: o cache do token é o Redis do `PlatformTokenProvider`, compartilhado
   * entre api e worker; o cache em memória do SDK não pode servir token já esquecido.
   */
  getToken(installationId: number): Promise<PlatformToken> {
    return this.call('token.get', () => {
      this.client.forgetInstallationToken(installationId);
      return this.client.getInstallationToken(installationId);
    });
  }

  /** Single-flight na plataforma: vários processos pedindo juntos geram uma renovação só. */
  refreshToken(installationId: number, staleAccessToken: string): Promise<PlatformToken> {
    return this.call('token.refresh', () =>
      this.client.refreshInstallationToken(installationId, staleAccessToken),
    );
  }

  /** Assinatura vigente da instalação; sem assinatura responde `NO_SUBSCRIPTION`. */
  getSubscription(installationId: number): Promise<CurrentSubscription> {
    return this.call('subscription.get', () => this.client.getSubscription(installationId));
  }

  listItems(subscriptionId: number): Promise<SubscriptionItem[]> {
    return this.call('item.list', async () => (await this.client.listItems(subscriptionId)).items);
  }

  /** Idempotente por `externalRef`: se o item já existe, a plataforma devolve o existente. */
  createItem(subscriptionId: number, body: CreateItemRequest): Promise<SubscriptionItem> {
    return this.call('item.create', () => this.client.createItem(subscriptionId, body));
  }

  updateItem(
    subscriptionId: number,
    itemId: number,
    body: UpdateItemRequest,
  ): Promise<SubscriptionItem> {
    return this.call('item.update', () => this.client.updateItem(subscriptionId, itemId, body));
  }

  removeItem(subscriptionId: number, itemId: number): Promise<SubscriptionItem> {
    return this.call('item.remove', () => this.client.removeItem(subscriptionId, itemId));
  }

  private async call<T>(operation: string, send: () => Promise<T>): Promise<T> {
    const policy = retry(
      handleWhen((error) => isPlatformUnavailable(error)),
      {
        maxAttempts: (this.options.maxAttempts ?? 3) - 1,
        backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 2000 }),
      },
    );
    const end = duration.startTimer({ operation });
    try {
      const data = await policy.execute(() => attempt(operation, send));
      end({ outcome: 'ok' });
      return data;
    } catch (error) {
      end({ outcome: error instanceof PlatformError ? error.code : 'error' });
      throw error;
    }
  }
}

/** Sem resposta, 5xx e 429 viram `PLATFORM_UNAVAILABLE` (retentável); o resto segue do SDK. */
async function attempt<T>(operation: string, send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (error instanceof PlatformRequestError) {
      throw new PlatformError(0, PLATFORM_UNAVAILABLE, `${operation}: ${error.message}`);
    }
    if (error instanceof PlatformError && (error.status >= 500 || error.status === 429)) {
      throw new PlatformError(
        error.status,
        PLATFORM_UNAVAILABLE,
        `${operation}: HTTP ${error.status}`,
      );
    }
    if (error instanceof PlatformError) {
      throw new PlatformError(
        error.status,
        error.code,
        `${operation}: ${error.message}`,
        error.details,
      );
    }
    throw error;
  }
}
