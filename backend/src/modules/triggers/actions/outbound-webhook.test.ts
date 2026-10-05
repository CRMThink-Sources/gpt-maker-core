import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ActionError } from './action-error';
import {
  EVENT_HEADER,
  isBlockedAddress,
  sendOutboundWebhook,
  SIGNATURE_HEADER,
  signPayload,
} from './outbound-webhook';

const publicResolve = async () => ['93.184.216.34'];

describe('webhook de saída', () => {
  it('assina com timestamp e corpo, verificável pelo receptor', () => {
    const signature = signPayload('segredo', '{"a":1}', 1_700_000_000);
    const expected = createHmac('sha256', 'segredo').update('1700000000.{"a":1}').digest('hex');
    expect(signature).toBe(`t=1700000000,v1=${expected}`);
  });

  it('POST JSON com evento e assinatura, sem seguir redirecionamento', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: URL, init: RequestInit) => {
      captured = { url: String(url), init };
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await expect(
      sendOutboundWebhook(
        {
          url: 'https://hooks.exemplo.com/a',
          secret: 's',
          event: 'onFinishInteraction',
          body: { x: 1 },
        },
        { fetchFn, resolve: publicResolve, now: () => 1_700_000_000_000 },
      ),
    ).resolves.toEqual({ status: 204 });

    const headers = captured!.init.headers as Record<string, string>;
    expect(captured!.url).toBe('https://hooks.exemplo.com/a');
    expect(captured!.init).toMatchObject({ method: 'POST', redirect: 'manual', body: '{"x":1}' });
    expect(headers[EVENT_HEADER]).toBe('onFinishInteraction');
    expect(headers[SIGNATURE_HEADER]).toBe(signPayload('s', '{"x":1}', 1_700_000_000));
  });

  it.each([
    [503, true],
    [429, true],
    [400, false],
    [404, false],
    [301, false],
  ])('HTTP %i ⇒ transitória %s', async (status, transient) => {
    const fetchFn = (async () => new Response(null, { status })) as unknown as typeof fetch;
    const error = await sendOutboundWebhook(
      { url: 'https://hooks.exemplo.com', secret: 's', event: 'e', body: {} },
      { fetchFn, resolve: publicResolve },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).transient).toBe(transient);
  });

  it('rede fora: transitória', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const error = await sendOutboundWebhook(
      { url: 'https://hooks.exemplo.com', secret: 's', event: 'e', body: {} },
      { fetchFn, resolve: publicResolve },
    ).catch((e: unknown) => e);
    expect((error as ActionError).transient).toBe(true);
  });

  it.each([
    'http://127.0.0.1:3001/x',
    'http://localhost/x',
    'http://10.0.0.5/x',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x',
  ])('recusa rede privada: %s', async (url) => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return new Response(null);
    }) as unknown as typeof fetch;
    const resolve = async (host: string) => (host === 'localhost' ? ['127.0.0.1'] : []);
    const error = await sendOutboundWebhook(
      { url, secret: 's', event: 'e', body: {} },
      { fetchFn, resolve },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({
      transient: false,
      message: 'URL do webhook aponta para rede privada',
    });
    expect(called).toBe(false);
  });

  it.each([
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['100.64.0.1', true],
    ['8.8.8.8', false],
    ['::ffff:127.0.0.1', true],
    ['fd00::1', true],
    ['2606:4700::1111', false],
    ['não é ip', true],
  ])('endereço %s bloqueado: %s', (address, blocked) => {
    expect(isBlockedAddress(address)).toBe(blocked);
  });
});
