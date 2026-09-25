import {
  CircuitBreakerPolicy,
  CircuitState,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleWhen,
  isBrokenCircuitError,
  isTaskCancelledError,
  retry,
  timeout,
  TimeoutStrategy,
} from 'cockatiel';
import { Counter, Gauge, Histogram } from 'prom-client';
import { metricsRegistry } from '../../shared/metrics/metrics';
import { GptMakerError } from './gptmaker.errors';

export interface CallOptions {
  /** Nome estável da operação (métricas e logs), ex.: `agent.create`. */
  operation: string;
  /**
   * Operações idempotentes (GET, PUT, DELETE) são retentadas em falha transitória.
   * Não idempotentes (criar agente, enviar mensagem) só em 429 ou quando a conexão nem abriu,
   * para não duplicar agente nem resposta ao cliente final.
   */
  idempotent: boolean;
  timeoutMs: number;
}

export interface ResilienceOptions {
  maxAttempts: number;
  breakerThreshold: number;
  halfOpenAfterMs: number;
  /** Chamado antes de cada tentativa (rate limiter global). */
  beforeAttempt: () => Promise<void>;
}

const duration = new Histogram({
  name: 'gptmaker_request_duration_seconds',
  help: 'Duração das chamadas ao GPTMaker por operação e resultado',
  labelNames: ['operation', 'outcome'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

const retries = new Counter({
  name: 'gptmaker_request_retries_total',
  help: 'Retentativas de chamadas ao GPTMaker',
  labelNames: ['operation'],
  registers: [metricsRegistry],
});

const circuitGauge = new Gauge({
  name: 'gptmaker_circuit_open',
  help: '1 quando o circuit breaker do GPTMaker está aberto',
  registers: [metricsRegistry],
});

// Conexão recusada ou DNS: a requisição não chegou ao GPTMaker; seguro retentar até POST.
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

export function connectionNotEstablished(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code !== undefined && NOT_SENT_CODES.has(cause.code);
}

/**
 * Política de chamada ao GPTMaker (design D4): rate limit global → retry com backoff
 * exponencial → circuit breaker → timeout por tentativa. Erros saem sempre como `GptMakerError`.
 */
export class GptMakerResilience {
  readonly breaker: CircuitBreakerPolicy;

  constructor(private readonly options: ResilienceOptions) {
    // Só falhas do provedor abrem o circuito; 4xx são erro nosso ou do dado, não indisponibilidade.
    this.breaker = circuitBreaker(
      handleWhen((error) => error instanceof GptMakerError && error.isTransient),
      {
        halfOpenAfter: options.halfOpenAfterMs,
        breaker: new ConsecutiveBreaker(options.breakerThreshold),
      },
    );
    this.breaker.onStateChange((state) => circuitGauge.set(state === CircuitState.Open ? 1 : 0));
  }

  get circuitOpen(): boolean {
    return this.breaker.state === CircuitState.Open;
  }

  async execute<T>(call: CallOptions, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const retryPolicy = retry(
      handleWhen((error) => shouldRetry(error, call.idempotent)),
      {
        maxAttempts: this.options.maxAttempts - 1,
        backoff: new ExponentialBackoff({ initialDelay: 250, maxDelay: 5000 }),
      },
    );
    retryPolicy.onRetry(() => retries.inc({ operation: call.operation }));
    const timeoutPolicy = timeout(call.timeoutMs, TimeoutStrategy.Aggressive);

    const end = duration.startTimer({ operation: call.operation });
    try {
      const result = await retryPolicy.execute(() =>
        this.breaker.execute(async () => {
          await this.options.beforeAttempt();
          try {
            return await timeoutPolicy.execute(async ({ signal }) => {
              try {
                return await fn(signal);
              } catch (error) {
                // O fetch abortado pode rejeitar antes do cockatiel sinalizar o timeout.
                if (signal.aborted) {
                  throw new GptMakerError(
                    'UNAVAILABLE',
                    call.operation,
                    'tempo de resposta esgotado',
                  );
                }
                throw error;
              }
            });
          } catch (error) {
            throw normalize(error, call.operation);
          }
        }),
      );
      end({ outcome: 'ok' });
      return result;
    } catch (error) {
      const normalized = normalize(error, call.operation);
      end({ outcome: normalized.kind });
      throw normalized;
    }
  }
}

function shouldRetry(error: unknown, idempotent: boolean): boolean {
  if (!(error instanceof GptMakerError)) return false;
  if (error.kind === 'RATE_LIMITED') return true;
  if (error.kind !== 'UNAVAILABLE') return false;
  if (error.circuitOpen) return false;
  return idempotent || connectionNotEstablished(error.body);
}

function normalize(error: unknown, operation: string): GptMakerError {
  if (error instanceof GptMakerError) return error;
  if (isBrokenCircuitError(error)) {
    return new GptMakerError('UNAVAILABLE', operation, 'circuito aberto após falhas seguidas', {
      circuitOpen: true,
    });
  }
  if (isTaskCancelledError(error)) {
    return new GptMakerError('UNAVAILABLE', operation, 'tempo de resposta esgotado');
  }
  // fetch lança TypeError em falha de rede; a causa (ECONNREFUSED etc.) segue em `body`.
  return new GptMakerError(
    'UNAVAILABLE',
    operation,
    `falha de rede: ${(error as Error)?.message ?? String(error)}`,
    { body: error },
  );
}
