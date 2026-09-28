import {
  PlatformError,
  type paths,
  type PlatformInstallation,
  type PlatformTokenResponse,
} from '@gptmaker/platform-sdk';
import { ExponentialBackoff, handleWhen, retry } from 'cockatiel';
import createClient, { type Client } from 'openapi-fetch';
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

type ApiResult<T> = { data?: T; error?: unknown; response: Response };

/**
 * Cliente da API do crmthink-platform com tipos gerados do OpenAPI
 * (docs/crmthink-platform-openapi.json). Erros saem como `PlatformError` com o código estável
 * do envelope `{ error: { code } }`; decida pelo código, nunca pela mensagem.
 */
export class PlatformApiClient {
  private readonly client: Client<paths>;

  constructor(
    private readonly options: PlatformApiOptions,
    fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.client = createClient<paths>({
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
      headers: { Authorization: `Bearer ${options.apiKey}` },
      fetch: fetchFn,
    });
  }

  getInstallation(installationId: number): Promise<PlatformInstallation> {
    return this.call('installation.get', (signal) =>
      this.client.GET('/v1/installations/{id}', {
        params: { path: { id: installationId } },
        signal,
      }),
    );
  }

  getToken(installationId: number): Promise<PlatformTokenResponse> {
    return this.call('token.get', (signal) =>
      this.client.GET('/v1/installations/{id}/token', {
        params: { path: { id: installationId } },
        signal,
      }),
    );
  }

  /** Single-flight na plataforma: vários processos pedindo juntos geram uma renovação só. */
  refreshToken(installationId: number, staleAccessToken: string): Promise<PlatformTokenResponse> {
    return this.call('token.refresh', (signal) =>
      this.client.POST('/v1/installations/{id}/token/refresh', {
        params: { path: { id: installationId } },
        body: { staleAccessToken },
        signal,
      }),
    );
  }

  private async call<T>(
    operation: string,
    send: (signal: AbortSignal) => Promise<ApiResult<T>>,
  ): Promise<T> {
    const policy = retry(
      handleWhen((error) => isPlatformUnavailable(error)),
      {
        maxAttempts: (this.options.maxAttempts ?? 3) - 1,
        backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 2000 }),
      },
    );
    const end = duration.startTimer({ operation });
    try {
      const data = await policy.execute(() => this.attempt(operation, send));
      end({ outcome: 'ok' });
      return data;
    } catch (error) {
      end({ outcome: error instanceof PlatformError ? error.code : 'error' });
      throw error;
    }
  }

  private async attempt<T>(
    operation: string,
    send: (signal: AbortSignal) => Promise<ApiResult<T>>,
  ): Promise<T> {
    let result: ApiResult<T>;
    try {
      result = await send(AbortSignal.timeout(this.options.timeoutMs));
    } catch (error) {
      throw new PlatformError(
        0,
        PLATFORM_UNAVAILABLE,
        `${operation}: ${(error as Error)?.message ?? 'falha de rede'}`,
      );
    }
    const { data, error, response } = result;
    if (response.ok && data !== undefined) return data;
    if (response.status >= 500 || response.status === 429) {
      throw new PlatformError(
        response.status,
        PLATFORM_UNAVAILABLE,
        `${operation}: HTTP ${response.status}`,
      );
    }
    const body = (error ?? {}) as { error?: { code?: string; message?: string } };
    throw new PlatformError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      `${operation}: ${body.error?.message ?? `HTTP ${response.status}`}`,
    );
  }
}
