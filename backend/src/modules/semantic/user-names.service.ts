import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient } from '../bitrix';
import type { PortalRef } from './field-catalog.service';

const TTL_SECONDS = 3600;
const key = (tenantId: string, id: string) => `semantic:user:${tenantId}:${id}`;

/**
 * Nome dos usuários do portal (responsável, criado por...), para o agente nunca ver o id. Lidos
 * em `batch` com `user.get` e guardados por 1 h; usuário não encontrado fica sem nome (omitido).
 */
@Injectable()
export class UserNamesService {
  private readonly logger = new Logger(UserNamesService.name);

  constructor(
    private readonly bitrix: BitrixClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async resolve(portal: PortalRef, ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const cached = await this.redis.get(key(portal.tenantId, id)).catch(() => null);
      if (cached) names.set(id, cached);
      else missing.push(id);
    }
    if (!missing.length) return names;

    const { results } = await this.bitrix.batch(
      portal.installationId,
      Object.fromEntries(
        missing.map((id) => [`user_${id}`, { method: 'user.get', params: { ID: id } }]),
      ),
    );
    for (const id of missing) {
      const [user] = (results[`user_${id}`] ?? []) as Array<{ NAME?: string; LAST_NAME?: string }>;
      const name = [user?.NAME, user?.LAST_NAME].filter(Boolean).join(' ').trim();
      if (!name) continue;
      names.set(id, name);
      await this.redis
        .set(key(portal.tenantId, id), name, 'EX', TTL_SECONDS)
        .catch((error: unknown) =>
          this.logger.warn({ err: error }, 'cache de usuários indisponível'),
        );
    }
    return names;
  }
}
