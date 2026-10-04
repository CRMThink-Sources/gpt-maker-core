import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import type { DeadLetterQueueKey } from '@gptmaker/contracts';
import { CHANNEL_HEADERS, QUEUES } from '../../shared/messaging/topology';

/** O que se usa do canal do amqplib (o pacote não traz tipos). */
interface Channel {
  checkQueue(queue: string): Promise<{ messageCount: number }>;
  get(
    queue: string,
    options: { noAck: boolean },
  ): Promise<false | { content: Buffer; properties: { headers?: Record<string, unknown> } }>;
  nackAll(requeue: boolean): void;
  purgeQueue(queue: string): Promise<{ messageCount: number }>;
  close(): Promise<void>;
}

export const DEAD_LETTER_QUEUES: Record<DeadLetterQueueKey, string> = {
  inbound: QUEUES.channelDeadLetter,
  transfer: QUEUES.channelTransferDeadLetter,
};

/** Metadados de uma mensagem da DLQ; o corpo (texto do cliente) não sai daqui. */
export interface DeadLetterMeta {
  tenantId: string | null;
  agentId: string | null;
  dialogId: string | null;
  reference: string | null;
  attempts: number | null;
  lastError: string | null;
  receivedAt: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

export function metaOf(
  body: unknown,
  headers: Record<string, unknown> | undefined,
): DeadLetterMeta {
  const message = (body ?? {}) as Record<string, unknown>;
  const attempts = Number(headers?.[CHANNEL_HEADERS.attempt]);
  // Nack da transferência: o RabbitMQ guarda o histórico em `x-death`.
  const deaths = headers?.['x-death'] as Array<{ count?: number }> | undefined;
  return {
    tenantId: text(message.tenantId),
    agentId: text(message.agentId),
    dialogId: text(message.dialogId),
    reference: text(message.messageId) ?? text(message.agentEventId),
    attempts: Number.isInteger(attempts) && attempts > 0 ? attempts : (deaths?.[0]?.count ?? null),
    lastError: text(headers?.[CHANNEL_HEADERS.lastError]),
    receivedAt: text(message.receivedAt),
  };
}

/**
 * Leitura das DLQs do canal para o backoffice (tarefa 15.7): tamanho, as primeiras mensagens sem
 * consumi-las (`get` sem ack e devolução) e descarte. As filas não têm consumidor (inspeção
 * manual): na DLQ de entrada o diálogo já foi para um operador, e a mensagem fica em
 * `message_log` como `FAILED`. Canal próprio por operação, fechado ao fim.
 */
@Injectable()
export class DeadLetterInspector {
  private readonly logger = new Logger(DeadLetterInspector.name);

  constructor(private readonly amqp: AmqpConnection) {}

  async size(key: DeadLetterQueueKey): Promise<number | null> {
    try {
      return await this.withChannel(
        async (channel) => (await channel.checkQueue(DEAD_LETTER_QUEUES[key])).messageCount,
      );
    } catch (error) {
      this.logger.warn({ err: error, queue: key }, 'tamanho da DLQ indisponível');
      return null;
    }
  }

  async peek(key: DeadLetterQueueKey, limit: number): Promise<DeadLetterMeta[]> {
    return this.withChannel(async (channel) => {
      const found: DeadLetterMeta[] = [];
      try {
        for (let i = 0; i < limit; i++) {
          const message = await channel.get(DEAD_LETTER_QUEUES[key], { noAck: false });
          if (!message) break;
          let body: unknown = null;
          try {
            body = JSON.parse(message.content.toString());
          } catch {
            // Corpo ilegível: só os cabeçalhos.
          }
          found.push(metaOf(body, message.properties.headers));
        }
      } finally {
        // Devolve todas à fila, na ordem em que estavam.
        channel.nackAll(true);
      }
      return found;
    });
  }

  /** Esvazia a fila; devolve quantas mensagens saíram. */
  async purge(key: DeadLetterQueueKey): Promise<number> {
    return this.withChannel(
      async (channel) => (await channel.purgeQueue(DEAD_LETTER_QUEUES[key])).messageCount,
    );
  }

  private async withChannel<T>(fn: (channel: Channel) => Promise<T>): Promise<T> {
    const connection = this.amqp.connection as { createChannel(): Promise<Channel> };
    const channel = await connection.createChannel();
    try {
      return await fn(channel);
    } finally {
      await channel.close().catch(() => undefined);
    }
  }
}
