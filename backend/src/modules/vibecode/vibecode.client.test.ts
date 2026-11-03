import { describe, expect, it, vi } from 'vitest';
import { VibecodeClient } from './vibecode.client';
import { VibecodeError } from './vibecode.errors';

const KEY = 'vibe_api_segredo123';

interface Reply {
  status: number;
  body?: unknown;
  /** Corpo cru (não JSON). */
  text?: string;
  headers?: Record<string, string>;
}

function setup(replies: Array<Reply | 'network'>, options: { maxAttempts?: number } = {}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const sleeps: number[] = [];
  const fetchFn = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init! });
    const next = replies.shift() ?? { status: 200, body: {} };
    if (next === 'network') throw new TypeError('fetch failed');
    const raw = next.text ?? (next.body === undefined ? null : JSON.stringify(next.body));
    return new Response(raw, { status: next.status, headers: next.headers });
  });
  const client = new VibecodeClient(
    { baseUrl: 'https://vibecode.bitrix24.com/', timeoutMs: 1000, ...options },
    fetchFn as unknown as typeof fetch,
    async (ms) => {
      sleeps.push(ms);
    },
  );
  return { client, calls, sleeps, fetchFn };
}

const ok = (content: string, usage?: unknown) => ({
  status: 200,
  body: { choices: [{ message: { role: 'assistant', content } }], ...(usage ? { usage } : {}) },
});

const input = {
  apiKey: KEY,
  model: 'bitrix/bitrixgpt-5.5',
  messages: [
    { role: 'system' as const, content: 'Você revisa textos.' },
    { role: 'user' as const, content: 'Revise.' },
  ],
};

async function failure(promise: Promise<unknown>): Promise<VibecodeError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VibecodeError);
    return error as VibecodeError;
  }
  throw new Error('esperava falha');
}

