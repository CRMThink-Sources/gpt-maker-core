import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { messageLog, tenant } from '../../shared/database/schema/index';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient } from '../bitrix';
import type { InboundMessage } from './inbound-message';
import { sentMarkerKey } from './reply-publisher';

export type DeliveryFailureOutcome = 'transferred' | 'already-answered' | 'transfer-failed';

/**
 * Mensagem que foi para a DLQ (tentativas esgotadas ou erro permanente; spec
 * bitrix-chatbot-channel: resiliência): o cliente não pode ficar sem resposta, então o diálogo
 * vai para o operador livre da Linha Aberta. Sem débito (o `usage.response` só sai depois da
 * resposta entregue). Melhor esforço: a mensagem já está na DLQ, e falha aqui só vai para o log.
 */
@Injectable()
export class DeliveryFailureHandler {
  private readonly logger = new Logger(DeliveryFailureHandler.name);

  constructor(
    private readonly bitrix: BitrixClient,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async handle(
    message: InboundMessage,
    attempts: number,
    error: unknown,
  ): Promise<DeliveryFailureOutcome> {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    try {
      await this.db
        .insert(messageLog)
        .values({
          tenantId: message.tenantId,
          agentId: message.agentId,
          dialogId: message.dialogId,
          bitrixMessageId: String(message.messageId),
          direction: 'IN',
          status: 'FAILED',
          attempts,
          error: reason,
        })
        // Já registrada como respondida ou bloqueada: o registro anterior vale.
        .onConflictDoNothing();

      // A resposta chegou ao cliente e a falha foi depois (registro, evento): não transfere.
      if (await this.redis.get(sentMarkerKey(message))) {
        this.logger.warn({ messageId: message.messageId }, 'falha depois da resposta entregue');
        return 'already-answered';
      }

      const [row] = await this.db
        .select({ installationId: tenant.installationId })
        .from(tenant)
        .where(eq(tenant.id, message.tenantId));
      if (!row) throw new Error('tenant não encontrado');
      await this.bitrix.call(Number(row.installationId), 'imopenlines.bot.session.operator', {
        CHAT_ID: message.chatId,
      });
      this.logger.warn(
        { messageId: message.messageId, chatId: message.chatId },
        'mensagem na DLQ: diálogo transferido ao operador',
      );
      return 'transferred';
    } catch (transferError) {
      this.logger.error(
        { alert: true, messageId: message.messageId, chatId: message.chatId, err: transferError },
        'mensagem na DLQ e diálogo não transferido ao operador',
      );
      return 'transfer-failed';
    }
  }
}
