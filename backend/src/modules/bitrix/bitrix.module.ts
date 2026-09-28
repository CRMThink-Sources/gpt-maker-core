import { Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { RedisRateLimiter } from '../../shared/redis/rate-limiter';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient } from './bitrix.client';
import { PlatformTokenProvider } from './platform-token.provider';

@Module({
  providers: [
    PlatformTokenProvider,
    {
      provide: BitrixClient,
      inject: [ENV, REDIS, PlatformTokenProvider],
      useFactory: (env: Env, redis: Redis, tokens: PlatformTokenProvider) =>
        new BitrixClient(tokens, {
          timeoutMs: env.BITRIX_TIMEOUT_MS,
          maxAttempts: 3,
          // Limite por portal, compartilhado entre api e worker.
          acquire: (installationId) =>
            new RedisRateLimiter(redis, {
              name: `bitrix:${installationId}`,
              perSecond: env.BITRIX_RATE_LIMIT_PER_SECOND,
              maxWaitMs: 10_000,
            }).acquire(),
        }),
    },
  ],
  exports: [BitrixClient, PlatformTokenProvider],
})
export class BitrixModule {}
