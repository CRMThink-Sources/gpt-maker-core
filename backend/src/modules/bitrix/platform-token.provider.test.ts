import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import { configureFieldCipher } from '../../shared/crypto/field-cipher';
import {
  PLATFORM_UNAVAILABLE,
  PlatformApiClient,
  PlatformError,
} from '../../shared/platform/platform-api.client';
import { BitrixError } from './bitrix.errors';
import { PlatformTokenProvider } from './platform-token.provider';

const NOW = new Date('2026-09-28T12:00:00Z').getTime();
const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function token(accessToken: string, expiresInMinutes: number) {
  return {
    accessToken,
    expiresAt: inMinutes(expiresInMinutes),
    domain: 'acme.bitrix24.com.br',
    clientEndpoint: null,
  };
}

describe('PlatformTokenProvider', () => {
  let redis: FakeRedis;
  let platform: { getToken: ReturnType<typeof vi.fn>; refreshToken: ReturnType<typeof vi.fn> };
  let provider: PlatformTokenProvider;

  beforeAll(() => configureFieldCipher(randomBytes(32).toString('base64')));

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    redis = new FakeRedis();
    platform = { getToken: vi.fn(), refreshToken: vi.fn() };
    provider = new PlatformTokenProvider(platform as unknown as PlatformApiClient, redis.asRedis());
  });

  afterEach(() => vi.useRealTimers());

  it('guarda no Redis cifrado e serve do cache até expiresAt - 5 min', async () => {
    platform.getToken
      .mockResolvedValueOnce(token('at-1', 60))
      .mockResolvedValueOnce(token('at-2', 60));
    const first = await provider.get(1001);
    expect(first).toMatchObject({
      accessToken: 'at-1',
      endpoint: 'https://acme.bitrix24.com.br/rest/',
    });
    const raw = redis.store.get('platform:token:1001')!.value;
    expect(raw).not.toContain('at-1');

    vi.setSystemTime(NOW + 54 * 60_000);
    expect((await provider.get(1001)).accessToken).toBe('at-1');
    vi.setSystemTime(NOW + 56 * 60_000);
    expect((await provider.get(1001)).accessToken).toBe('at-2');
    expect(platform.getToken).toHaveBeenCalledTimes(2);
  });

  it('plataforma fora do ar: segue com o token em cache ainda válido', async () => {
    platform.getToken.mockResolvedValueOnce(token('at-1', 10));
    await provider.get(1001);
    vi.setSystemTime(NOW + 7 * 60_000);
    platform.getToken.mockRejectedValueOnce(new PlatformError(0, PLATFORM_UNAVAILABLE, 'fora'));
    expect((await provider.get(1001)).accessToken).toBe('at-1');

    vi.setSystemTime(NOW + 11 * 60_000);
    platform.getToken.mockRejectedValueOnce(new PlatformError(0, PLATFORM_UNAVAILABLE, 'fora'));
    await expect(provider.get(1001)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it.each([
    [410, 'INSTALLATION_UNINSTALLED', 'UNINSTALLED'],
    [409, 'AUTH_ERROR', 'AUTH_ERROR'],
    [404, 'INSTALLATION_NOT_FOUND', 'NOT_FOUND'],
  ])('HTTP %i da plataforma ⇒ BitrixError %s', async (status, code, kind) => {
    platform.getToken.mockRejectedValueOnce(new PlatformError(status, code, 'x'));
    const error = await provider.get(1001).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BitrixError);
    expect(error).toMatchObject({ kind, code });
  });

  it('refresh substitui o cache; forget descarta', async () => {
    platform.getToken.mockResolvedValueOnce(token('at-1', 60));
    await provider.get(1001);
    platform.refreshToken.mockResolvedValueOnce(token('at-2', 60));
    expect((await provider.refresh(1001, 'at-1')).accessToken).toBe('at-2');
    expect(platform.refreshToken).toHaveBeenCalledWith(1001, 'at-1');
    expect((await provider.get(1001)).accessToken).toBe('at-2');

    await provider.forget(1001);
    expect(redis.store.has('platform:token:1001')).toBe(false);
  });

  it('Redis fora do ar não impede obter o token', async () => {
    redis.failing = true;
    platform.getToken.mockResolvedValueOnce(token('at-1', 60));
    expect((await provider.get(1001)).accessToken).toBe('at-1');
  });
});
