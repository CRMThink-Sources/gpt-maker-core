import { setTimeout as sleep } from 'node:timers/promises';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { aiModel } from '../../shared/database/schema/index';
import { QUEUES } from '../../shared/messaging/topology';
import { CreditAlerts } from './credit-alerts';
import { LedgerService, type OperationResult } from './ledger.service';

/** Pausa antes de devolver à fila um evento que falhou (banco fora), para não girar em falso. */
const REQUEUE_PAUSE_MS = 2_000;

/**
 * `usage.response`: uma resposta do agente entregue ao cliente, publicada pelo canal (9.6) em
 * `usage.events` e debitada aqui.
 */
export interface UsageResponseEvent {
  /** Mensagem do cliente respondida: `tenantId:botId:messageId` (chave da idempotência). */
  messageId: string;
  tenantId: string;
  agentId: string;
  dialogId: string;
  modelCode: string;
  /** Id da resposta no Bitrix (ausente no teste do agente, que não passa pelo Bitrix). */
  replyMessageId?: number | null;
  respondedAt: string;
  /** `test`: resposta de conversa de teste do app (spec agent-test-chat); padrão `channel`. */
  source?: 'channel' | 'test';
}

export type UsageDebitOutcome = 'debited' | 'duplicate' | 'unknown-model';

/**
 * Débito por resposta entregue (spec credit-billing: débito por resposta com créditos reais): o
 * custo vigente do modelo no catálogo no momento do processamento, em cascata nas carteiras,
 * guardando modelo e custo. Idempotente pela mensagem (`msg:<tenant>:<bot>:<mensagem>`).
 * Modelo fora do catálogo não debita e alerta: a reconciliação diária (14.x) corrige pelo
 * consumo real.
 */
@Injectable()
export class UsageDebitConsumer {
  private readonly logger = new Logger(UsageDebitConsumer.name);

  constructor(
    private readonly ledger: LedgerService,
    private readonly alerts: CreditAlerts,
    @Inject(DB) private readonly db: Database,
  ) {}

  @RabbitSubscribe({ queue: QUEUES.usageResponse, createQueueIfNotExists: false })
  async onMessage(event: UsageResponseEvent | undefined): Promise<Nack | void> {
    if (!event?.messageId || !event.tenantId || !event.modelCode) {
      this.logger.error({ event }, 'usage.response fora do formato; descartado');
      return new Nack(false);
    }
    const context = { traceId: newTraceId(), tenantId: event.tenantId, agentId: event.agentId };
    return runWithContext(context, async () => {
      try {
        await this.debit(event);
      } catch (error) {
        this.logger.error({ messageId: event.messageId, err: error }, 'débito da resposta falhou');
        await sleep(REQUEUE_PAUSE_MS);
        return new Nack(true);
      }
    });
  }

  async debit(event: UsageResponseEvent): Promise<UsageDebitOutcome> {
    const cost = await this.currentCost(event.modelCode);
    if (cost === null) {
      this.logger.error(
        { alert: true, messageId: event.messageId, modelCode: event.modelCode },
        'modelo da resposta fora do catálogo; sem débito (a reconciliação corrige)',
      );
      return 'unknown-model';
    }
    const result: OperationResult = await this.ledger.debit({
      tenantId: event.tenantId,
      key: `msg:${event.messageId}`,
      amount: cost,
      modelCode: event.modelCode,
      unitCost: cost,
      agentId: event.agentId,
      refType: event.source === 'test' ? 'test_message' : 'message',
      refId: event.messageId,
      createdBy: 'system:usage',
    });
    if (!result.applied) return 'duplicate';
    this.logger.log(
      { messageId: event.messageId, cost, balance: result.balance.total },
      'resposta debitada',
    );
    // 80% e saldo zerado: uma vez por ciclo (11.5).
    await this.alerts.afterDebit(event.tenantId, result.balance);
    return 'debited';
  }

  /** Custo do modelo agora: o não removido com o código; senão o removido mais recente. */
  private async currentCost(code: string): Promise<number | null> {
    const [row] = await this.db
      .select({ credits: aiModel.creditsPerResponse })
      .from(aiModel)
      .where(eq(aiModel.code, code))
      .orderBy(sql`${aiModel.deletedAt} is not null`, desc(aiModel.deletedAt))
      .limit(1);
    return row?.credits ?? null;
  }
}
