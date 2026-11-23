import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformSessionClient } from './platform-session';

vi.mock('./bx24', () => ({
  bx24Auth: async () => ({ access_token: 'a', domain: 'd.bitrix24.com', member_id: 'm' }),
}));

const config = {
  platformUrl: 'https://platform.test',
  appCode: 'app',
  apiBaseUrl: 'https://api.test',
  stripePublishableKey: null,
  supportUrl: null,
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/v1/sessions')) {
      return Response.json({
        token: 'jwt',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    return Response.json({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Cabeçalhos da última chamada à API do app (não à plataforma). */
function apiHeaders(): Headers {
  const call = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://api.test'));
  return new Headers((call.at(-1)![1] as RequestInit).headers);
}

describe('idioma nas chamadas à API (spec function-template-i18n)', () => {
  it('envia o idioma ativo em Accept-Language', async () => {
    const client = new PlatformSessionClient(config);
    client.setLocale('en');
    await client.api('/app/agent-functions');
    expect(apiHeaders().get('Accept-Language')).toBe('en');
  });

  it('acompanha a troca de idioma a partir da próxima chamada', async () => {
    const client = new PlatformSessionClient(config);
    client.setLocale('en');
    await client.api('/app/agent-functions');
    client.setLocale('es');
    await client.api('/app/agent-functions');
    expect(apiHeaders().get('Accept-Language')).toBe('es');
  });

  it('sem idioma definido, não envia o cabeçalho', async () => {
    const client = new PlatformSessionClient(config);
    await client.api('/app/agent-functions');
    expect(apiHeaders().has('Accept-Language')).toBe(false);
  });

  it('respeita um Accept-Language já informado na chamada', async () => {
    const client = new PlatformSessionClient(config);
    client.setLocale('en');
    await client.api('/x', { headers: { 'Accept-Language': 'pt-BR' } });
    expect(apiHeaders().get('Accept-Language')).toBe('pt-BR');
  });

  it('não manda o idioma para a plataforma de sessões', async () => {
    const client = new PlatformSessionClient(config);
    client.setLocale('en');
    await client.api('/app/session');
    const platform = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v1/sessions'))!;
    expect(new Headers((platform[1] as RequestInit).headers).has('Accept-Language')).toBe(false);
  });
});
