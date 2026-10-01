import { randomUUID } from 'node:crypto';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BitrixClient } from '../../src/modules/bitrix/bitrix.client';
import { ChatMedia, MediaUnavailableError } from '../../src/modules/channel/chat-media';
import {
  ConversationService,
  isPermanentConversationError,
  replyCacheKey,
} from '../../src/modules/channel/conversation.service';
import type { InboundMessage } from '../../src/modules/channel/inbound-message';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import { WireMock } from '../support/wiremock';

const AGENT = 'gm-agent-1';
const CONVERSATION = `/v2/agent/${AGENT}/conversation`;
const DOWNLOAD = '/rest/imbot.v2.File.download.json';
const FILE_URL = '/rest/download.json';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

// Conversa com o GPTMaker (spec bitrix-chatbot-channel), WireMock no papel do GPTMaker e do portal.
describe('encaminhamento ao GPTMaker', () => {
  let wiremock: WireMock;
  let redisContainer: StartedRedisContainer;
  let redis: Redis;
  let media: ChatMedia;
  let service: ConversationService;

  const target = { gptmakerAgentId: AGENT, installationId: 77 };

  const message = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
    tenantId: randomUUID(),
    agentId: randomUUID(),
    botId: 456,
    dialogId: 'chat5',
    chatId: 5,
    messageId: Math.floor(Math.random() * 1_000_000),
    text: 'Qual o horário de vocês?',
    params: null,
    user: { id: 12, name: 'Maria', connector: true },
    chat: {
      type: 'openChannel',
      entityType: 'LINES',
      entityId: '',
      entityData1: '',
      entityData2: '',
      entityData3: '',
    },
    language: 'br',
    receivedAt: new Date().toISOString(),
    ...overrides,
  });

  const conversationBodies = () =>
    wiremock.bodies('POST', CONVERSATION) as Promise<Array<Record<string, unknown>>>;

  async function stubReply(
    response: { status: number; jsonBody?: unknown } = {
      status: 200,
      jsonBody: { message: 'Das 8h às 18h.' },
    },
  ) {
    await wiremock.stub({ request: { method: 'POST', urlPath: CONVERSATION }, response });
  }

  async function stubFile(
    file: { contentType: string; disposition?: string; status?: number } = {
      contentType: 'image/png',
      disposition: 'attachment; filename="foto.png"',
    },
  ) {
    await wiremock.stub({
      request: { method: 'POST', urlPath: DOWNLOAD },
      response: {
        status: 200,
        jsonBody: { result: { downloadUrl: `${wiremock.baseUrl}${FILE_URL}?token=abc` } },
      },
    });
    await wiremock.stub({
      request: { method: 'GET', urlPath: FILE_URL },
      response: {
        status: file.status ?? 200,
        headers: {
          'Content-Type': file.contentType,
          ...(file.disposition ? { 'Content-Disposition': file.disposition } : {}),
        },
        base64Body: PNG.toString('base64'),
      },
    });
  }

  beforeAll(async () => {
    [wiremock, redisContainer] = await Promise.all([
      WireMock.start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    redis = new Redis(redisContainer.getConnectionUrl());
    const gptmaker = new GptMakerClient(
      {
        baseUrl: `${wiremock.baseUrl}/v2`,
        token: 't',
        workspaceId: 'ws',
        timeoutMs: 5000,
        conversationTimeoutMs: 5000,
      },
      new GptMakerResilience({
        maxAttempts: 1,
        breakerThreshold: 50,
        halfOpenAfterMs: 1000,
        beforeAttempt: async () => {},
      }),
    );
    const bitrix = new BitrixClient(
      {
        get: async () => ({
          accessToken: 'portal-token',
          expiresAt: new Date(Date.now() + 3_600_000),
          endpoint: `${wiremock.baseUrl}/rest/`,
        }),
        refresh: async () => {
          throw new Error('não esperado');
        },
      },
      { timeoutMs: 5000, maxAttempts: 1, acquire: async () => {} },
    );
    media = new ChatMedia(bitrix);
    service = new ConversationService(gptmaker, media, redis);
  }, 180_000);

  beforeEach(async () => {
    await wiremock.reset();
    await redis.flushall();
  });

  afterAll(async () => {
    await redis?.quit();
    await Promise.all([wiremock?.stop(), redisContainer?.stop()]);
  });

  it('texto vai como prompt, com contextId do diálogo prefixado pelo tenant', async () => {
    await stubReply();
    const inbound = message();
    await expect(service.ask(inbound, target)).resolves.toMatchObject({
      message: 'Das 8h às 18h.',
    });
    expect(await conversationBodies()).toEqual([
      {
        contextId: `${inbound.tenantId}:chat5`,
        chatName: 'Maria',
        prompt: 'Qual o horário de vocês?',
      },
    ]);
  });

  it('resposta guardada: a retentativa não pergunta de novo', async () => {
    await stubReply();
    const inbound = message();
    await service.ask(inbound, target);
    await expect(service.ask(inbound, target)).resolves.toMatchObject({
      message: 'Das 8h às 18h.',
    });
    expect(await conversationBodies()).toHaveLength(1);
    expect(await redis.ttl(replyCacheKey(inbound))).toBeGreaterThan(0);
  });

  it('sem texto nem anexo, não chama o GPTMaker', async () => {
    await stubReply();
    await expect(service.ask(message({ text: '  ' }), target)).resolves.toBeNull();
    expect(await conversationBodies()).toEqual([]);
  });

  it('imagem: lê o tipo com um link e manda ao GPTMaker um link novo do portal', async () => {
    await stubReply();
    await stubFile();
    const inbound = message({ text: 'Esse produto tem?', params: { FILE_ID: ['138'] } });
    await service.ask(inbound, target);

    // Dois links de uso único: um para ler o cabeçalho, outro para o GPTMaker.
    expect(await wiremock.bodies('POST', DOWNLOAD)).toMatchObject([
      { botId: 456, fileId: 138 },
      { botId: 456, fileId: 138 },
    ]);
    expect(await wiremock.count('GET', FILE_URL)).toBe(1);
    const [body] = await conversationBodies();
    expect(body).toMatchObject({
      prompt: 'Esse produto tem?',
      image: `${wiremock.baseUrl}${FILE_URL}?token=abc`,
    });
  });

  it('imagem sem legenda vai sem prompt', async () => {
    await stubReply();
    await stubFile();
    await service.ask(message({ text: '', params: { FILE_ID: ['138'] } }), target);
    const [body] = await conversationBodies();
    expect(body).toMatchObject({ image: expect.any(String) });
    expect(body).not.toHaveProperty('prompt');
  });

  it('áudio vai sem prompt; documento leva o texto de legenda', async () => {
    await stubReply();
    await stubFile({ contentType: 'audio/ogg', disposition: 'attachment; filename="voz.ogg"' });
    await service.ask(message({ text: '', params: { FILE_ID: ['1'] } }), target);
    await wiremock.reset();
    await stubReply();
    await stubFile({ contentType: 'application/pdf', disposition: 'attachment; filename="a.pdf"' });
    await service.ask(message({ text: 'segue', params: { FILE_ID: ['2'] } }), target);

    const [document] = await conversationBodies();
    expect(document).toMatchObject({ prompt: 'segue', document: expect.any(String) });
    expect(document).not.toHaveProperty('audio');
  });

  it('anexo recusado pelo portal: segue só o texto', async () => {
    await stubReply();
    await wiremock.stub({
      request: { method: 'POST', urlPath: DOWNLOAD },
      response: { status: 400, jsonBody: { error: 'FILE_NOT_FOUND', error_description: 'x' } },
    });
    await service.ask(message({ params: { FILE_ID: ['138'] } }), target);
    expect((await conversationBodies())[0]).toEqual(
      expect.objectContaining({ prompt: 'Qual o horário de vocês?' }),
    );
    expect((await conversationBodies())[0]).not.toHaveProperty('image');
  });

  it('link recusado ao ler o cabeçalho: segue só o texto', async () => {
    await stubReply();
    await stubFile({ contentType: 'text/html', status: 403 });
    await service.ask(message({ params: { FILE_ID: ['138'] } }), target);
    expect((await conversationBodies())[0]).toHaveProperty('prompt');
    expect((await conversationBodies())[0]).not.toHaveProperty('image');
  });

  it('portal fora do ar ao ler o anexo: erro para a retentativa', async () => {
    await stubReply();
    await stubFile({ contentType: 'image/png', status: 503 });
    await expect(service.ask(message({ params: { FILE_ID: ['138'] } }), target)).rejects.toThrow(
      MediaUnavailableError,
    );
    expect(await conversationBodies()).toEqual([]);
  });

  it('success=false (GPTMaker não baixou a mídia) é erro para a retentativa e não é guardado', async () => {
    await stubReply({
      status: 200,
      jsonBody: { success: false, error: 'java.net.ConnectException' },
    });
    const inbound = message();
    const error = await service.ask(inbound, target).catch((e: unknown) => e);
    expect(error).toMatchObject({
      kind: 'UNKNOWN',
      message: expect.stringContaining('ConnectException'),
    });
    expect(isPermanentConversationError(error)).toBe(false);
    expect(await redis.get(replyCacheKey(inbound))).toBeNull();
  });

  it('erros do GPTMaker: 5xx tenta de novo, corpo recusado vai para a DLQ', async () => {
    await stubReply({ status: 503, jsonBody: { error: 'fora' } });
    const unavailable = await service.ask(message(), target).catch((error: unknown) => error);
    expect(isPermanentConversationError(unavailable)).toBe(false);

    await wiremock.reset();
    await stubReply({ status: 400, jsonBody: { error: 'prompt inválido' } });
    const invalid = await service.ask(message(), target).catch((error: unknown) => error);
    expect(isPermanentConversationError(invalid)).toBe(true);
    expect(isPermanentConversationError(new Error('x'))).toBe(false);
  });
});
