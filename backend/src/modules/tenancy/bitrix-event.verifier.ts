import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import { fieldCipher } from '../../shared/crypto/field-cipher';
import { PlatformApiClient } from '../../shared/platform/platform-api.client';
import { REDIS } from '../../shared/redis/redis.module';
import { type Tenant, TenantService } from './tenant.service';

const CACHE_TTL_SECONDS = 60 * 60;

export type BitrixEventCheck =
  | { ok: true; tenant: Tenant }
  | { ok: false; reason: 'missing_auth' | 'unknown_portal' | 'inactive' | 'token_mismatch' };

/** Impressão digital curta de um token para o log: identifica sem expor o valor. */
export function tokenFingerprint(token: string | null | undefined): string | null {
  return token ? createHash('sha256').update(token).digest('hex').slice(0, 8) : null;
}

/** Compara em tempo constante sem vazar o tamanho (digests de mesmo tamanho). */
export function sameToken(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * Autentica eventos que o portal envia ao app (spec bitrix-app-installation): o
 * `auth[application_token]` precisa ser igual ao da instalação, lido de
 * `GET /v1/installations/{id}` da plataforma com cache Redis de 1h (cifrado), invalidado no
 * instalador e em `installation.reinstalled`.
 */
@Injectable()
export class BitrixEventVerifier {
  private readonly logger = new Logger(BitrixEventVerifier.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly platform: PlatformApiClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async verify(
    auth: { member_id?: unknown; application_token?: unknown } | undefined,
  ): Promise<BitrixEventCheck> {
    const memberId = typeof auth?.member_id === 'string' ? auth.member_id : '';
    const token = typeof auth?.application_token === 'string' ? auth.application_token : '';
    if (!memberId || !token) return this.reject('missing_auth', memberId);

    const tenant = await this.tenants.findByMemberId(memberId);
    if (!tenant) return this.reject('unknown_portal', memberId);
    if (tenant.status === 'UNINSTALLED') return this.reject('inactive', memberId);

    const expected = await this.applicationToken(Number(tenant.installationId));
    if (!expected || !sameToken(token, expected)) {
      return this.reject('token_mismatch', memberId, {
        received: tokenFingerprint(token),
        expected: tokenFingerprint(expected),
        installationId: Number(tenant.installationId),
      });
    }
    return { ok: true, tenant };
  }

  async invalidate(installationId: number): Promise<void> {
    await this.redis.del(cacheKey(installationId));
  }

  private async applicationToken(installationId: number): Promise<string | null> {
    try {
      const cached = await this.redis.get(cacheKey(installationId));
      if (cached) return fieldCipher().decrypt(cached);
    } catch (error) {
      this.logger.warn({ installationId, err: error }, 'cache do application_token indisponível');
    }
    const installation = await this.platform.getInstallation(installationId);
    const token = installation.applicationToken;
    if (token) {
      await this.redis
        .set(cacheKey(installationId), fieldCipher().encrypt(token), 'EX', CACHE_TTL_SECONDS)
        .catch((error: unknown) =>
          this.logger.warn({ installationId, err: error }, 'falha ao guardar application_token'),
        );
    }
    return token;
  }

  private reject(
    reason: Exclude<BitrixEventCheck, { ok: true }>['reason'],
    memberId: string,
    details: Record<string, unknown> = {},
  ): BitrixEventCheck {
    this.logger.warn(
      { alert: 'security', reason, memberId, ...details },
      'evento do Bitrix recusado',
    );
    return { ok: false, reason };
  }
}

function cacheKey(installationId: number): string {
  return `platform:app-token:${installationId}`;
}
