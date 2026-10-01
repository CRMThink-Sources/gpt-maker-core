import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { messageLog } from '../../shared/database/schema/index';
import { EXCHANGES, USAGE_EVENTS } from '../../shared/messaging/topology';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient } from '../bitrix';
import type { GptMakerConversationResponse } from '../gptmaker';
import type { ForwardTarget } from './inbound-gate';
import type { InboundMessage } from './inbound-message';
import { messageIdOf } from './inbound-retry';
import { replyFields } from './reply-format';

/** Marca de resposta já enviada ao Bitrix: a retentativa não manda de novo ao cliente. */
const SENT_TTL_SECONDS = 24 * 60 * 60;

export function sentMarkerKey(message: InboundMessage): string {
  return `channel:sent:${messageIdOf(message)}`;
}

/**
 * `usage.response`: uma resposta do agente entregue ao cliente (design D5). O billing (11.4)
 * lança o `DEBIT` com o custo vigente do `modelCode`, idempotente por `messageId`.
 */
export interface UsageResponseEvent {
  /** Mensagem do cliente respondida: `tenantId:botId:messageId` (chave da idempotência). */
  messageId: string;
  tenantId: string;
  agentId: string;
  dialogId: string;
  modelCode: string;
  /** Id da resposta no Bitrix. */
  replyMessageId: number;
  respondedAt: string;
}

export type PublishOutcome = 'sent' | 'already-sent' | 'empty';

/**
 * Publica a resposta do GPTMaker no diálogo pelo bot (`imbot.v2.Chat.Message.send`), registra
 * no `message_log` e emite `usage.response`. O Bitrix não tem chave de idempotência: a marca no
 * Redis, gravada logo depois do envio, evita mandar duas vezes quando uma falha posterior (banco,
 * fila) leva a mensagem à retentativa; o registro e o evento são idempotentes e se repetem.
 */
@Injectable()
export class ReplyPublisher {
  private readonly logger = new Logger(ReplyPublisher.name);

  constructor(
    private readonly bitrix: BitrixClient,
    private readonly amqp: AmqpConnection,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async publish(
    message: InboundMessage,
    target: ForwardTarget,
    reply: GptMakerConversationResponse,
    attempt: number,
    now = new Date(),
  ): Promise<PublishOutcome> {
    const fields = replyFields(reply);
    if (!fields) {
      this.logger.warn({ messageId: message.messageId }, 'GPTMaker respondeu sem texto nem mídia');
      return 'empty';
    }

    const key = sentMarkerKey(message);
    const marked = await this.redis.get(key);
    let replyMessageId = marked ? Number(marked) : null;
    if (replyMessageId === null) {
      const { result } = await this.bitrix.call<{ id: number | string }>(
        target.installationId,
        'imbot.v2.Chat.Message.send',
        { botId: message.botId, dialogId: message.dialogId, fields },
      );
      replyMessageId = Number(result.id);
      await this.redis.set(key, String(replyMessageId), 'EX', SENT_TTL_SECONDS);
    }

    await this.record(message, target, replyMessageId, attempt);
    const event: UsageResponseEvent = {
      messageId: messageIdOf(message),
      tenantId: message.tenantId,
      agentId: message.agentId,
      dialogId: message.dialogId,
      modelCode: target.modelCode,
      replyMessageId,
      respondedAt: now.toISOString(),
    };
    await this.amqp.publish(EXCHANGES.usageEvents, USAGE_EVENTS.response, event, {
      persistent: true,
      messageId: event.messageId,
    });
    this.logger.log(
      { messageId: message.messageId, replyMessageId, modelCode: target.modelCode },
      marked ? 'resposta já enviada; registro e consumo refeitos' : 'resposta enviada ao Bitrix',
    );
    return marked ? 'already-sent' : 'sent';
  }

  /** Entrada como `RESPONDED` e a saída com o id do Bitrix; repetir não duplica. */
  private async record(
    message: InboundMessage,
    target: ForwardTarget,
    replyMessageId: number,
    attempt: number,
  ): Promise<void> {
    const base = {
      tenantId: message.tenantId,
      agentId: message.agentId,
      dialogId: message.dialogId,
      status: 'RESPONDED' as const,
      modelCode: target.modelCode,
      attempts: attempt + 1,
    };
    await this.db
      .insert(messageLog)
      .values([
        { ...base, bitrixMessageId: String(message.messageId), direction: 'IN' },
        { ...base, bitrixMessageId: String(replyMessageId), direction: 'OUT' },
      ])
      .onConflictDoUpdate({
        target: [messageLog.tenantId, messageLog.bitrixMessageId, messageLog.direction],
        set: {
          status: sql`excluded.status`,
          modelCode: sql`excluded.model_code`,
          attempts: sql`excluded.attempts`,
          updatedAt: sql`now()`,
        },
      });
  }
}
