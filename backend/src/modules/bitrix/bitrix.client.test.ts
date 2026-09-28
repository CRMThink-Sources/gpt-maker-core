import { describe, expect, it, vi } from 'vitest';
import { RateLimitExceededError } from '../../shared/redis/rate-limiter';
import { BitrixClient, batchCommand, toQueryString } from './bitrix.client';
import type { PortalToken } from './platform-token.provider';

const portal = (accessToken: string): PortalToken => ({
  accessToken,
  expiresAt: new Date(Date.now() + 3600_000),
  endpoint: 'https://acme.bitrix24.com.br/rest/',
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(responses: Response[], acquire = vi.fn(async () => {})) {
  const tokens = {
    get: vi.fn(async () => portal('at-1')),
    refresh: vi.fn(async () => portal('at-2')),
  };
  const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('chamada inesperada');
    return next;
  });
  const client = new BitrixClient(
    tokens,
    { timeoutMs: 1000, maxAttempts: 3, acquire },
    fetchFn as typeof fetch,
  );
  const bodies = () => fetchFn.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  return { client, tokens, fetchFn, acquire, bodies };
}

describe('BitrixClient', () => {
  it('chama o endpoint do portal com o token da plataforma', async () => {
    const { client, fetchFn, bodies, acquire } = setup([
      json(200, { result: { ID: 1 }, total: 1 }),
    ]);
    await expect(client.call(1001, 'crm.lead.add', { fields: { TITLE: 'x' } })).resolves.toEqual({
      result: { ID: 1 },
      total: 1,
      next: undefined,
    });
    expect(fetchFn.mock.calls[0]![0]).toBe('https://acme.bitrix24.com.br/rest/crm.lead.add.json');
    expect(bodies()[0]).toEqual({ fields: { TITLE: 'x' }, auth: 'at-1' });
    expect(acquire).toHaveBeenCalledWith(1001);
  });

  it('expired_token ⇒ renova na plataforma e repete uma única vez', async () => {
    const { client, tokens, bodies } = setup([
      json(401, {
        error: 'expired_token',
        error_description: 'The access token provided has expired.',
      }),
      json(200, { result: true }),
    ]);
    await expect(client.call(1001, 'app.info')).resolves.toMatchObject({ result: true });
    expect(tokens.refresh).toHaveBeenCalledWith(1001, 'at-1');
    expect(bodies().map((body) => body.auth)).toEqual(['at-1', 'at-2']);
  });

  it('expired_token de novo após renovar não entra em laço', async () => {
    const { client, tokens } = setup([
      json(401, { error: 'expired_token' }),
      json(401, { error: 'expired_token' }),
    ]);
    await expect(client.call(1001, 'app.info')).rejects.toMatchObject({ code: 'expired_token' });
    expect(tokens.refresh).toHaveBeenCalledTimes(1);
  });

  it('QUERY_LIMIT_EXCEEDED é retentado; erro de negócio não', async () => {
    const limited = setup([json(503, { error: 'QUERY_LIMIT_EXCEEDED' }), json(200, { result: 1 })]);
    await expect(limited.client.call(1001, 'user.get')).resolves.toMatchObject({ result: 1 });
    expect(limited.fetchFn).toHaveBeenCalledTimes(2);

    const invalid = setup([
      json(400, { error: 'ERROR_CORE', error_description: 'campo inválido' }),
    ]);
    await expect(invalid.client.call(1001, 'crm.lead.add')).rejects.toMatchObject({
      kind: 'API_ERROR',
      code: 'ERROR_CORE',
    });
    expect(invalid.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sem vaga no rate limiter do portal ⇒ RATE_LIMITED sem chamar o Bitrix', async () => {
    const acquire = vi.fn(async () => {
      throw new RateLimitExceededError('bitrix:1001');
    });
    const { client, fetchFn } = setup([], acquire);
    await expect(client.call(1001, 'user.get')).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('batch em blocos de 50, juntando resultados e erros por comando', async () => {
    const commands = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`u${i}`, { method: 'user.get', params: { ID: i } }]),
    );
    const { client, bodies } = setup([
      json(200, {
        result: { result: { u0: [{ ID: '0' }] }, result_error: { u1: { error: 'NOT_FOUND' } } },
      }),
      json(200, { result: { result: { u50: [{ ID: '50' }] }, result_error: [] } }),
    ]);
    const result = await client.batch(1001, commands);
    expect(Object.keys(bodies()[0].cmd)).toHaveLength(50);
    expect(bodies()[1].cmd).toEqual({ u50: 'user.get?ID=50' });
    expect(bodies()[0].halt).toBe(0);
    expect(result).toEqual({
      results: { u0: [{ ID: '0' }], u50: [{ ID: '50' }] },
      errors: { u1: { error: 'NOT_FOUND' } },
    });
  });
});

describe('toQueryString / batchCommand', () => {
  it('segue o http_build_query do PHP', () => {
    expect(
      toQueryString({
        fields: { TITLE: 'Olá & cia', PHONE: [{ VALUE: '1' }] },
        flag: true,
        skip: undefined,
      }),
    ).toBe('fields%5BTITLE%5D=Ol%C3%A1%20%26%20cia&fields%5BPHONE%5D%5B0%5D%5BVALUE%5D=1&flag=1');
    expect(batchCommand({ method: 'app.info' })).toBe('app.info');
  });
});
