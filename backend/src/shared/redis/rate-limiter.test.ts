import type Redis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { RateLimitExceededError, RedisRateLimiter } from './rate-limiter';

/** Redis falso: conta INCR por chave. */
function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    counts,
    eval: async (_script: string, _n: number, key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}

function clock(start: number) {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe('RedisRateLimiter', () => {
  it('libera até o limite na mesma janela', async () => {
    const redis = fakeRedis();
    const c = clock(10_000);
    const limiter = new RedisRateLimiter(
      redis as unknown as Redis,
      { name: 'x', perSecond: 2, maxWaitMs: 5000 },
      c.now,
      c.sleep,
    );
    await limiter.acquire();
    await limiter.acquire();
    expect(c.now()).toBe(10_000);
  });

  it('espera a próxima janela quando excede', async () => {
    const redis = fakeRedis();
    const c = clock(10_200);
    const limiter = new RedisRateLimiter(
      redis as unknown as Redis,
      { name: 'x', perSecond: 1, maxWaitMs: 5000 },
      c.now,
      c.sleep,
    );
    await limiter.acquire();
    await limiter.acquire();
    expect(c.now()).toBeGreaterThanOrEqual(11_000);
    expect(redis.counts.get('ratelimit:x:11')).toBe(1);
  });

  it('desiste depois do tempo máximo', async () => {
    const redis = fakeRedis();
    const c = clock(10_900);
    const limiter = new RedisRateLimiter(
      redis as unknown as Redis,
      { name: 'x', perSecond: 1, maxWaitMs: 50 },
      c.now,
      c.sleep,
    );
    await limiter.acquire();
    await expect(limiter.acquire()).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('libera a chamada se o Redis falhar', async () => {
    const redis = {
      eval: async () => {
        throw new Error('down');
      },
    };
    const limiter = new RedisRateLimiter(redis as unknown as Redis, {
      name: 'x',
      perSecond: 1,
      maxWaitMs: 50,
    });
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });
});
