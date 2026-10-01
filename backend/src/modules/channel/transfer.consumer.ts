import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { QUEUES } from '../../shared/messaging/topology';
import type { AgentEventMessage } from '../triggers';
import { HumanHandoff } from './human-handoff';

/**
 * `onTransfer` do GPTMaker (via `triggers.events`): o agente pediu um humano ⇒ `HumanHandoff.start`.
 * Os clientes do Bitrix e do GPTMaker já retentam falhas transitórias; o que ainda falhar vai para
 * `channel.transfer.dlq` com alerta. A fila é declarada na topologia (com a DLQ), não aqui.
 */
@Injectable()
export class TransferConsumer {
  private readonly logger = new Logger(TransferConsumer.name);

  constructor(private readonly handoff: HumanHandoff) {}

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

  async process(message: AgentEventMessage): Promise<Nack | void> {
    if (!message.dialogId) {
      // O payload real do `onTransfer` ainda não foi capturado (10.1): sem diálogo, nada a fazer.
      this.logger.warn(
        { agentEventId: message.agentEventId },
        'onTransfer sem diálogo do Bitrix; ver o payload em agent_event',
      );
      return;
    }
    try {
      await this.handoff.start({
        tenantId: message.tenantId,
        agentId: message.agentId,
        dialogId: message.dialogId,
      });
    } catch (error) {
      this.logger.error(
        { alert: true, agentEventId: message.agentEventId, err: error },
        'transferência para humano falhou (DLQ)',
      );
      return new Nack(false);
    }
  }
}
