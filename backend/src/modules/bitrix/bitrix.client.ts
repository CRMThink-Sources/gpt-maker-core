import { Logger } from '@nestjs/common';
import { ExponentialBackoff, handleWhen, retry } from 'cockatiel';
import { Counter, Histogram } from 'prom-client';
import { metricsRegistry } from '../../shared/metrics/metrics';
import { RateLimitExceededError } from '../../shared/redis/rate-limiter';
import { BitrixError } from './bitrix.errors';
import type { PlatformTokenProvider, PortalToken } from './platform-token.provider';

export type BitrixParams = Record<string, unknown>;

export interface BitrixResponse<T> {
  result: T;
  total?: number;
  next?: number;
}

export interface BatchCommand {
  method: string;
  params?: BitrixParams;
}

export interface BatchResult {
  results: Record<string, unknown>;
  errors: Record<string, { error: string; error_description?: string }>;
}

export interface BitrixClientOptions {
  timeoutMs: number;
  /** Tentativas quando o Bitrix recusa por limite (`QUERY_LIMIT_EXCEEDED`) ou a conexão nem abriu. */
  maxAttempts: number;
  /** Rate limiter por portal (design D13); lança `RateLimitExceededError` se não houver vaga. */
  acquire: (installationId: number) => Promise<void>;
}

/** Máximo de comandos por chamada `batch` do Bitrix. */
export const BATCH_LIMIT = 50;

