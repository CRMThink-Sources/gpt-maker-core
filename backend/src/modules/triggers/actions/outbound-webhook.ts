import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ActionError } from './action-error';

const TIMEOUT_MS = 10_000;

/** Cabeçalho da assinatura: `t=<unix>,v1=<hex HMAC-SHA256 de "<t>.<corpo>">`. */
export const SIGNATURE_HEADER = 'X-GPTMaker-Signature';
export const EVENT_HEADER = 'X-GPTMaker-Event';

/** Assinatura no estilo do Stripe: o timestamp entra no HMAC, e o receptor recusa os antigos. */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/** Endereços que a URL de um cliente não pode atingir (rede interna, loopback, metadados). */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    if (mapped) return isBlockedAddress(mapped);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      lower.startsWith('ff')
    );
  }
  return true;
}

export interface OutboundWebhookInput {
  url: string;
  secret: string;
  event: string;
  body: Record<string, unknown>;
}

/**
 * Webhook de saída do gatilho (spec agent-triggers): POST JSON com o evento, assinado com o
 * segredo da ação. Destino em rede privada é recusado (o servidor não pode virar ponte para a
 * rede interna) e redirecionamentos não são seguidos. 2xx ⇒ sucesso; 5xx, 429, rede e tempo
 * esgotado ⇒ falha transitória (retentada na 10.7); demais 4xx ⇒ definitiva.
 */
export async function sendOutboundWebhook(
  input: OutboundWebhookInput,
  deps: {
    fetchFn?: typeof fetch;
    resolve?: (host: string) => Promise<string[]>;
    now?: () => number;
  } = {},
): Promise<{ status: number }> {
  const fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init));
  const resolve =
    deps.resolve ??
    (async (host: string) => (await lookup(host, { all: true })).map((entry) => entry.address));

  const url = new URL(input.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ActionError('URL do webhook precisa ser http ou https', { transient: false });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch (error) {
    throw new ActionError(`endereço do webhook não encontrado: ${host}`, {
      transient: true,
      cause: error,
    });
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new ActionError('URL do webhook aponta para rede privada', { transient: false });
  }

  const body = JSON.stringify(input.body);
  const timestamp = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GPTMaker-Conector-Webhook/1',
        [EVENT_HEADER]: input.event,
        [SIGNATURE_HEADER]: signPayload(input.secret, body, timestamp),
      },
      body,
    });
  } catch (error) {
    throw new ActionError('webhook de saída sem resposta', { transient: true, cause: error });
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.ok) return { status: response.status };
  throw new ActionError(`webhook de saída respondeu HTTP ${response.status}`, {
    transient: response.status >= 500 || response.status === 429,
  });
}
