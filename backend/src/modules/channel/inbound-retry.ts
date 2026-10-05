import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CHANNEL_HEADERS, channelRetryName, EXCHANGES } from '../../shared/messaging/topology';
import { dialogKey, type InboundMessage } from './inbound-message';

export type RetryOutcome =
  { kind: 'retry'; attempt: number; delayMs: number } | { kind: 'dead-letter'; attempts: number };

/** Tentativas já feitas, lidas do cabeçalho da entrega (ausente ⇒ primeira). */
export function attemptOf(headers: Record<string, unknown> | undefined): number {
  const value = Number(headers?.[CHANNEL_HEADERS.attempt] ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * Retentativa das mensagens do chatbot (design D5): falha transitória (GPTMaker ou Bitrix fora
 * do ar) vai para a fila de espera da próxima tentativa (10 s, 1 min, 5 min por padrão) e volta
 * à partição do diálogo; esgotadas, vai para a DLQ e quem chamou transfere para um humano, sem
 * débito (tarefa 9.9). Na espera, mensagens seguintes do mesmo diálogo podem passar à frente.
 */
@Injectable()
export class InboundRetry {
  private readonly logger = new Logger(InboundRetry.name);

  constructor(
    private readonly amqp: AmqpConnection,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** `attempt`: tentativas já feitas antes desta falha (`attemptOf` da entrega). */
  async retryOrDeadLetter(
    message: InboundMessage,
    attempt: number,
    error: unknown,
  ): Promise<RetryOutcome> {
    const delays = this.env.CHANNEL_RETRY_DELAYS_MS;
    const reason = error instanceof Error ? error.message : String(error);
    const headers = {
      [CHANNEL_HEADERS.attempt]: attempt + 1,
      [CHANNEL_HEADERS.lastError]: reason.slice(0, 500),
    };
    const options = { persistent: true, headers, messageId: messageIdOf(message) };

    if (attempt < delays.length) {
      const delayMs = delays[attempt]!;
      await this.amqp.publish(channelRetryName(delayMs), dialogKey(message), message, options);
      this.logger.warn(
        { messageId: options.messageId, attempt: attempt + 1, delayMs, reason },
        'mensagem do chatbot reagendada',
      );
      return { kind: 'retry', attempt: attempt + 1, delayMs };
    }
    return this.deadLetter(
      message,
      attempt,
      error,
      'mensagem do chatbot esgotou as tentativas (DLQ)',
    );
  }

  /** Direto para a DLQ: erro que não melhora com nova tentativa (ex.: GPTMaker recusou o corpo). */
  async deadLetter(
    message: InboundMessage,
    attempt: number,
    error: unknown,
    logMessage = 'mensagem do chatbot com erro permanente (DLQ)',
  ): Promise<RetryOutcome> {
    const reason = error instanceof Error ? error.message : String(error);
    const options = {
      persistent: true,
      messageId: messageIdOf(message),
      headers: {
        [CHANNEL_HEADERS.attempt]: attempt + 1,
        [CHANNEL_HEADERS.lastError]: reason.slice(0, 500),
      },
    };
    await this.amqp.publish(EXCHANGES.channelDeadLetter, dialogKey(message), message, options);
    this.logger.error(
      { alert: true, messageId: options.messageId, attempts: attempt + 1, reason },
      logMessage,
    );
    return { kind: 'dead-letter', attempts: attempt + 1 };
  }
}

export function messageIdOf(
  message: Pick<InboundMessage, 'tenantId' | 'botId' | 'messageId'>,
): string {
  return `${message.tenantId}:${message.botId}:${message.messageId}`;
}
