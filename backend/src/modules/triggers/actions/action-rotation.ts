import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../../shared/redis/redis.module';

/**
 * Rodízio de usuários numa ação (design D15): cada execução vai para o próximo da lista. A
 * contagem é por ação (`rotation:<id da ação>`) e não expira; editar a lista só muda o ciclo.
 */
@Injectable()
export class ActionRotation {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async next(actionId: string, ids: readonly number[]): Promise<number> {
    if (ids.length === 1) return ids[0]!;
    const turn = await this.redis.incr(`rotation:${actionId}`);
    return ids[(turn - 1) % ids.length]!;
  }
}
