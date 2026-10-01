import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { tenantBalance } from '../../shared/database/schema/index';
import { REDIS } from '../../shared/redis/redis.module';

/**
 * Validade do saldo lido do banco no Redis. O ledger (11.1) grava o espelho a cada lançamento;
 * o TTL só limita quanto uma leitura concorrente com um lançamento pode ficar desatualizada.
 */
export const BALANCE_CACHE_TTL_SECONDS = 60;

/** Espelho Redis do saldo total do tenant (design D8): as três carteiras somadas, inteiro. */
export function balanceCacheKey(tenantId: string): string {
  return `billing:balance:${tenantId}`;
}

/**
 * Saldo total do tenant para a checagem "total > 0" antes do GPTMaker (design D8): Redis
 * primeiro; sem espelho ou com o Redis fora, soma as carteiras de `tenant_balance` e repõe o
 * espelho. Tenant sem linha de saldo tem zero.
 */
@Injectable()
export class BalanceReader {
  private readonly logger = new Logger(BalanceReader.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async total(tenantId: string): Promise<number> {
    const key = balanceCacheKey(tenantId);
    try {
      const cached = await this.redis.get(key);
      if (cached !== null && /^-?\d+$/.test(cached)) return Number(cached);
    } catch (error) {
      this.logger.warn({ err: error }, 'saldo indisponível no Redis; lendo do banco');
    }

    const [row] = await this.db
      .select({
        trial: tenantBalance.trialBalance,
        plan: tenantBalance.planBalance,
        extra: tenantBalance.extraBalance,
      })
      .from(tenantBalance)
      .where(eq(tenantBalance.tenantId, tenantId));
    const total = row ? row.trial + row.plan + row.extra : 0;
    try {
      await this.redis.set(key, String(total), 'EX', BALANCE_CACHE_TTL_SECONDS);
    } catch {
      // Redis fora: a próxima leitura vai ao banco de novo.
    }
    return total;
  }
}
