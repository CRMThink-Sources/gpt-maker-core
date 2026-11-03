import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

// INCR + PEXPIRE atômicos: a primeira chamada da janela define a expiração.
const INCREMENT_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

export class RateLimitExceededError extends Error {
  constructor(readonly limiter: string) {
    super(`Limite de requisições de ${limiter} excedido`);
  }
}

export interface RateLimiterOptions {
  /** Nome da chave no Redis (ex.: `gptmaker`, `bitrix:<memberId>`). */
  name: string;
  /** Máximo de chamadas por janela (1 s, a menos que `windowMs` diga outra). */
  perSecond: number;
  /** Tamanho da janela fixa; padrão 1 s. Janelas longas servem a limites por minuto ou por hora. */
  windowMs?: number;
  /** Tempo máximo esperando vaga antes de desistir. */
  maxWaitMs: number;
}

/**
 * Rate limiter distribuído por janela fixa (1 segundo, por padrão) no Redis, compartilhado entre todos os
 * processos (api e worker). Se o Redis cair, libera a chamada (fail open) e registra aviso:
 * o provedor ainda devolve 429, que a política de retry trata.
 */
export class RedisRateLimiter {
  private readonly logger = new Logger(RedisRateLimiter.name);

  constructor(
    private readonly redis: Redis,
    private readonly options: RateLimiterOptions,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async acquire(): Promise<void> {
    const deadline = this.now() + this.options.maxWaitMs;
    for (;;) {
      const now = this.now();
      const windowMs = this.options.windowMs ?? 1000;
      const window = Math.floor(now / windowMs);
      let count: number;
      try {
        count = Number(
          await this.redis.eval(
            INCREMENT_WINDOW,
            1,
            `ratelimit:${this.options.name}:${window}`,
            windowMs * 2,
          ),
        );
      } catch (error) {
        this.logger.warn(
          `rate limiter ${this.options.name} indisponível: ${(error as Error).message}`,
        );
        return;
      }
      if (count <= this.options.perSecond) return;

      const nextWindow = (window + 1) * windowMs;
      if (nextWindow > deadline) throw new RateLimitExceededError(this.options.name);
      // Jitter para os processos não disputarem a próxima janela no mesmo milissegundo.
      await this.sleep(nextWindow - now + Math.floor(Math.random() * 50));
    }
  }
}
