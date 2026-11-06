import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { messageLog } from '../../shared/database/schema/index';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient } from '../bitrix';
import { HumanHandoff } from './human-handoff';
import type { InboundMessage } from './inbound-message';

/** O aviso não se repete no mesmo diálogo dentro desta janela (spec agent-business-hours). */
export const OUT_OF_HOURS_NOTICE_WINDOW_SECONDS = 12 * 60 * 60;

export function outOfHoursMarkerKey(
  message: Pick<InboundMessage, 'tenantId' | 'dialogId'>,
): string {
  return `channel:out-of-hours:${message.tenantId}:${message.dialogId}`;
}

/** Passo do aviso já cumprido enquanto a transferência não termina (retentativa não repete o aviso). */
export function outOfHoursTransferKey(
  message: Pick<InboundMessage, 'tenantId' | 'dialogId'>,
): string {
  return `channel:out-of-hours-transfer:${message.tenantId}:${message.dialogId}`;
}

const TRANSFER_STEP_WINDOW_SECONDS = 60 * 60;

export type OutOfHoursOutcome = 'notified' | 'already-notified' | 'silent' | 'transferred';

/**
 * Mensagem fora do horário de funcionamento: não vai ao GPTMaker nem gera débito; fica como
 * `SKIPPED_OUT_OF_HOURS`. Com transferência ligada, o bot envia o aviso (se houver) e passa o
 * diálogo ao operador livre (`HumanHandoff.start`); dali em diante o gate devolve `skip-human`, e
 * não há novo aviso. Sem transferência, o bot envia o texto no máximo uma vez por janela (marca
 * `SET NX` gravada antes do envio e removida se ele falhar, para a retentativa não perder o aviso).
 */
@Injectable()
export class OutOfHoursHandler {
  private readonly logger = new Logger(OutOfHoursHandler.name);

  constructor(
    private readonly bitrix: BitrixClient,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly handoff: HumanHandoff,
  ) {}

  async handle(
    message: InboundMessage,
    installationId: number,
    notice: string | null,
    transfer: boolean,
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

    if (transfer) return this.noticeAndTransfer(message, installationId, notice);

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

  /**
   * Aviso (se houver) e depois a transferência. A marca guarda só o aviso já enviado enquanto a
   * transferência não termina: falha na transferência ⇒ a retentativa não repete o aviso, e o
   * `start` é idempotente. Concluída a transferência, a marca sai: se o atendente devolver o
   * diálogo à IA e o cliente escrever de novo fora do horário, ele é avisado e transferido outra vez.
   */
  private async noticeAndTransfer(
    message: InboundMessage,
    installationId: number,
    notice: string | null,
  ): Promise<OutOfHoursOutcome> {
    const key = outOfHoursTransferKey(message);
    if (notice && (await this.redis.get(key)) !== 'notified') {
      await this.bitrix.call(installationId, 'imbot.v2.Chat.Message.send', {
        botId: message.botId,
        dialogId: message.dialogId,
        fields: { message: notice },
      });
      await this.redis.set(key, 'notified', 'EX', TRANSFER_STEP_WINDOW_SECONDS);
    }
    await this.handoff.start({
      tenantId: message.tenantId,
      agentId: message.agentId,
      dialogId: message.dialogId,
    });
    await this.redis.del(key);
    this.logger.log({ messageId: message.messageId }, 'fora do horário; diálogo transferido');
    return 'transferred';
  }
}
