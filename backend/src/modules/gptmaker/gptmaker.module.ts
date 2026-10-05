import { Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { RedisRateLimiter } from '../../shared/redis/rate-limiter';
import { REDIS } from '../../shared/redis/redis.module';
import { GptMakerClient } from './gptmaker.client';
import { GptMakerError } from './gptmaker.errors';
import { GptMakerResilience } from './gptmaker.resilience';
import { TenantAgentLimitService } from './tenant-agent-limit.service';
import { WorkspaceHealthService } from './workspace-health.service';
import { WorkspaceStatusStore } from './workspace-status.store';
import { WorkspaceSyncService } from './workspace-sync.service';

@Module({
  providers: [
    {
      provide: GptMakerClient,
      inject: [ENV, REDIS],
      useFactory: (env: Env, redis: Redis) => {
        const limiter = new RedisRateLimiter(redis, {
          name: 'gptmaker',
          perSecond: env.GPTMAKER_RATE_LIMIT_PER_SECOND,
          maxWaitMs: 10_000,
        });
        const resilience = new GptMakerResilience({
          maxAttempts: 3,
          breakerThreshold: 5,
          halfOpenAfterMs: 30_000,
          beforeAttempt: async () => {
            try {
              await limiter.acquire();
            } catch {
              throw new GptMakerError(
                'RATE_LIMITED',
                'rate-limiter',
                'limite local de requisições',
              );
            }
          },
        });
        return new GptMakerClient(
          {
            baseUrl: env.GPTMAKER_API_URL,
            token: env.GPTMAKER_API_TOKEN,
            workspaceId: env.GPTMAKER_WORKSPACE_ID,
            timeoutMs: env.GPTMAKER_TIMEOUT_MS,
            conversationTimeoutMs: env.GPTMAKER_CONVERSATION_TIMEOUT_MS,
          },
          resilience,
        );
      },
    },
    TenantAgentLimitService,
    WorkspaceStatusStore,
    WorkspaceHealthService,
    WorkspaceSyncService,
  ],
  exports: [
    GptMakerClient,
    TenantAgentLimitService,
    WorkspaceHealthService,
    WorkspaceStatusStore,
    WorkspaceSyncService,
  ],
})
export class GptMakerModule {}
