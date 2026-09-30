import { describe, expect, it, vi } from 'vitest';
import { isPlatformUnavailable, PlatformApiClient, PlatformError } from './platform-api.client';

const token = {
  accessToken: 'at-1',
  expiresAt: '2026-09-28T13:00:00.000Z',
  domain: 'acme.bitrix24.com.br',
  clientEndpoint: 'https://acme.bitrix24.com.br/rest/',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetchFn: typeof fetch) {
  return new PlatformApiClient(
    { baseUrl: 'https://platform.test/', apiKey: 'key-1', timeoutMs: 1000, maxAttempts: 3 },
    fetchFn,
  );
}

describe('PlatformApiClient', () => {
  it('GET /v1/installations/{id}/token com a chave do app', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      json(200, token),
    );
    await expect(client(fetchFn as typeof fetch).getToken(1001)).resolves.toEqual(token);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://platform.test/v1/installations/1001/token');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer key-1');
  });

  it('não serve token do cache em memória do SDK: o cache é o Redis', async () => {
    const fetchFn = vi.fn(async () => json(200, token));
    const platform = client(fetchFn as typeof fetch);
    await platform.getToken(1001);
    await platform.getToken(1001);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('POST .../token/refresh com o token recusado', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      json(200, token),
    );
    await client(fetchFn as typeof fetch).refreshToken(1001, 'stale');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(url).toBe('https://platform.test/v1/installations/1001/token/refresh');
    expect(JSON.parse(String(init?.body))).toEqual({ staleAccessToken: 'stale' });
  });

  it.each([
    [410, 'INSTALLATION_UNINSTALLED'],
    [409, 'AUTH_ERROR'],
    [404, 'INSTALLATION_NOT_FOUND'],
  ])('HTTP %i vira PlatformError com o código estável, sem retentar', async (status, code) => {
    const fetchFn = vi.fn(async () => json(status, { error: { code, message: 'x' } }));
    const error = await client(fetchFn as typeof fetch)
      .getToken(1001)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlatformError);
    expect(error).toMatchObject({ status, code });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retenta 5xx e falha de rede; esgotado, PLATFORM_UNAVAILABLE', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, token));
    await expect(client(fetchFn as typeof fetch).getToken(1001)).resolves.toEqual(token);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const down = vi.fn(async () => json(502, {}));
    const error = await client(down as typeof fetch)
      .getToken(1001)
      .catch((e: unknown) => e);
    expect(isPlatformUnavailable(error)).toBe(true);
    expect(down).toHaveBeenCalledTimes(3);
  });
});
