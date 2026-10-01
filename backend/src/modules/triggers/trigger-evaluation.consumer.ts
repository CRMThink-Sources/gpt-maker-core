import { setTimeout as sleep } from 'node:timers/promises';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { QUEUES } from '../../shared/messaging/topology';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import type { AgentEventMessage } from './agent-event.intake';
import { TriggerRunner } from './trigger-runner';

/** Pausa antes de devolver à fila um evento que falhou (banco fora), para não girar em falso. */
const REQUEUE_PAUSE_MS = 2_000;

/**
 * Worker dos gatilhos: avalia cada evento de `triggers.evaluation` (cria e roda as execuções) e,
 * a cada minuto, roda as retentativas vencidas. A fila é declarada na topologia.
 */
@Injectable()
export class TriggerEvaluationConsumer {
  private readonly logger = new Logger(TriggerEvaluationConsumer.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly runner: TriggerRunner,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @RabbitSubscribe({ queue: QUEUES.triggerEvaluation, createQueueIfNotExists: false })
  async onMessage(message: AgentEventMessage | undefined): Promise<Nack | void> {
    if (!message?.agentEventId) return new Nack(false);
    const context = {
      traceId: newTraceId(),
      tenantId: message.tenantId,
      agentId: message.agentId,
      ...(message.dialogId ? { dialogId: message.dialogId } : {}),
    };
    return runWithContext(context, async () => {
      try {
        await this.runner.evaluate(message.agentEventId);
      } catch (error) {
        // As execuções ainda não existem: o evento precisa voltar, senão os gatilhos se perdem.
        this.logger.error(
          { agentEventId: message.agentEventId, err: error },
          'avaliação dos gatilhos falhou',
        );
        await sleep(REQUEUE_PAUSE_MS);
        return new Nack(true);
      }
    });
  }

  @Cron('* * * * *', { name: 'trigger-retries' })
  async runDue(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive('job:trigger-retries', 55_000, () =>
          this.runner.runDue(),
        );
        if (outcome.ran && outcome.result) {
          this.logger.log({ count: outcome.result }, 'retentativas de gatilhos executadas');
        }
      } catch (error) {
        this.logger.error({ err: error }, 'varredura de retentativas dos gatilhos falhou');
      }
    });
  }
}
