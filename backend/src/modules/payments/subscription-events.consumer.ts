import { Inject, Injectable, Logger } from '@nestjs/common';
import { AmqpConnection, Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { EXCHANGES, QUEUES } from '../../shared/messaging/topology';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { MAX_EVENT_ATTEMPTS, PlatformEventStore } from './platform-event.store';
import {
  SUBSCRIPTION_EVENT_PREFIXES,
  SubscriptionEventsService,
} from './subscription-events.service';

/** Evento publicado há menos que isso ainda pode estar na fila; a varredura não o republica. */
const SWEEP_GRACE_MS = 60_000;

/**
 * Worker dos eventos `subscription.*` e `purchase.*` (12.3), no mesmo molde do de instalação:
 * aplica com a linha de `payment_event` travada e marca `PROCESSED`; falha ⇒ `FAILED` com
 * tentativas, e a varredura a cada minuto republica pendentes e falhos (até `MAX_EVENT_ATTEMPTS`).
 */
@Injectable()
export class SubscriptionEventsConsumer {
  private readonly logger = new Logger(SubscriptionEventsConsumer.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly store: PlatformEventStore,
    private readonly subscriptions: SubscriptionEventsService,
    private readonly amqp: AmqpConnection,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @RabbitSubscribe({
    exchange: EXCHANGES.paymentsEvents,
    routingKey: ['subscription.#', 'purchase.#'],
    queue: QUEUES.subscriptionEvents,
    queueOptions: { durable: true },
  })
  async onMessage(message: { eventId?: string }): Promise<Nack | void> {
    if (!message?.eventId) return new Nack(false);
    const eventId = message.eventId;
    await runWithContext({ traceId: newTraceId() }, () => this.processEvent(eventId));
  }

  async processEvent(eventId: string): Promise<void> {
    try {
      await this.store.process(eventId, async (event) => {
        await this.subscriptions.handle(event);
      });
    } catch (error) {
      const attempts = await this.store.markFailed(eventId, error);
      this.logger.error(
        { eventId, attempts, alert: attempts >= MAX_EVENT_ATTEMPTS, err: error },
        'evento de assinatura falhou',
      );
    }
  }

  @Cron('* * * * *', { name: 'subscription-events-sweep' })
  async sweep(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        await this.lock.runExclusive('job:subscription-events-sweep', 55_000, async () => {
          const before = new Date(Date.now() - SWEEP_GRACE_MS);
          let count = 0;
          for (const prefix of SUBSCRIPTION_EVENT_PREFIXES) {
            for (const { eventId, type } of await this.store.pending(prefix, before)) {
              await this.amqp.publish(
                EXCHANGES.paymentsEvents,
                type,
                { eventId },
                { persistent: true },
              );
              count++;
            }
          }
          if (count) this.logger.log({ count }, 'eventos de assinatura republicados');
        });
      } catch (error) {
        this.logger.error({ err: error }, 'varredura de eventos de assinatura falhou');
      }
    });
  }
}
