import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import type Redis from 'ioredis';
import { enrichContext, newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { training } from '../../shared/database/schema/index';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { TrainingService } from './training.service';

/** Por execução: o resto vence na próxima, sem rajada de chamadas ao GPTMaker (design D2). */
export const EXPIRY_BATCH_SIZE = 50;
const LOCK_TTL_MS = 10 * 60_000;

export interface TrainingExpirySummary {
  due: number;
  expired: number;
  failed: number;
}

/**
 * Expira os treinamentos cujo prazo passou (spec training-expiration): apaga no GPTMaker e marca
 * `EXPIRED`. Falha de um treinamento é registrada e não impede os demais; ele volta na próxima
 * execução. O lock distribuído garante uma execução por vez mesmo com várias instâncias do worker.
 */
@Injectable()
export class TrainingExpiryJob {
  private readonly logger = new Logger(TrainingExpiryJob.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly trainings: TrainingService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @Cron('*/15 * * * *', { name: 'training-expiry' })
  async runScheduled(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive('job:training-expiry', LOCK_TTL_MS, () =>
          this.run(),
        );
        if (outcome.ran && outcome.result.due > 0) {
          this.logger.log({ summary: outcome.result }, 'expiração de treinamentos concluída');
        }
      } catch (error) {
        this.logger.error({ alert: true, err: error }, 'expiração de treinamentos falhou');
      }
    });
  }

  /** Uma passada sobre os vencidos (`managed` nunca expira). */
  async run(now = new Date()): Promise<TrainingExpirySummary> {
    const due = await this.db
      .select({ id: training.id, tenantId: training.tenantId, agentId: training.agentId })
      .from(training)
      .where(
        and(
          isNotNull(training.expiresAt),
          lte(training.expiresAt, now),
          isNull(training.expiredAt),
          isNull(training.deletedAt),
          ne(training.status, 'EXPIRED'),
          eq(training.managed, false),
        ),
      )
      .orderBy(asc(training.expiresAt), asc(training.id))
      .limit(EXPIRY_BATCH_SIZE);

    const summary: TrainingExpirySummary = { due: due.length, expired: 0, failed: 0 };
    for (const ref of due) {
      await runWithContext({ traceId: newTraceId() }, async () => {
        enrichContext({ tenantId: ref.tenantId, agentId: ref.agentId });
        try {
          if (await this.trainings.expire(ref, now)) summary.expired++;
        } catch (error) {
          summary.failed++;
          this.logger.error(
            { trainingId: ref.id, err: error },
            'treinamento vencido não pôde ser expirado; nova tentativa na próxima execução',
          );
        }
      });
    }
    return summary;
  }
}
