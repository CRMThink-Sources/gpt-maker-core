import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { QUEUES } from '../../shared/messaging/topology';
import type { AgentEventMessage } from '../triggers';

/**
 * `onTransfer` do GPTMaker (via `triggers.events`): o GPTMaker trocou o agente da conversa
 * (transferência entre agentes, design D17). Só registra (D18): o chat e o bot continuam os mesmos
 * e a transferência para uma pessoa vem só da ação "Transferir para atendente" da intenção.
 */
@Injectable()
export class TransferConsumer {
  private readonly logger = new Logger(TransferConsumer.name);

  @RabbitSubscribe({ queue: QUEUES.channelTransfer, createQueueIfNotExists: false })
  async onMessage(message: AgentEventMessage | undefined): Promise<Nack | void> {
    if (!message?.tenantId || !message.agentId) return new Nack(false);
    const context = {
      traceId: newTraceId(),
      tenantId: message.tenantId,
      agentId: message.agentId,
      ...(message.dialogId ? { dialogId: message.dialogId } : {}),
    };
    return runWithContext(context, () => this.process(message));
  }

  async process(message: AgentEventMessage): Promise<void> {
    this.logger.log(
      { agentEventId: message.agentEventId, dialogId: message.dialogId ?? null },
      'troca de agente no GPTMaker (onTransfer); nada a fazer no Bitrix24',
    );
  }
}
