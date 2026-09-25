import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

// Libera só se o lock ainda for nosso (não apaga lock expirado e readquirido por outro processo).
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

/** Lock distribuído simples (SET NX PX). Usado para jobs agendados rodarem em um processo só. */
export class DistributedLock {
  constructor(private readonly redis: Redis) {}

  /**
   * Executa `fn` se conseguir o lock; senão devolve `{ ran: false }` sem esperar.
   * `ttlMs` deve cobrir a duração máxima esperada de `fn`.
   */
  async runExclusive<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    const token = randomUUID();
    const acquired = await this.redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') return { ran: false };
    try {
      return { ran: true, result: await fn() };
    } finally {
      await this.redis.eval(RELEASE, 1, `lock:${key}`, token);
    }
  }
}
