import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, lt } from 'drizzle-orm';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { agentFunctionConfig } from '../../shared/database/schema/index';
import { QUEUES } from '../../shared/messaging/topology';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import type { FunctionPublicationMessage } from './agent-function.service';
import { FunctionPublisher } from './function-publisher';

/** Pendente há mais que isso sem andar: a mensagem se perdeu ou o worker caiu no meio. */
const STALE_MS = 3 * 60_000;

/**
 * Worker das publicações da função: uma mensagem por pedido e, a cada minuto, a varredura das
 * pendentes paradas (o estado fica no banco; a mensagem é só o aviso).
 */
@Injectable()
export class FunctionPublicationConsumer {
  private readonly logger = new Logger(FunctionPublicationConsumer.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly publisher: FunctionPublisher,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @RabbitSubscribe({ queue: QUEUES.functionPublication, createQueueIfNotExists: false })
  async onMessage(message: FunctionPublicationMessage | undefined): Promise<Nack | void> {
    if (!message?.agentId) return new Nack(false);
    const context = { traceId: newTraceId(), tenantId: message.tenantId, agentId: message.agentId };
    await runWithContext(context, async () => {
      // Falha fica gravada na configuração (`FAILED`); a mensagem não volta para a fila.
      await this.publisher.run(message.agentId);
    });
  }

  @Cron('* * * * *', { name: 'function-publication-sweep' })
  async sweep(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        await this.lock.runExclusive('job:function-publication-sweep', 55_000, async () => {
          const stale = await this.db
            .select({ agentId: agentFunctionConfig.agentId })
            .from(agentFunctionConfig)
            .where(
              and(
                eq(agentFunctionConfig.publicationStatus, 'PENDING'),
                lt(agentFunctionConfig.updatedAt, new Date(Date.now() - STALE_MS)),
              ),
            );
          for (const row of stale) await this.publisher.run(row.agentId);
          if (stale.length) this.logger.log({ count: stale.length }, 'publicações retomadas');
        });
      } catch (error) {
        this.logger.error({ err: error }, 'varredura das publicações da função falhou');
      }
    });
  }
}
