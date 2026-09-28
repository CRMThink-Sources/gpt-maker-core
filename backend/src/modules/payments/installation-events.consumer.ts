import { Inject, Injectable, Logger } from '@nestjs/common';
import { AmqpConnection, Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { InstallationEventsService } from '../tenancy';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { EXCHANGES, QUEUES } from '../../shared/messaging/topology';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { MAX_EVENT_ATTEMPTS, PlatformEventStore } from './platform-event.store';

/** Evento publicado há menos que isso ainda pode estar na fila; a varredura não o republica. */
const SWEEP_GRACE_MS = 60_000;

/**
 * Worker dos eventos `installation.*` (design D3): aplica o efeito com a linha de
 * `payment_event` travada e marca `PROCESSED`; falha ⇒ `FAILED` com tentativas, e a varredura
 * a cada minuto republica pendentes e falhos (até `MAX_EVENT_ATTEMPTS`).
 */
@Injectable()
export class InstallationEventsConsumer {
  private readonly logger = new Logger(InstallationEventsConsumer.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly store: PlatformEventStore,
    private readonly installationEvents: InstallationEventsService,
    private readonly amqp: AmqpConnection,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @RabbitSubscribe({
    exchange: EXCHANGES.paymentsEvents,
    routingKey: 'installation.#',
    queue: QUEUES.installationEvents,
    queueOptions: { durable: true },
  })
  async onMessage(message: { eventId?: string }): Promise<Nack | void> {
    if (!message?.eventId) return new Nack(false);
    const eventId = message.eventId;
    await runWithContext({ traceId: newTraceId() }, () => this.processEvent(eventId));
  }

  async processEvent(eventId: string): Promise<void> {
    try {
      await this.store.process(eventId, (event) => this.installationEvents.handle(event));
    } catch (error) {
      const attempts = await this.store.markFailed(eventId, error);
      this.logger.error(
        { eventId, attempts, alert: attempts >= MAX_EVENT_ATTEMPTS, err: error },
        'evento de instalação falhou',
      );
    }
  }

  @Cron('* * * * *', { name: 'installation-events-sweep' })
  async sweep(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        await this.lock.runExclusive('job:installation-events-sweep', 55_000, async () => {
          const pending = await this.store.pending(
            'installation.',
            new Date(Date.now() - SWEEP_GRACE_MS),
          );
          for (const { eventId, type } of pending) {
            await this.amqp.publish(
              EXCHANGES.paymentsEvents,
              type,
              { eventId },
              { persistent: true },
            );
          }
          if (pending.length) this.logger.log({ count: pending.length }, 'eventos republicados');
        });
      } catch (error) {
        this.logger.error({ err: error }, 'varredura de eventos de instalação falhou');
      }
    });
  }
}