describe('VibecodeClient.chat', () => {
  it('monta URL, auth e corpo no contrato da OpenAI', async () => {
    const { client, calls } = setup([
      ok('{"summary":"ok"}', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
    ]);
    const result = await client.chat({ ...input, temperature: 0.2, json: true });
    expect(result).toEqual({
      content: '{"summary":"ok"}',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const { url, init } = calls[0]!;
    expect(url.toString()).toBe('https://vibecode.bitrix24.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'bitrix/bitrixgpt-5.5',
      messages: input.messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
  });

  it('não pede JSON nem temperatura quando não informados', async () => {
    const { client, calls } = setup([ok('texto')]);
    await client.chat(input);
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty('response_format');
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty('temperature');
  });

  it('resposta sem texto ou fora do formato vira AI_UNAVAILABLE, sem repetir', async () => {
    for (const reply of [
      { status: 200, body: { choices: [{ message: { content: null } }] } },
      { status: 200, body: { choices: [] } },
      { status: 200, text: 'não é json' },
    ]) {
      const { client, fetchFn } = setup([reply]);
      const error = await failure(client.chat(input));
      expect(error.code).toBe('AI_UNAVAILABLE');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });
});

describe('tradução dos erros', () => {
  // [status, código do Vibecode, código da revisão]; nenhum desses tenta de novo.
  it.each([
    [401, undefined, 'AI_KEY_INVALID'],
    [403, 'scope_missing', 'AI_KEY_SCOPE'],
    [403, undefined, 'AI_KEY_INVALID'],
    [402, 'insufficient_balance', 'AI_NO_BALANCE'],
    [402, 'ai_quota_exhausted', 'AI_NO_BALANCE'],
    [402, 'ai_credentials_not_configured', 'AI_MODEL_UNAVAILABLE'],
    [402, undefined, 'AI_NO_BALANCE'],
    [404, 'ai_model_not_found', 'AI_MODEL_UNAVAILABLE'],
    [503, 'model_unavailable', 'AI_MODEL_UNAVAILABLE'],
    [413, 'ai_payload_too_large', 'AI_FIELD_TOO_LARGE'],
    [400, 'ai_provider_rejected', 'AI_UNAVAILABLE'],
    [400, 'qualquer_outro', 'AI_UNAVAILABLE'],
  ])('%i %s vira %s e não tenta de novo', async (status, code, expected) => {
    const { client, fetchFn, sleeps } = setup([
      { status, body: code ? { error: { code, message: 'x' } } : { error: 'x' } },
    ]);
    const error = await failure(client.chat(input));
    expect(error.code).toBe(expected);
    expect(error.status).toBe(status);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it.each([
    ['{ error: { code } }', { error: { code: 'insufficient_balance' } }],
    ['{ code }', { code: 'insufficient_balance' }],
    ['{ error: "code" }', { error: 'insufficient_balance' }],
  ])('lê o código do corpo no formato %s', async (_name, body) => {
    const { client } = setup([{ status: 402, body }]);
    const error = await failure(client.chat(input));
    expect(error.vibecodeCode).toBe('insufficient_balance');
  });

  it('corpo que não é JSON cai no status', async () => {
    const { client } = setup([{ status: 401, text: '<html>nope</html>' }]);
    expect((await failure(client.chat(input))).code).toBe('AI_KEY_INVALID');
  });

  it('nunca expõe a chave na mensagem do erro', async () => {
    const { client } = setup([
      { status: 401, body: { error: { message: `chave ${KEY} inválida` } } },
    ]);
    const error = await failure(client.chat(input));
    expect(error.message).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
  });
});

describe('novas tentativas', () => {
  it.each([
    [429, 'ai_congested'],
    [429, 'rate_limit_exceeded'],
    [502, 'ai_provider_unavailable'],
    [503, 'ai_provider_timeout'],
    [500, undefined],
  ])('%i %s: tenta 3 vezes e vira AI_UNAVAILABLE', async (status, code) => {
    const reply = { status, body: code ? { error: { code } } : {} };
    const { client, fetchFn, sleeps } = setup([reply, reply, reply]);
    const error = await failure(client.chat(input));
    expect(error.code).toBe('AI_UNAVAILABLE');
    expect(error.status).toBe(status);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('respeita o Retry-After e o teto da espera', async () => {
    const { client, sleeps } = setup([
      { status: 429, body: { error: { code: 'ai_congested' } }, headers: { 'Retry-After': '2' } },
      { status: 429, body: { error: { code: 'ai_congested' } }, headers: { 'Retry-After': '90' } },
      ok('depois de esperar'),
    ]);
    expect((await client.chat(input)).content).toBe('depois de esperar');
    expect(sleeps).toEqual([2000, 10_000]);
  });

  it('segue quando uma nova tentativa dá certo', async () => {
    const { client, fetchFn } = setup([
      { status: 503, body: { error: { code: 'ai_provider_timeout' } } },
      ok('ok'),
    ]);
    expect((await client.chat(input)).content).toBe('ok');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('falha de rede também tenta de novo', async () => {
    const { client, fetchFn } = setup(['network', 'network', 'network']);
    const error = await failure(client.chat(input));
    expect(error.code).toBe('AI_UNAVAILABLE');
    expect(error.status).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('respeita o número de tentativas configurado', async () => {
    const reply = { status: 503, body: {} };
    const { client, fetchFn } = setup([reply, reply, reply], { maxAttempts: 1 });
    await failure(client.chat(input));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('VibecodeClient.listModels e scopes', () => {
  it('lista os ids nos dois formatos', async () => {
    const { client, calls } = setup([
      {
        status: 200,
        body: { object: 'list', data: [{ id: 'bitrix/bitrixgpt-5.5' }, { id: 'bitrix/b' }] },
      },
      { status: 200, body: [{ id: 'bitrix/bitrixgpt-5.5' }] },
    ]);
    expect(await client.listModels(KEY)).toEqual(['bitrix/bitrixgpt-5.5', 'bitrix/b']);
    expect(await client.listModels(KEY)).toEqual(['bitrix/bitrixgpt-5.5']);
    expect(calls[0]!.url.toString()).toBe('https://vibecode.bitrix24.com/v1/models');
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init).not.toHaveProperty('body');
  });

  it('lê os escopos de /v1/me, soltos ou em data, e devolve null sem eles', async () => {
    const { client, calls } = setup([
      { status: 200, body: { type: 'api_key', scopes: ['vibe:ai'] } },
      { status: 200, body: { data: { scopes: ['vibe:ai', 'crm'] } } },
      { status: 200, body: { type: 'api_key' } },
    ]);
    expect(await client.scopes(KEY)).toEqual(['vibe:ai']);
    expect(await client.scopes(KEY)).toEqual(['vibe:ai', 'crm']);
    expect(await client.scopes(KEY)).toBeNull();
    expect(calls[0]!.url.toString()).toBe('https://vibecode.bitrix24.com/v1/me');
  });

  it('lista com resposta fora do formato vira AI_UNAVAILABLE', async () => {
    const { client } = setup([{ status: 200, body: { models: 'x' } }]);
    expect((await failure(client.listModels(KEY))).code).toBe('AI_UNAVAILABLE');
  });

  it('chave inválida na listagem vira AI_KEY_INVALID', async () => {
    const { client } = setup([{ status: 401, body: { error: { code: 'invalid_key' } } }]);
    expect((await failure(client.listModels(KEY))).code).toBe('AI_KEY_INVALID');
  });
});
