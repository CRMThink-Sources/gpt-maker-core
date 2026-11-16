import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { type Locale, toLocale } from '@gptmaker/contracts';
import { DB, type Database } from '../../shared/database/database.module';
import { messageLog, tenant } from '../../shared/database/schema/index';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient, BitrixError } from '../bitrix';
import type { InboundMessage } from './inbound-message';

/** Aviso no diálogo quando o tenant está sem créditos (mensagem de sistema do bot), por idioma do tenant. */
export const NO_CREDIT_NOTICES: Record<Locale, string> = {
  'pt-BR':
    'Esta mensagem não será respondida pelo assistente virtual porque os créditos de IA ' +
    'acabaram. Um atendente vai continuar o seu atendimento.',
  en:
    'This message will not be answered by the virtual assistant because the AI credits have ' +
    'run out. A human agent will continue your conversation.',
  es:
    'Este mensaje no será respondido por el asistente virtual porque se acabaron los ' +
    'créditos de IA. Un agente humano continuará con su atención.',
};

/**
 * Janela em que o aviso e a transferência não se repetem no mesmo diálogo: o cliente costuma
 * mandar várias mensagens seguidas, e cada uma só fica registrada como bloqueada.
 */
const NOTICE_WINDOW_SECONDS = 60 * 60;

export function noCreditMarkerKey(message: Pick<InboundMessage, 'tenantId' | 'dialogId'>): string {
  return `channel:no-credit:${message.tenantId}:${message.dialogId}`;
}

export type NoCreditOutcome = 'notified' | 'already-notified';

/**
 * Tenant sem saldo (spec bitrix-chatbot-channel: saldo insuficiente): a mensagem não vai ao
 * GPTMaker nem gera débito; o bot avisa no diálogo com mensagem de sistema, transfere para o
 * operador livre da Linha Aberta (`imopenlines.bot.session.operator`) e a mensagem fica como
 * `BLOCKED_NO_CREDIT`. A marca no Redis guarda o passo concluído (`notified` ⇒ `transferred`):
 * a retentativa depois de uma falha não repete o aviso.
 */
@Injectable()
export class NoCreditHandler {
  private readonly logger = new Logger(NoCreditHandler.name);

  constructor(
    private readonly bitrix: BitrixClient,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async handle(
    message: InboundMessage,
    installationId: number,
    attempt: number,
  ): Promise<NoCreditOutcome> {
    await this.db
      .insert(messageLog)
      .values({
        tenantId: message.tenantId,
        agentId: message.agentId,
        dialogId: message.dialogId,
        bitrixMessageId: String(message.messageId),
        direction: 'IN',
        status: 'BLOCKED_NO_CREDIT',
        attempts: attempt + 1,
      })
      .onConflictDoNothing();

    const key = noCreditMarkerKey(message);
    const step = await this.redis.get(key);
    if (step === 'transferred') {
      this.logger.log({ messageId: message.messageId }, 'sem saldo; diálogo já avisado');
      return 'already-notified';
    }
    if (step !== 'notified') {
      await this.bitrix.call(installationId, 'imbot.v2.Chat.Message.send', {
        botId: message.botId,
        dialogId: message.dialogId,
        fields: { message: await this.notice(message.tenantId), system: true },
      });
      await this.redis.set(key, 'notified', 'EX', NOTICE_WINDOW_SECONDS);
    }
    await this.transfer(message, installationId);
    await this.redis.set(key, 'transferred', 'EX', NOTICE_WINDOW_SECONDS);
    this.logger.warn(
      { messageId: message.messageId },
      'sem saldo: aviso enviado e diálogo transferido ao operador',
    );
    return 'notified';
  }

  /** Aviso no idioma do tenant (spec notification-i18n); sem tenant ou valor inválido, pt-BR. */
  private async notice(tenantId: string): Promise<string> {
    const [row] = await this.db
      .select({ locale: tenant.locale })
      .from(tenant)
      .where(eq(tenant.id, tenantId));
    return NO_CREDIT_NOTICES[toLocale(row?.locale)];
  }

  /** Recusa do Bitrix (ex.: o diálogo já está com um operador) não impede o resto: só o log. */
  private async transfer(message: InboundMessage, installationId: number): Promise<void> {
    try {
      await this.bitrix.call(installationId, 'imopenlines.bot.session.operator', {
        CHAT_ID: message.chatId,
      });
    } catch (error) {
      if (!(error instanceof BitrixError) || error.isTransient) throw error;
      this.logger.warn(
        { messageId: message.messageId, chatId: message.chatId, err: error },
        'transferência ao operador recusada pelo Bitrix',
      );
    }
  }
}
