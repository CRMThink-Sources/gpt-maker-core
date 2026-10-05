import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, lte } from 'drizzle-orm';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { subscriptionState } from '../../shared/database/schema/index';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { TenantLifecycle, TenantService } from '../tenancy';

/** A marca vale até bem depois de qualquer carência; nova falha gera outro `grace_until`. */
const NOTIFIED_TTL_SECONDS = 90 * 86_400;

const notifiedKey = (tenantId: string, graceUntil: Date) =>
  `payments:grace-expired:${tenantId}:${graceUntil.toISOString()}`;

/**
 * Carência vencida (spec payments-integration, "Carência esgotada"; tarefa 12.5): a cada 15 min
 * avisa o `TenantLifecycle` (`onAccessChanged`) uma vez por carência dos tenants ainda `past_due`
 * com `grace_until` vencido. Quem inativa os agentes é a `AgentAccessPolicy` (7.6), que já trata
 * `past_due` com carência vencida como assinatura expirada; regularizado depois, o `recovered`
 * limpa a carência e o mesmo aviso reativa.
 */
@Injectable()
export class GraceExpiryJob {
  private readonly logger = new Logger(GraceExpiryJob.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly tenants: TenantService,
    private readonly lifecycle: TenantLifecycle,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @Cron('*/15 * * * *', { name: 'grace-expiry' })
  async run(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive('job:grace-expiry', 14 * 60_000, () =>
          this.expire(),
        );
        if (outcome.ran && outcome.result) {
          this.logger.log({ count: outcome.result }, 'carências vencidas: agentes inativados');
        }
      } catch (error) {
        this.logger.error({ err: error }, 'job de carência falhou');
      }
    });
  }

  async expire(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ tenantId: subscriptionState.tenantId, graceUntil: subscriptionState.graceUntil })
      .from(subscriptionState)
      .where(and(eq(subscriptionState.status, 'past_due'), lte(subscriptionState.graceUntil, now)));
    let count = 0;
    for (const row of due) {
      const key = notifiedKey(row.tenantId, row.graceUntil!);
      if (await this.redis.exists(key)) continue;
      const tenant = await this.tenants.findById(row.tenantId);
      if (!tenant) continue;
      try {
        await this.lifecycle.emit('onAccessChanged', tenant);
      } catch (error) {
        // Sem marca: a próxima rodada tenta de novo; os demais tenants seguem.
        this.logger.error({ err: error, tenantId: row.tenantId }, 'aviso de carência falhou');
        continue;
      }
      await this.redis.set(key, '1', 'EX', NOTIFIED_TTL_SECONDS);
      this.logger.warn(
        { tenantId: row.tenantId, graceUntil: row.graceUntil },
        'carência de pagamento vencida',
      );
      count++;
    }
    return count;
  }
}
