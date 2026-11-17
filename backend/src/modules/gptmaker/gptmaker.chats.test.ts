import { describe, expect, it, vi } from 'vitest';
import { GptMakerClient } from './gptmaker.client';
import { GptMakerError } from './gptmaker.errors';
import { GptMakerResilience } from './gptmaker.resilience';

function client(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init! });
    const next = responses.shift() ?? { status: 200, body: [] };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
    });
  });
  const c = new GptMakerClient(
    {
      baseUrl: 'https://api.gptmaker.ai/v2/',
      token: 'tok',
      workspaceId: 'ws 1',
      timeoutMs: 1000,
      conversationTimeoutMs: 2000,
    },
    new GptMakerResilience({
      maxAttempts: 1,
      breakerThreshold: 100,
      halfOpenAfterMs: 1000,
      beforeAttempt: async () => {},
    }),
    fetchFn as unknown as typeof fetch,
  );
  return { c, calls };
}

const chat = (id: string) => ({
  id,
  recipient: 't1:d1',
  type: 'API',
  createdAt: 1_700_000_000,
});

describe('listChats', () => {
  it('monta a rota do workspace com agente e paginação', async () => {
    const { c, calls } = client([{ status: 200, body: [chat('public-api-a1-t1:d1')] }]);

    const chats = await c.listChats({ agentId: 'a 1', page: 0, pageSize: 50 });

    expect(chats).toHaveLength(1);
    expect(calls[0]!.url.toString()).toBe(
      'https://api.gptmaker.ai/v2/workspace/ws%201/chats?agentId=a+1&page=0&pageSize=50',
    );
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('aceita o array simples da doc e o envelope { data, count } da API real', async () => {
    const simple = client([{ status: 200, body: [chat('c1')] }]);
    const envelope = client([{ status: 200, body: { data: [chat('c1')], count: 1 } }]);

    expect(await simple.c.listChats()).toEqual([chat('c1')]);
    expect(await envelope.c.listChats()).toEqual([chat('c1')]);
  });

  it('página vazia devolve lista vazia', async () => {
    const { c } = client([{ status: 200, body: [] }]);
    expect(await c.listChats({ page: 5 })).toEqual([]);
  });

  it('só exige o id do chat; o resto pode faltar', async () => {
    const { c } = client([{ status: 200, body: [{ id: 'c1' }] }]);
    expect(await c.listChats()).toEqual([{ id: 'c1' }]);
  });

  it('token inválido (403) vira UNAUTHORIZED', async () => {
    const { c } = client([{ status: 403, body: { error: 'Erro de token' } }]);
    const error = await c.listChats().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GptMakerError);
    expect((error as GptMakerError).kind).toBe('UNAUTHORIZED');
  });

  it('resposta fora do contrato vira INVALID_RESPONSE', async () => {
    const { c } = client([{ status: 200, body: [{ semId: true }] }]);
    const error = await c.listChats().catch((e: unknown) => e);
    expect((error as GptMakerError).kind).toBe('INVALID_RESPONSE');
  });
});

describe('listChatMessages', () => {
  it('codifica o chatId na rota e envia a paginação', async () => {
    const { c, calls } = client([{ status: 200, body: [] }]);

    await c.listChatMessages('public-api-a1-t1:d/1', { page: 1, pageSize: 30 });

    expect(calls[0]!.url.toString()).toBe(
      'https://api.gptmaker.ai/v2/chat/public-api-a1-t1%3Ad%2F1/messages?page=1&pageSize=30',
    );
  });

  it('lê mensagens de texto e de mídia (texto ausente ou nulo)', async () => {
    const { c } = client([
      {
        status: 200,
        body: [
          { id: 'm1', role: 'user', type: 'text', text: 'Oi', time: 1_700_000_000 },
          { id: 'm2', role: 'assistant', text: null, imageUrl: 'https://x.test/a.png' },
          { id: 'm3', role: 'assistant' },
        ],
      },
    ]);

    const messages = await c.listChatMessages('c1');

    expect(messages.map((m) => [m.id, m.role, m.text ?? null])).toEqual([
      ['m1', 'user', 'Oi'],
      ['m2', 'assistant', null],
      ['m3', 'assistant', null],
    ]);
  });

  it('aceita o envelope { data, count }', async () => {
    const { c } = client([
      { status: 200, body: { data: [{ id: 'm1', role: 'user', text: 'Oi' }], count: 1 } },
    ]);
    expect(await c.listChatMessages('c1')).toHaveLength(1);
  });

  it('mensagem sem papel é fora do contrato', async () => {
    const { c } = client([{ status: 200, body: [{ id: 'm1', text: 'Oi' }] }]);
    const error = await c.listChatMessages('c1').catch((e: unknown) => e);
    expect((error as GptMakerError).kind).toBe('INVALID_RESPONSE');
  });

  it('chat inexistente (404) vira NOT_FOUND', async () => {
    const { c } = client([{ status: 404, body: { error: 'não encontrado' } }]);
    const error = await c.listChatMessages('c1').catch((e: unknown) => e);
    expect((error as GptMakerError).kind).toBe('NOT_FOUND');
  });
});
