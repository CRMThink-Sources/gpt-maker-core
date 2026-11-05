import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { enrichContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, agentEvent } from '../../shared/database/schema/index';
import { EXCHANGES } from '../../shared/messaging/topology';
import { isTestDialog } from '../agent-test';
import { hashWebhookToken } from '../agents';
import { type GptMakerWebhookEvent, WEBHOOK_EVENTS } from '../gptmaker';

/** Mensagem de `triggers.events` (routing key = nome do evento). */
export interface AgentEventMessage {
  agentEventId: string;
  tenantId: string;
  agentId: string;
  event: GptMakerWebhookEvent;
  /** Diálogo do Bitrix, quando o payload traz o `contextId` que o app manda (`tenantId:dialogId`). */
  dialogId: string | null;
}

export type IntakeOutcome =
  | { kind: 'accepted'; message: AgentEventMessage }
  | { kind: 'unknown-event' }
  | { kind: 'invalid-token' };

export function isWebhookEvent(value: string): value is GptMakerWebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/**
 * Webhooks dos agentes no GPTMaker (spec agent-triggers, design D12): o token do `?t=` identifica
 * o agente (só o hash fica no banco); o evento é gravado como chegou em `agent_event` e
 * publicado em `triggers.events`. O payload real não está documentado (tarefa 10.1): nada nele é
 * exigido, e o `agent_event` guarda o corpo inteiro para consulta.
 */
@Injectable()
export class AgentEventIntake {
  private readonly logger = new Logger(AgentEventIntake.name);

  constructor(
    private readonly amqp: AmqpConnection,
    @Inject(DB) private readonly db: Database,
  ) {}

  async receive(
    event: string,
    token: string | undefined,
    payload: unknown,
  ): Promise<IntakeOutcome> {
    if (!isWebhookEvent(event)) return { kind: 'unknown-event' };
    if (!token) return { kind: 'invalid-token' };
    const [owner] = await this.db
      .select({ id: agent.id, tenantId: agent.tenantId })
      .from(agent)
      .where(eq(agent.webhookTokenHash, hashWebhookToken(token)));
    if (!owner) return { kind: 'invalid-token' };
    enrichContext({ tenantId: owner.tenantId, agentId: owner.id });

    const dialogId = dialogIdFrom(payload, owner.tenantId);
    if (dialogId) enrichContext({ dialogId });
    const [row] = await this.db
      .insert(agentEvent)
      .values({
        tenantId: owner.tenantId,
        agentId: owner.id,
        event,
        dialogId,
        payload: (payload ?? {}) as object,
      })
      .returning({ id: agentEvent.id });

    const message: AgentEventMessage = {
      agentEventId: row!.id,
      tenantId: owner.tenantId,
      agentId: owner.id,
      event,
      dialogId,
    };
    // Conversa de teste do app não dispara gatilhos (spec agent-test-chat): só fica registrada.
    if (isTestDialog(dialogId)) {
      this.logger.log(
        { event, agentEventId: message.agentEventId },
        'webhook de conversa de teste registrado, sem gatilhos',
      );
      return { kind: 'accepted', message };
    }
    await this.amqp.publish(EXCHANGES.triggersEvents, event, message, {
      persistent: true,
      messageId: message.agentEventId,
    });
    this.logger.log({ event, agentEventId: message.agentEventId }, 'webhook do GPTMaker recebido');
    return { kind: 'accepted', message };
  }
}

/**
 * O app conversa com `contextId = tenantId:dialogId` (9.5); se o payload trouxer esse valor em
 * algum campo `*context*` ou `recipient` (raiz ou um nível abaixo), dá o diálogo do Bitrix. O
 * GPTMaker prefixa o `contextId` (`public-api-<agentId>-tenantId:dialogId`); o `recipient`
 * traz o valor original. Por isso o diálogo é o que vem depois de `tenantId:`, onde estiver.
 */
export function dialogIdFrom(payload: unknown, tenantId: string): string | null {
  const marker = `${tenantId}:`;
  const visit = (value: unknown, depth: number): string | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const [key, item] of Object.entries(value)) {
      if (!/context|recipient/i.test(key) || typeof item !== 'string') continue;
      const at = item.indexOf(marker);
      if (at >= 0) return item.slice(at + marker.length) || null;
    }
    if (depth > 0) {
      for (const item of Object.values(value)) {
        const found = visit(item, depth - 1);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(payload, 1);
}
