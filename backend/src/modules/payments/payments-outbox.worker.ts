import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { AgentItemMirror } from './agent-item.mirror';
import { OUTBOX_OPERATIONS, type OutboxHandler, PaymentsOutbox } from './payments-outbox';

/** Job do worker que aplica o `payments_outbox` a cada minuto, em uma instância por vez. */
@Injectable()
export class PaymentsOutboxWorker {
  private readonly logger = new Logger(PaymentsOutboxWorker.name);
  private readonly lock: DistributedLock;
  private readonly handlers: Record<string, OutboxHandler>;

  constructor(
    private readonly outbox: PaymentsOutbox,
    mirror: AgentItemMirror,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
    this.handlers = { [OUTBOX_OPERATIONS.agentItemSync]: (row) => mirror.sync(row) };
  }

  @Cron('* * * * *', { name: 'payments-outbox' })
  async run(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        await this.lock.runExclusive('job:payments-outbox', 55_000, async () => {
          const count = await this.outbox.processDue(this.handlers);
          if (count) this.logger.log({ count }, 'outbox de pagamentos aplicado');
        });
      } catch (error) {
        this.logger.error({ err: error }, 'job do outbox de pagamentos falhou');
      }
    });
  }
}
