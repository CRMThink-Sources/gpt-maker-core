import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { messageLog } from '../../shared/database/schema/index';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient } from '../bitrix';
import type { InboundMessage } from './inbound-message';

/** O aviso não se repete no mesmo diálogo dentro desta janela (spec agent-business-hours). */
export const OUT_OF_HOURS_NOTICE_WINDOW_SECONDS = 12 * 60 * 60;

export function outOfHoursMarkerKey(
  message: Pick<InboundMessage, 'tenantId' | 'dialogId'>,
): string {
  return `channel:out-of-hours:${message.tenantId}:${message.dialogId}`;
}

export type OutOfHoursOutcome = 'notified' | 'already-notified' | 'silent';

/**
 * Mensagem fora do horário de funcionamento: não vai ao GPTMaker nem gera débito; fica como
 * `SKIPPED_OUT_OF_HOURS` e, havendo texto configurado, o bot o envia no diálogo no máximo uma vez
 * por janela. A marca (`SET NX`) é gravada antes do envio e removida se ele falhar, para a
 * retentativa não perder o aviso.
 */
@Injectable()
export class OutOfHoursHandler {
  private readonly logger = new Logger(OutOfHoursHandler.name);

  constructor(
    private readonly bitrix: BitrixClient,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async handle(
    message: InboundMessage,
    installationId: number,
    notice: string | null,
    attempt: number,
  ): Promise<OutOfHoursOutcome> {
    await this.db
      .insert(messageLog)
      .values({
        tenantId: message.tenantId,
        agentId: message.agentId,
        dialogId: message.dialogId,
        bitrixMessageId: String(message.messageId),
        direction: 'IN',
        status: 'SKIPPED_OUT_OF_HOURS',
        attempts: attempt + 1,
      })
      .onConflictDoNothing();

    if (!notice) {
      this.logger.log({ messageId: message.messageId }, 'fora do horário; sem aviso configurado');
      return 'silent';
    }

    const key = outOfHoursMarkerKey(message);
    const claimed = await this.redis.set(key, '1', 'EX', OUT_OF_HOURS_NOTICE_WINDOW_SECONDS, 'NX');
    if (claimed !== 'OK') {
      this.logger.log({ messageId: message.messageId }, 'fora do horário; diálogo já avisado');
      return 'already-notified';
    }
    try {
      await this.bitrix.call(installationId, 'imbot.v2.Chat.Message.send', {
        botId: message.botId,
        dialogId: message.dialogId,
        fields: { message: notice },
      });
    } catch (error) {
      await this.redis.del(key);
      throw error;
    }
    this.logger.log({ messageId: message.messageId }, 'fora do horário; aviso enviado');
    return 'notified';
  }
}
