import { describe, expect, it, vi } from 'vitest';
import { GptMakerClient } from './gptmaker.client';
import { GptMakerResilience } from './gptmaker.resilience';

function client(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init! });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  });
  const resilience = new GptMakerResilience({
    maxAttempts: 1,
    breakerThreshold: 100,
    halfOpenAfterMs: 1000,
    beforeAttempt: async () => {},
  });
  const c = new GptMakerClient(
    {
      baseUrl: 'https://api.gptmaker.ai/v2/',
      token: 'tok-secreto',
      workspaceId: 'ws 1',
      timeoutMs: 1000,
      conversationTimeoutMs: 2000,
    },
    resilience,
    fetchFn as unknown as typeof fetch,
  );
  return { c, calls };
}

describe('GptMakerClient', () => {
  it('monta URL, método, auth e query', async () => {
    const { c, calls } = client([{ status: 200, body: [{ id: 'a1', name: '[t1] Bot' }] }]);
    const agents = await c.listWorkspaceAgents({ page: 0, pageSize: 50 });
    expect(agents).toEqual([{ id: 'a1', name: '[t1] Bot' }]);
    const { url, init } = calls[0]!;
    expect(url.toString()).toBe(
      'https://api.gptmaker.ai/v2/workspace/ws%201/agents?page=0&pageSize=50',
    );
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-secreto');
  });

  it('lista de agentes no envelope { data, count } da API real', async () => {
    const { c } = client([
      { status: 200, body: { data: [{ id: 'a1', name: '[t1] Bot' }], count: 1 } },
    ]);
    await expect(c.listWorkspaceAgents({ page: 0, pageSize: 50 })).resolves.toEqual([
      { id: 'a1', name: '[t1] Bot' },
    ]);
  });

  it('envia corpo JSON validado', async () => {
    const { c, calls } = client([{ status: 200, body: { id: 'a1', name: '[t1] Bot' } }]);
    await c.createAgent({ name: '[t1] Bot', type: 'SUPPORT', communicationType: 'NORMAL' });
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      name: '[t1] Bot',
      type: 'SUPPORT',
      communicationType: 'NORMAL',
    });
  });

  it('403 vira UNAUTHORIZED com a mensagem do provedor', async () => {
    const { c } = client([{ status: 403, body: { error: 'Token inválido' } }]);
    await expect(c.getWorkspaceCredits()).rejects.toMatchObject({
      kind: 'UNAUTHORIZED',
      status: 403,
      message: expect.stringContaining('Token inválido'),
    });
  });

  it('success=false é falha', async () => {
    const { c } = client([{ status: 200, body: { success: false } }]);
    await expect(c.activateAgent('a1')).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });

  it('resposta fora do contrato vira INVALID_RESPONSE, com o corpo recebido', async () => {
    const { c } = client([{ status: 200, body: { credits: 'muitos', status: 'ACTIVE' } }]);
    await expect(c.getWorkspaceCredits()).rejects.toMatchObject({
      kind: 'INVALID_RESPONSE',
      body: { received: { credits: 'muitos', status: 'ACTIVE' } },
    });
  });

  describe('criação de treinamento (resposta real diverge da documentada)', () => {
    const text = { type: 'TEXT' as const, text: 'Oi' };

    it.each([[{}], [undefined], [{ message: 'ok' }], [[]]])(
      'qualquer 2xx sem success=false é sucesso: %j',
      async (body) => {
        const { c } = client([{ status: 200, body }]);
        await expect(c.createTraining('a1', text)).resolves.toEqual({ id: null });
      },
    );

    it.each([
      [{ id: 'tr-1', type: 'TEXT' }],
      [{ success: true, data: { id: 'tr-1' } }],
      [{ training: { id: 'tr-1' } }],
    ])('devolve o id quando o corpo traz: %j', async (body) => {
      const { c } = client([{ status: 200, body }]);
      await expect(c.createTraining('a1', text)).resolves.toEqual({ id: 'tr-1' });
    });

    it('success=false explícito é falha', async () => {
      const { c } = client([{ status: 200, body: { success: false } }]);
      await expect(c.createTraining('a1', text)).rejects.toMatchObject({ kind: 'UNKNOWN' });
    });
  });

  it('lê Retry-After do 429', async () => {
    const { c } = client([{ status: 429, body: { error: 'x' }, headers: { 'retry-after': '3' } }]);
    await expect(c.getAgent('a1')).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      retryAfterMs: 3000,
    });
  });

  it('recusa corpo de conversa inválido sem chamar o provedor', async () => {
    const { c, calls } = client([]);
    await expect(c.sendMessage('a1', { contextId: '', prompt: 'oi' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('não expõe o token na mensagem de erro', async () => {
    const { c } = client([{ status: 400, body: { error: 'Erro inesperado' } }]);
    const error = await c.getAgent('a1').catch((e: Error) => e);
    expect(JSON.stringify({ message: error.message, ...error })).not.toContain('tok-secreto');
  });
});
