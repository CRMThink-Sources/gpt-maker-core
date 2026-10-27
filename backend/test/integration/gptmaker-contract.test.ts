import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { WireMock } from '../support/wiremock';

// Contrato de cada rota conforme docs/gptmaker-api.md (OpenAPI oficial do GPTMaker).
const TOKEN = 'test-token';
const WS = 'ws-1';
const auth = { Authorization: { equalTo: `Bearer ${TOKEN}` } };
const json = (body: unknown) => ({ equalToJson: JSON.stringify(body) });
const ok = (jsonBody: unknown) => ({ status: 200, jsonBody });

describe('contrato GPTMaker v2 (WireMock)', () => {
  let wiremock: WireMock;
  let client: GptMakerClient;

  beforeAll(async () => {
    wiremock = await WireMock.start();
    client = new GptMakerClient(
      {
        baseUrl: `${wiremock.baseUrl}/v2`,
        token: TOKEN,
        workspaceId: WS,
        timeoutMs: 5000,
        conversationTimeoutMs: 5000,
      },
      new GptMakerResilience({
        maxAttempts: 2,
        breakerThreshold: 50,
        halfOpenAfterMs: 1000,
        beforeAttempt: async () => {},
      }),
    );
  });

  afterEach(async () => {
    expect(await wiremock.unmatched()).toEqual([]);
    await wiremock.reset();
  });

  afterAll(async () => {
    await wiremock?.stop();
  });

  const agentBody = {
    id: 'ag-1',
    name: '[t1] Bot',
    status: 'ACTIVE',
    behavior: 'Atenda bem',
    avatar: 'https://x/a.png',
    communicationType: 'NORMAL',
    type: 'SUPPORT',
    jobName: 'ACME',
    jobSite: 'https://acme',
    jobDescription: 'Loja',
  };

  it('GET /v2/workspaces', async () => {
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/workspaces', headers: auth },
      response: ok([{ id: WS, name: 'Partner' }]),
    });
    await expect(client.listWorkspaces()).resolves.toEqual([{ id: WS, name: 'Partner' }]);
  });

  it('GET /v2/workspace/{id}/credits', async () => {
    await wiremock.stub({
      request: { method: 'GET', urlPath: `/v2/workspace/${WS}/credits`, headers: auth },
      response: ok({ credits: 12345, status: 'ACTIVE' }),
    });
    await expect(client.getWorkspaceCredits()).resolves.toEqual({
      credits: 12345,
      status: 'ACTIVE',
    });
  });

  it('GET /v2/workspace/{id}/agents com paginação', async () => {
    await wiremock.stub({
      request: {
        method: 'GET',
        urlPath: `/v2/workspace/${WS}/agents`,
        headers: auth,
        queryParameters: { page: { equalTo: '1' }, pageSize: { equalTo: '50' } },
      },
      response: ok([agentBody]),
    });
    await expect(client.listWorkspaceAgents({ page: 1, pageSize: 50 })).resolves.toEqual([
      agentBody,
    ]);
  });

  it('POST /v2/workspace/{id}/agents', async () => {
    const input = {
      name: '[t1] Bot',
      behavior: 'Atenda bem',
      communicationType: 'NORMAL' as const,
      type: 'SUPPORT' as const,
      jobName: 'ACME',
    };
    await wiremock.stub({
      request: {
        method: 'POST',
        urlPath: `/v2/workspace/${WS}/agents`,
        headers: { ...auth, 'Content-Type': { contains: 'application/json' } },
        bodyPatterns: [json(input)],
      },
      response: ok(agentBody),
    });
    await expect(client.createAgent(input)).resolves.toMatchObject({ id: 'ag-1' });
  });

  it('GET, PUT e DELETE /v2/agent/{id}', async () => {
    const update = {
      name: '[t1] Novo',
      communicationType: 'FORMAL' as const,
      type: 'SALE' as const,
    };
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/agent/ag-1', headers: auth },
      response: ok(agentBody),
    });
    await wiremock.stub({
      request: {
        method: 'PUT',
        urlPath: '/v2/agent/ag-1',
        headers: auth,
        bodyPatterns: [json(update)],
      },
      response: ok({ ...agentBody, ...update }),
    });
    await wiremock.stub({
      request: { method: 'DELETE', urlPath: '/v2/agent/ag-1', headers: auth },
      response: ok({ success: true }),
    });
    await expect(client.getAgent('ag-1')).resolves.toMatchObject({ name: '[t1] Bot' });
    await expect(client.updateAgent('ag-1', update)).resolves.toMatchObject({ name: '[t1] Novo' });
    await expect(client.deleteAgent('ag-1')).resolves.toBeUndefined();
  });

  it('PUT /v2/agent/{id}/active e /inactive', async () => {
    for (const action of ['active', 'inactive']) {
      await wiremock.stub({
        request: { method: 'PUT', urlPath: `/v2/agent/ag-1/${action}`, headers: auth },
        response: ok({ success: true }),
      });
    }
    await client.activateAgent('ag-1');
    await client.inactivateAgent('ag-1');
    expect(await wiremock.count('PUT', '/v2/agent/ag-1/active')).toBe(1);
    expect(await wiremock.count('PUT', '/v2/agent/ag-1/inactive')).toBe(1);
  });

  it('GET e PUT /v2/agent/{id}/settings com prefferModel', async () => {
    const settings = {
      prefferModel: 'GPT_5_MINI',
      enabledHumanTransfer: true,
      maxDailyMessages: 100 as const,
    };
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/agent/ag-1/settings', headers: auth },
      response: ok({ ...settings, timezone: 'America/Sao_Paulo', maxDailyMessages: null }),
    });
    await wiremock.stub({
      request: {
        method: 'PUT',
        urlPath: '/v2/agent/ag-1/settings',
        headers: auth,
        bodyPatterns: [json(settings)],
      },
      response: ok({ success: true }),
    });
    await expect(client.getAgentSettings('ag-1')).resolves.toMatchObject({
      prefferModel: 'GPT_5_MINI',
    });
    await expect(client.updateAgentSettings('ag-1', settings)).resolves.toBeUndefined();
  });

  it('treinamentos: listar por tipo, criar, editar texto e remover', async () => {
    const document = {
      type: 'DOCUMENT' as const,
      documentUrl: 'https://storage/doc.pdf',
      documentName: 'manual.pdf',
      documentMimetype: 'application/pdf',
      callbackUrl: 'https://api.exemplo/gptmaker/trainings/cb?t=x',
    };
    await wiremock.stub({
      request: {
        method: 'GET',
        urlPath: '/v2/agent/ag-1/trainings',
        headers: auth,
        queryParameters: { type: { equalTo: 'TEXT' } },
      },
      response: ok([{ id: 'tr-1', type: 'TEXT', text: 'Horário: 8h às 18h' }]),
    });
    await wiremock.stub({
      request: {
        method: 'POST',
        urlPath: '/v2/agent/ag-1/trainings',
        headers: auth,
        bodyPatterns: [json(document)],
      },
      response: ok({ success: true }),
    });
    await wiremock.stub({
      request: {
        method: 'PUT',
        urlPath: '/v2/training/tr-1',
        headers: auth,
        bodyPatterns: [json({ type: 'TEXT', text: 'Horário: 9h às 18h' })],
      },
      response: ok({ success: true }),
    });
    await wiremock.stub({
      request: { method: 'DELETE', urlPath: '/v2/training/tr-1', headers: auth },
      response: ok({ success: true }),
    });
    await expect(client.listTrainings('ag-1', 'TEXT')).resolves.toEqual([
      { id: 'tr-1', type: 'TEXT', text: 'Horário: 8h às 18h' },
    ]);
    await client.createTraining('ag-1', document);
    await client.updateTextTraining('tr-1', { text: 'Horário: 9h às 18h' });
    await client.deleteTraining('tr-1');
  });

  it('regras de transferência: listar, criar, atualizar e remover (design D17)', async () => {
    const rule = {
      type: 'AGENT' as const,
      agentId: 'ag-2',
      instructions: 'Quando pedir orçamento.',
      returnOnFinish: true,
    };
    const body = { ...rule, userId: null };
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/agent/ag-1/transfer-rules', headers: auth },
      response: ok([{ id: 'tr-9', createdAt: '2026-10-27T00:00:00Z', ...body }]),
    });
    await wiremock.stub({
      request: {
        method: 'POST',
        urlPath: '/v2/agent/ag-1/transfer-rules',
        headers: auth,
        bodyPatterns: [json(body)],
      },
      response: ok({ id: 'tr-10', createdAt: '2026-10-27T00:00:00Z', ...body }),
    });
    await wiremock.stub({
      request: {
        method: 'PUT',
        urlPath: '/v2/agent/ag-1/transfer-rules/tr-10',
        headers: auth,
        bodyPatterns: [json({ ...body, returnOnFinish: false })],
      },
      response: { status: 204 },
    });
    await wiremock.stub({
      request: { method: 'DELETE', urlPath: '/v2/agent/ag-1/transfer-rules/tr-10', headers: auth },
      response: { status: 204 },
    });
    await expect(client.listTransferRules('ag-1')).resolves.toEqual([
      expect.objectContaining({ id: 'tr-9', agentId: 'ag-2', instructions: rule.instructions }),
    ]);
    await expect(client.createTransferRule('ag-1', rule)).resolves.toBe('tr-10');
    await client.updateTransferRule('ag-1', 'tr-10', { ...rule, returnOnFinish: false });
    await client.deleteTransferRule('ag-1', 'tr-10');
  });

  it('GET e PUT /v2/agent/{id}/webhooks', async () => {
    const hooks = {
      onNewMessage: 'https://api.exemplo/gptmaker/webhooks/onNewMessage?t=x',
      onTransfer: 'https://api.exemplo/gptmaker/webhooks/onTransfer?t=x',
    };
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/agent/ag-1/webhooks', headers: auth },
      response: ok(hooks),
    });
    await wiremock.stub({
      request: {
        method: 'PUT',
        urlPath: '/v2/agent/ag-1/webhooks',
        headers: auth,
        bodyPatterns: [json(hooks)],
      },
      response: ok({ success: true }),
    });
    await expect(client.getWebhooks('ag-1')).resolves.toEqual(hooks);
    await client.updateWebhooks('ag-1', hooks);
  });

  it('POST /v2/agent/{id}/conversation (texto e áudio)', async () => {
    const text = { contextId: 'tenant-1:chat42', prompt: 'Qual o horário?', chatName: 'Maria' };
    const audio = { contextId: 'tenant-1:chat42', audio: 'https://portal/audio.ogg' };
    await wiremock.stub({
      request: {
        method: 'POST',
        urlPath: '/v2/agent/ag-1/conversation',
        headers: auth,
        bodyPatterns: [json(text)],
      },
      response: ok({ message: 'Das 8h às 18h.', images: [], audios: [], documents: [] }),
    });
    await wiremock.stub({
      request: {
        method: 'POST',
        urlPath: '/v2/agent/ag-1/conversation',
        headers: auth,
        bodyPatterns: [json(audio)],
      },
      response: ok({
        message: 'Entendi seu áudio.',
        images: [],
        audios: ['https://gm/r.mp3'],
        documents: [],
      }),
    });
    await expect(client.sendMessage('ag-1', text)).resolves.toMatchObject({
      message: 'Das 8h às 18h.',
    });
    await expect(client.sendMessage('ag-1', audio)).resolves.toMatchObject({
      audios: ['https://gm/r.mp3'],
    });
  });

  it('PUT /v2/chat/{id}/start-human e /stop-human', async () => {
    for (const action of ['start-human', 'stop-human']) {
      await wiremock.stub({
        request: { method: 'PUT', urlPath: `/v2/chat/tenant-1%3Achat42/${action}`, headers: auth },
        response: ok({ success: true }),
      });
    }
    await client.startHuman('tenant-1:chat42');
    await client.stopHuman('tenant-1:chat42');
  });

  it('GET /v2/agent/{id}/credits-spent', async () => {
    await wiremock.stub({
      request: {
        method: 'GET',
        urlPath: '/v2/agent/ag-1/credits-spent',
        headers: auth,
        queryParameters: {
          year: { equalTo: '2026' },
          month: { equalTo: '9' },
          day: { equalTo: '24' },
        },
      },
      response: ok({
        total: 42,
        data: [{ credits: 42, year: 2026, month: 9, day: 24, model: 'GPT_5_MINI' }],
      }),
    });
    await expect(
      client.getCreditsSpent('ag-1', { year: 2026, month: 9, day: 24 }),
    ).resolves.toMatchObject({
      total: 42,
    });
  });

  it('erros documentados: 403 de token e 400 genérico', async () => {
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/agent/bad', headers: auth },
      response: { status: 400, jsonBody: { error: 'Erro inesperado' } },
    });
    await wiremock.stub({
      request: { method: 'GET', urlPath: `/v2/workspace/${WS}/credits` },
      response: { status: 403, jsonBody: { error: 'Erro de token' } },
    });
    await expect(client.getAgent('bad')).rejects.toMatchObject({ kind: 'VALIDATION', status: 400 });
    await expect(client.getWorkspaceCredits()).rejects.toMatchObject({
      kind: 'UNAUTHORIZED',
      status: 403,
    });
    // Erros de cliente não são retentados.
    expect(await wiremock.count('GET', '/v2/agent/bad')).toBe(1);
  });

  it('retenta 5xx em GET', async () => {
    await wiremock.stub({
      request: { method: 'GET', urlPath: '/v2/agent/flaky', headers: auth },
      response: { status: 503, jsonBody: { error: 'indisponível' } },
    });
    await expect(client.getAgent('flaky')).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    expect(await wiremock.count('GET', '/v2/agent/flaky')).toBe(2);
  });

  it('não retenta 5xx na conversa (não idempotente)', async () => {
    await wiremock.stub({
      request: { method: 'POST', urlPath: '/v2/agent/ag-1/conversation', headers: auth },
      response: { status: 502, jsonBody: { error: 'bad gateway' } },
    });
    await expect(
      client.sendMessage('ag-1', { contextId: 'c', prompt: 'oi' }),
    ).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
    expect(await wiremock.count('POST', '/v2/agent/ag-1/conversation')).toBe(1);
  });
});
