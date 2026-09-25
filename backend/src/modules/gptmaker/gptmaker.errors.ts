export type GptMakerErrorKind =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

/** Erro de domínio do cliente GPTMaker; `kind` decide retry, circuit breaker e mensagem ao usuário. */
export class GptMakerError extends Error {
  readonly status?: number;
  /** Corpo da resposta de erro, ou o erro de rede original. */
  readonly body?: unknown;
  readonly retryAfterMs?: number;
  /** Circuit breaker aberto: a chamada nem foi feita. */
  readonly circuitOpen: boolean;

  constructor(
    readonly kind: GptMakerErrorKind,
    readonly operation: string,
    message: string,
    details: { status?: number; body?: unknown; retryAfterMs?: number; circuitOpen?: boolean } = {},
  ) {
    super(`GPTMaker ${operation}: ${message}`);
    this.name = 'GptMakerError';
    this.status = details.status;
    this.body = details.body;
    this.retryAfterMs = details.retryAfterMs;
    this.circuitOpen = details.circuitOpen ?? false;
  }

  /** Falha do lado do provedor ou da rede: conta para o circuit breaker. */
  get isTransient(): boolean {
    return this.kind === 'UNAVAILABLE';
  }
}

export function kindFromStatus(status: number): GptMakerErrorKind {
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400 || status === 409 || status === 422) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UNAVAILABLE';
  return 'UNKNOWN';
}

/** `Retry-After` em segundos ou data HTTP; limitado para não prender a fila. */
export function parseRetryAfter(value: string | null, maxMs = 30_000): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, maxMs) : undefined;
}
