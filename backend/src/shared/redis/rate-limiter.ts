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
  perSecond: number;
  /** Tempo máximo esperando vaga antes de desistir. */
  maxWaitMs: number;
}

/**
 * Rate limiter distribuído por janela fixa de 1 segundo no Redis, compartilhado entre todos os
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
      const window = Math.floor(now / 1000);
      let count: number;
      try {
        count = Number(
          await this.redis.eval(
            INCREMENT_WINDOW,
            1,
            `ratelimit:${this.options.name}:${window}`,
            2000,
          ),
        );
      } catch (error) {
        this.logger.warn(
          `rate limiter ${this.options.name} indisponível: ${(error as Error).message}`,
        );
        return;
      }
      if (count <= this.options.perSecond) return;

      const nextWindow = (window + 1) * 1000;
      if (nextWindow > deadline) throw new RateLimitExceededError(this.options.name);
      // Jitter para os processos não disputarem a próxima janela no mesmo milissegundo.
      await this.sleep(nextWindow - now + Math.floor(Math.random() * 50));
    }
  }
}
