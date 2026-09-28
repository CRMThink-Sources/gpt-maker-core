import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { fieldCipher } from '../../shared/crypto/field-cipher';
import {
  isPlatformUnavailable,
  PlatformApiClient,
  PlatformError,
} from '../../shared/platform/platform-api.client';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixError } from './bitrix.errors';

export interface PortalToken {
  accessToken: string;
  expiresAt: Date;
  /** Endpoint REST do portal (`https://<domínio>/rest/`). */
  endpoint: string;
}

/** Margem antes do vencimento em que o token deixa de ser servido do cache (design D3). */
const REFRESH_MARGIN_MS = 5 * 60_000;

type Cached = { accessToken: string; expiresAt: string; endpoint: string };

/**
 * Access token do portal vindo da plataforma (`GET /v1/installations/{id}/token`), com cache
 * Redis compartilhado entre api e worker até `expiresAt - 5 min`, cifrado em repouso. O app nunca
 * renova direto no Bitrix nem persiste tokens em banco: o refresh token só existe na plataforma.
 */
@Injectable()
export class PlatformTokenProvider {
  private readonly logger = new Logger(PlatformTokenProvider.name);

  constructor(
    private readonly platform: PlatformApiClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private now(): number {
    return Date.now();
  }

  async get(installationId: number): Promise<PortalToken> {
    const cached = await this.readCache(installationId);
    if (cached && cached.expiresAt.getTime() - REFRESH_MARGIN_MS > this.now()) return cached;
    try {
      return await this.store(installationId, await this.platform.getToken(installationId));
    } catch (error) {
      // Plataforma fora do ar: o token em cache ainda vale até `expiresAt`; segue com ele.
      if (isPlatformUnavailable(error) && cached && cached.expiresAt.getTime() > this.now()) {
        this.logger.warn(
          { alert: true, installationId, err: error },
          'plataforma indisponível; usando token em cache',
        );
        return cached;
      }
      throw toBitrixError(error, 'token.get');
    }
  }

  /** Token recusado pelo Bitrix com `expired_token`: a plataforma renova (single-flight). */
  async refresh(installationId: number, staleAccessToken: string): Promise<PortalToken> {
    try {
      return await this.store(
        installationId,
        await this.platform.refreshToken(installationId, staleAccessToken),
      );
    } catch (error) {
      throw toBitrixError(error, 'token.refresh');
    }
  }

  async forget(installationId: number): Promise<void> {
    await this.redis.del(key(installationId));
  }

  private async readCache(installationId: number): Promise<PortalToken | null> {
    try {
      const raw = await this.redis.get(key(installationId));
      if (!raw) return null;
      const value = JSON.parse(fieldCipher().decrypt(raw)) as Cached;
      return { ...value, expiresAt: new Date(value.expiresAt) };
    } catch (error) {
      this.logger.warn({ installationId, err: error }, 'cache de token ilegível ou indisponível');
      return null;
    }
  }

  private async store(
    installationId: number,
    token: {
      accessToken: string;
      expiresAt: string;
      domain: string;
      clientEndpoint: string | null;
    },
  ): Promise<PortalToken> {
    const value: Cached = {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      endpoint: token.clientEndpoint ?? `https://${token.domain}/rest/`,
    };
    const ttlMs = new Date(token.expiresAt).getTime() - this.now();
    if (ttlMs > 0) {
      try {
        await this.redis.set(
          key(installationId),
          fieldCipher().encrypt(JSON.stringify(value)),
          'PX',
          ttlMs,
        );
      } catch (error) {
        this.logger.warn(
          { installationId, err: error },
          'não foi possível guardar o token no cache',
        );
      }
    }
    return { ...value, expiresAt: new Date(value.expiresAt) };
  }
}

function key(installationId: number): string {
  return `platform:token:${installationId}`;
}

function toBitrixError(error: unknown, method: string): BitrixError {
  if (!(error instanceof PlatformError)) {
    return new BitrixError('UNAVAILABLE', method, 'PLATFORM_ERROR', String(error));
  }
  const kind =
    error.status === 410
      ? 'UNINSTALLED'
      : error.status === 409
        ? 'AUTH_ERROR'
        : error.status === 404
          ? 'NOT_FOUND'
          : isPlatformUnavailable(error)
            ? 'UNAVAILABLE'
            : 'API_ERROR';
  return new BitrixError(kind, method, error.code, error.message, error.status);
}