const duration = new Histogram({
  name: 'bitrix_request_duration_seconds',
  help: 'Duração das chamadas à API REST do Bitrix24 por método e resultado',
  labelNames: ['method', 'outcome'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
});

const tokenRefreshes = new Counter({
  name: 'bitrix_token_refresh_total',
  help: 'Renovações de token pedidas à plataforma após expired_token',
  registers: [metricsRegistry],
});

const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

type RawBody = {
  result?: unknown;
  total?: number;
  next?: number;
  error?: string;
  error_description?: string;
};

/**
 * Cliente REST do Bitrix24 por instalação, com o token da plataforma (design D13): rate limiter
 * por portal, `expired_token` ⇒ renovação na plataforma e uma única repetição da chamada, e
 * `batch` em blocos de 50. Chamadas não são retentadas depois de enviadas (métodos `add` não são
 * idempotentes); só limite do portal e conexão recusada voltam a tentar.
 */
export class BitrixClient {
  private readonly logger = new Logger(BitrixClient.name);

  constructor(
    private readonly tokens: Pick<PlatformTokenProvider, 'get' | 'refresh'>,
    private readonly options: BitrixClientOptions,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async call<T = unknown>(
    installationId: number,
    method: string,
    params: BitrixParams = {},
  ): Promise<BitrixResponse<T>> {
    const end = duration.startTimer({ method });
    try {
      const response = await this.withRetry(() => this.callOnce<T>(installationId, method, params));
      end({ outcome: 'ok' });
      return response;
    } catch (error) {
      end({ outcome: error instanceof BitrixError ? error.kind : 'error' });
      throw error;
    }
  }

  /** Executa os comandos em `batch` (blocos de 50, `halt = 0`); erros vêm por comando. */
  async batch(
    installationId: number,
    commands: Record<string, BatchCommand>,
  ): Promise<BatchResult> {
    const entries = Object.entries(commands);
    const merged: BatchResult = { results: {}, errors: {} };
    for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
      const cmd = Object.fromEntries(
        entries.slice(i, i + BATCH_LIMIT).map(([name, command]) => [name, batchCommand(command)]),
      );
      const { result } = await this.call<{
        result?: Record<string, unknown> | unknown[];
        result_error?: Record<string, { error: string; error_description?: string }> | unknown[];
      }>(installationId, 'batch', { halt: 0, cmd });
      // O Bitrix devolve `[]` (não `{}`) quando não há itens.
      Object.assign(merged.results, asRecord(result.result));
      Object.assign(merged.errors, asRecord(result.result_error));
    }
    return merged;
  }

  private async callOnce<T>(
    installationId: number,
    method: string,
    params: BitrixParams,
  ): Promise<BitrixResponse<T>> {
    const token = await this.tokens.get(installationId);
    try {
      return await this.send<T>(installationId, token, method, params);
    } catch (error) {
      if (!(error instanceof BitrixError) || error.code !== 'expired_token') throw error;
      tokenRefreshes.inc();
      const renewed = await this.tokens.refresh(installationId, token.accessToken);
      return this.send<T>(installationId, renewed, method, params);
    }
  }

  private async send<T>(
    installationId: number,
    token: PortalToken,
    method: string,
    params: BitrixParams,
  ): Promise<BitrixResponse<T>> {
    try {
      await this.options.acquire(installationId);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new BitrixError(
          'RATE_LIMITED',
          method,
          'LOCAL_RATE_LIMIT',
          'limite local por portal',
        );
      }
      throw error;
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${token.endpoint.replace(/\/?$/, '/')}${method}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, auth: token.accessToken }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      throw new BitrixError(
        'UNAVAILABLE',
        method,
        code && NOT_SENT_CODES.has(code) ? 'NOT_SENT' : 'NETWORK_ERROR',
        (error as Error).message,
      );
    }

    const body = (await response.json().catch(() => ({}))) as RawBody;
    if (body.error) {
      const kind =
        body.error === 'QUERY_LIMIT_EXCEEDED'
          ? 'RATE_LIMITED'
          : response.status >= 500
            ? 'UNAVAILABLE'
            : 'API_ERROR';
      throw new BitrixError(
        kind,
        method,
        body.error,
        body.error_description ?? '',
        response.status,
      );
    }
    if (!response.ok) {
      throw new BitrixError(
        response.status >= 500 ? 'UNAVAILABLE' : 'API_ERROR',
        method,
        `HTTP_${response.status}`,
        '',
        response.status,
      );
    }
    return { result: body.result as T, total: body.total, next: body.next };
  }

  private withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const policy = retry(
      handleWhen(
        (error) =>
          error instanceof BitrixError &&
          // Limite local já esperou vaga no rate limiter; só o limite do portal é retentado.
          ((error.kind === 'RATE_LIMITED' && error.code !== 'LOCAL_RATE_LIMIT') ||
            error.code === 'NOT_SENT'),
      ),
      {
        maxAttempts: this.options.maxAttempts - 1,
        backoff: new ExponentialBackoff({ initialDelay: 500, maxDelay: 5000 }),
      },
    );
    policy.onRetry((event) =>
      this.logger.debug(
        { reason: 'error' in event ? (event.error as Error).message : undefined },
        'retentando chamada ao Bitrix',
      ),
    );
    return policy.execute(fn);
  }
}

/** Comando do `batch` no formato do Bitrix: `method?query` com parâmetros no estilo PHP. */
export function batchCommand(command: BatchCommand): string {
  const query = toQueryString(command.params ?? {});
  return query ? `${command.method}?${query}` : command.method;
}

/** `http_build_query` do PHP: objetos e listas viram `a[b]=1&a[c][0]=2`; booleanos, `1`/`0`. */
export function toQueryString(params: BitrixParams): string {
  const pairs: string[] = [];
  const walk = (prefix: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${prefix}[${index}]`, item));
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      for (const [key, item] of Object.entries(value)) walk(`${prefix}[${key}]`, item);
    } else {
      const text =
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'boolean'
            ? value
              ? '1'
              : '0'
            : String(value);
      pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(text)}`);
    }
  };
  for (const [key, value] of Object.entries(params)) walk(key, value);
  return pairs.join('&');
}

function asRecord<T>(value: Record<string, T> | unknown[] | undefined): Record<string, T> {
  return value && !Array.isArray(value) ? value : {};
}
