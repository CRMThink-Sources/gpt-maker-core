import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { dialogState } from '../../shared/database/schema/index';
import { REDIS } from '../../shared/redis/redis.module';

/** Validade da flag no Redis; quem liga ou desliga o atendimento humano (9.8) regrava a chave. */
export const HUMAN_FLAG_TTL_SECONDS = 60 * 60;

/** Flag de atendimento humano do diálogo no Redis (design D16): `1` em curso, `0` não. */
export function humanFlagKey(tenantId: string, dialogId: string): string {
  return `channel:human:${tenantId}:${dialogId}`;
}

/**
 * Se um operador está atendendo o diálogo, quando o agente não responde (spec
 * bitrix-chatbot-channel: transferência para humano). Redis primeiro; sem flag ou com o Redis
 * fora, lê `dialog_state.human_active` e repõe a flag. Diálogo sem estado ⇒ sem humano.
 */
@Injectable()
export class HumanAttendance {
  private readonly logger = new Logger(HumanAttendance.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async isActive(tenantId: string, dialogId: string): Promise<boolean> {
    const key = humanFlagKey(tenantId, dialogId);
    try {
      const cached = await this.redis.get(key);
      if (cached === '1' || cached === '0') return cached === '1';
    } catch (error) {
      this.logger.warn({ err: error }, 'flag de atendimento humano indisponível no Redis');
    }

    const [row] = await this.db
      .select({ humanActive: dialogState.humanActive })
      .from(dialogState)
      .where(and(eq(dialogState.tenantId, tenantId), eq(dialogState.dialogId, dialogId)));
    const active = row?.humanActive ?? false;
    try {
      await this.redis.set(key, active ? '1' : '0', 'EX', HUMAN_FLAG_TTL_SECONDS);
    } catch {
      // Redis fora: a próxima leitura vai ao banco de novo.
    }
    return active;
  }
}
