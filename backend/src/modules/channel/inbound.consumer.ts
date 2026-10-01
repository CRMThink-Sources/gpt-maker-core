import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { messageLog } from '../../shared/database/schema/index';
import { AMQP_CHANNELS, channelInboundQueue } from '../../shared/messaging/topology';
import { BitrixError } from '../bitrix';
import { ConversationService, isPermanentConversationError } from './conversation.service';
import { type GateDecision, InboundGate } from './inbound-gate';
import type { InboundMessage } from './inbound-message';
import { attemptOf, InboundRetry } from './inbound-retry';
import { ReplyPublisher } from './reply-publisher';

/** Status do `message_log` das mensagens que o gate descarta. */
const SKIP_STATUS = {
  'skip-inactive': 'SKIPPED_INACTIVE',
  'skip-human': 'SKIPPED_HUMAN',
} as const;

/**
 * Erro que nova tentativa não resolve ⇒ DLQ direto: GPTMaker recusou (ver
 * `isPermanentConversationError`) ou o Bitrix recusou o envio (diálogo inválido, sem permissão,
 * app desinstalado ou sem credencial).
 */
export function isPermanentProcessingError(error: unknown): boolean {
  if (isPermanentConversationError(error)) return true;
  return (
    error instanceof BitrixError &&
    (error.kind === 'API_ERROR' || error.kind === 'UNINSTALLED' || error.kind === 'AUTH_ERROR')
  );
}

/**
 * Worker das mensagens dos chatbots (design D5): um consumidor por partição de
 * `channel.inbound`, uma mensagem por vez (mesmo diálogo em ordem). Passa pelo `InboundGate`;
 * descartadas ficam no `message_log`; liberadas vão ao GPTMaker (`ConversationService`) e a
 * resposta volta ao diálogo (`ReplyPublisher`). Falha transitória ⇒ retentativa escalonada e, no
 * fim, DLQ; erro permanente ⇒ DLQ direto.
 */
@Injectable()
export class InboundConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(InboundConsumer.name);

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly gate: InboundGate,
    private readonly retry: InboundRetry,
    private readonly conversation: ConversationService,
    private readonly replies: ReplyPublisher,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker') return;
    for (let index = 0; index < this.env.CHANNEL_INBOUND_PARTITIONS; index++) {
      const queue = channelInboundQueue(index);
      // Sem `await`: com o RabbitMQ fora, o consumidor entra quando a conexão subir.
      void this.amqp
        .createSubscriber<InboundMessage>(
          (message, _raw, headers) => this.onMessage(message, headers),
          { queue, queueOptions: { durable: true, channel: AMQP_CHANNELS.channelInbound } },
          `${InboundConsumer.name}:${queue}`,
        )
        .catch((error: unknown) =>
          this.logger.error({ err: error, queue }, 'consumidor da partição não subiu'),
        );
    }
  }

  async onMessage(
    message: InboundMessage | undefined,
    headers?: Record<string, unknown>,
  ): Promise<Nack | void> {
    if (!message?.tenantId || !message.agentId || !message.dialogId) {
      this.logger.error({ message }, 'mensagem do chatbot fora do formato; descartada');
      return new Nack(false);
    }
    const context = {
      traceId: newTraceId(),
      tenantId: message.tenantId,
      agentId: message.agentId,
      dialogId: message.dialogId,
    };
    return runWithContext(context, () => this.process(message, attemptOf(headers)));
  }

  async process(message: InboundMessage, attempt: number): Promise<Nack | void> {
    try {
      const decision = await this.gate.check(message);
      await this.apply(message, decision, attempt);
    } catch (error) {
      try {
        if (isPermanentProcessingError(error)) {
          await this.retry.deadLetter(message, attempt, error);
        } else {
          await this.retry.retryOrDeadLetter(message, attempt, error);
        }
      } catch (publishError) {
        // Sem como reagendar: volta à frente da partição, sem perder a ordem do diálogo.
        this.logger.error({ err: publishError }, 'retentativa não publicada; devolvendo à fila');
        return new Nack(true);
      }
    }
  }

  private async apply(
    message: InboundMessage,
    decision: GateDecision,
    attempt: number,
  ): Promise<void> {
    switch (decision.kind) {
      case 'skip-inactive':
      case 'skip-human':
        await this.db
          .insert(messageLog)
          .values({
            tenantId: message.tenantId,
            agentId: message.agentId,
            dialogId: message.dialogId,
            bitrixMessageId: String(message.messageId),
            direction: 'IN',
            status: SKIP_STATUS[decision.kind],
            attempts: attempt + 1,
          })
          .onConflictDoNothing();
        this.logger.log({ messageId: message.messageId, decision }, 'mensagem não encaminhada');
        return;
      case 'no-credit':
        // Aviso no diálogo, transferência e `BLOCKED_NO_CREDIT`: tarefa 9.7.
        this.logger.warn({ messageId: message.messageId, balance: decision.balance }, 'sem saldo');
        return;
      case 'forward': {
        const reply = await this.conversation.ask(message, decision.target);
        if (!reply) {
          this.logger.log(
            { messageId: message.messageId },
            'mensagem sem texto nem anexo; ignorada',
          );
          return;
        }
        await this.replies.publish(message, decision.target, reply, attempt);
        return;
      }
    }
  }
}
