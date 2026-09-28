import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import { configureFieldCipher } from '../../shared/crypto/field-cipher';
import type { PlatformApiClient } from '../../shared/platform/platform-api.client';
import { BitrixEventVerifier, sameToken } from './bitrix-event.verifier';
import type { Tenant, TenantService } from './tenant.service';

const tenant = { id: 't-1', installationId: '1001', memberId: 'm-1', status: 'ACTIVE' } as Tenant;

describe('BitrixEventVerifier', () => {
  let redis: FakeRedis;
  let getInstallation: ReturnType<typeof vi.fn>;
  let findByMemberId: ReturnType<typeof vi.fn>;
  let verifier: BitrixEventVerifier;

  beforeAll(() => configureFieldCipher(randomBytes(32).toString('base64')));

  beforeEach(() => {
    redis = new FakeRedis();
    getInstallation = vi.fn(async () => ({ applicationToken: 'app-token-1' }));
    findByMemberId = vi.fn(async (memberId: string) => (memberId === 'm-1' ? tenant : undefined));
    verifier = new BitrixEventVerifier(
      { findByMemberId } as unknown as TenantService,
      { getInstallation } as unknown as PlatformApiClient,
      redis.asRedis(),
    );
  });

  it('aceita o application_token da instalação e guarda em cache por 1h', async () => {
    const auth = { member_id: 'm-1', application_token: 'app-token-1' };
    await expect(verifier.verify(auth)).resolves.toEqual({ ok: true, tenant });
    await expect(verifier.verify(auth)).resolves.toMatchObject({ ok: true });
    expect(getInstallation).toHaveBeenCalledTimes(1);
    expect(getInstallation).toHaveBeenCalledWith(1001);
    expect(redis.ttl('platform:app-token:1001')).toBeGreaterThan(3590_000);
  });

  it.each([
    [{ member_id: 'm-1', application_token: 'outro' }, 'token_mismatch'],
    [{ member_id: 'm-9', application_token: 'app-token-1' }, 'unknown_portal'],
    [{ member_id: 'm-1' }, 'missing_auth'],
    [undefined, 'missing_auth'],
  ])('recusa %o (%s)', async (auth, reason) => {
    await expect(verifier.verify(auth)).resolves.toEqual({ ok: false, reason });
  });

  it('recusa portal desinstalado e instalação sem application_token', async () => {
    findByMemberId.mockResolvedValueOnce({ ...tenant, status: 'UNINSTALLED' });
    await expect(
      verifier.verify({ member_id: 'm-1', application_token: 'app-token-1' }),
    ).resolves.toEqual({ ok: false, reason: 'inactive' });

    getInstallation.mockResolvedValueOnce({ applicationToken: null });
    await expect(
      verifier.verify({ member_id: 'm-1', application_token: 'app-token-1' }),
    ).resolves.toEqual({ ok: false, reason: 'token_mismatch' });
  });

  it('invalidate força nova leitura na plataforma', async () => {
    const auth = { member_id: 'm-1', application_token: 'app-token-1' };
    await verifier.verify(auth);
    await verifier.invalidate(1001);
    getInstallation.mockResolvedValueOnce({ applicationToken: 'app-token-2' });
    await expect(verifier.verify(auth)).resolves.toEqual({ ok: false, reason: 'token_mismatch' });
  });

  it('sameToken compara conteúdo, inclusive com tamanhos diferentes', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abcd')).toBe(false);
  });
});
