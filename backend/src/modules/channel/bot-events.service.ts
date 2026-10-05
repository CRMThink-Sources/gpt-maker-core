import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { agentBot } from '../../shared/database/schema/index';
import { EXCHANGES } from '../../shared/messaging/topology';
import { REDIS } from '../../shared/redis/redis.module';
import type { Tenant } from '../tenancy';
import { HumanHandoff } from './human-handoff';
import {
  dialogKey,
  type InboundMessage,
  JOIN_CHAT_EVENT,
  joinChatDataSchema,
  MESSAGE_ADD_EVENT,
  messageAddDataSchema,
} from './inbound-message';
import { messageIdOf } from './inbound-retry';

/** Janela da deduplicação: reentregas do mesmo evento chegam em minutos. */
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

export type BotEventOutcome =
  | 'queued'
  | 'duplicate'
  | 'ignored-event'
  | 'ignored-invalid'
  | 'ignored-own'
  | 'unknown-bot'
  | 'human-stopped'
  | 'joined';

/**
 * Eventos dos chatbots (spec bitrix-chatbot-channel, design D5): responde rápido ao Bitrix sem
 * esperar o GPTMaker. Mensagem nova de cliente ⇒ deduplicada no Redis e publicada em
 * `channel.inbound` com a chave do diálogo; o worker (9.4) processa em ordem por diálogo. Bot
 * entrando no chat (sessão nova da Linha Aberta) encerra o atendimento humano do diálogo.
 */
@Injectable()
export class BotEventsService {
  private readonly logger = new Logger(BotEventsService.name);

  constructor(
    private readonly amqp: AmqpConnection,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly handoff: HumanHandoff,
  ) {}

  async handle(tenant: Tenant, body: unknown, now = new Date()): Promise<BotEventOutcome> {
    const envelope = (body ?? {}) as { event?: unknown; data?: unknown };
    if (envelope.event === JOIN_CHAT_EVENT) return this.onJoinChat(tenant, envelope.data);
    if (envelope.event !== MESSAGE_ADD_EVENT) {
      this.logger.debug({ event: envelope.event }, 'evento de bot ignorado');
      return 'ignored-event';
    }
    const parsed = messageAddDataSchema.safeParse(envelope.data);
    if (!parsed.success) {
      this.logger.warn({ issues: parsed.error.issues }, 'evento de mensagem fora do formato');
      return 'ignored-invalid';
    }
    const data = parsed.data;
    // Mensagens de bots (inclusive as do próprio agente) e de sistema não vão ao GPTMaker.
    if (data.user.bot || data.message.isSystem || data.message.authorId === 0) {
      return 'ignored-own';
    }

    const [bot] = await this.db
      .select({ agentId: agentBot.agentId })
      .from(agentBot)
      .where(and(eq(agentBot.tenantId, tenant.id), eq(agentBot.botId, String(data.bot.id))));
    if (!bot) {
      this.logger.warn({ botId: data.bot.id }, 'mensagem para bot sem agente vinculado');
      return 'unknown-bot';
    }

    const key = `channel:msg:${tenant.id}:${data.bot.id}:${data.message.id}`;
    const first = await this.redis.set(key, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');
    if (first !== 'OK') return 'duplicate';

    const message: InboundMessage = {
      tenantId: tenant.id,
      agentId: bot.agentId,
      botId: data.bot.id,
      dialogId: data.chat.dialogId,
      chatId: data.chat.id,
      messageId: data.message.id,
      text: data.message.text,
      params: data.message.params ?? null,
      user: { id: data.user.id, name: data.user.name, connector: data.user.connector },
      chat: {
        type: data.chat.type,
        entityType: data.chat.entityType,
        entityId: data.chat.entityId,
        entityData1: data.chat.entityData1,
        entityData2: data.chat.entityData2,
        entityData3: data.chat.entityData3,
      },
      language: data.language,
      receivedAt: now.toISOString(),
    };
    try {
      await this.amqp.publish(EXCHANGES.channelInbound, dialogKey(message), message, {
        persistent: true,
        messageId: messageIdOf(message),
      });
    } catch (error) {
      // Sem a fila, a reentrega (se houver) precisa passar pela deduplicação de novo.
      await this.redis.del(key);
      throw error;
    }
    return 'queued';
  }

  /**
   * Sessão nova da Linha Aberta: se o diálogo estava com um operador, o agente volta a responder
   * (`stop-human`). Aqui mesmo, e não na fila: a primeira mensagem da sessão chega junto e não
   * pode ser descartada como atendimento humano.
   */
  private async onJoinChat(tenant: Tenant, data: unknown): Promise<BotEventOutcome> {
    const parsed = joinChatDataSchema.safeParse(data);
    if (!parsed.success || !parsed.data.dialogId) {
      this.logger.warn({ issues: parsed.error?.issues }, 'entrada do bot no chat fora do formato');
      return 'ignored-invalid';
    }
    const [bot] = await this.db
      .select({ agentId: agentBot.agentId })
      .from(agentBot)
      .where(and(eq(agentBot.tenantId, tenant.id), eq(agentBot.botId, String(parsed.data.botId))));
    if (!bot) return 'unknown-bot';
    const outcome = await this.handoff.stop({
      tenantId: tenant.id,
      dialogId: parsed.data.dialogId,
    });
    return outcome === 'stopped' ? 'human-stopped' : 'joined';
  }
}
