import { HttpStatus, Logger } from '@nestjs/common';
import {
  type ConversationMessage,
  type FunctionAnswers,
  functionTemplateContentSchema,
  type HallucinationModelOutput,
  type HallucinationRequest,
} from '@gptmaker/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import type { Env } from '../../config/env';
import { DomainError } from '../../shared/http/api-exception.filter';
import { HallucinationAnalysisService } from './hallucination-analysis.service';
import { reviewError } from './review-errors';

const TENANT = 'tenant-1';
const AGENT = 'agent-1';
const ANALYSIS = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const KEY = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const SECRET_TEXT = 'segredo-da-conversa-12345';
const SECRET_NOTE = 'nota-secreta-67890';

const content = functionTemplateContentSchema.parse({
  agentType: 'SUPPORT',
  profile: {},
  behavior: 'Atenda com cordialidade.',
  fields: [
    {
      kind: 'KNOWLEDGE',
      id: 'base.politicas',
      label: 'Políticas',
      required: false,
      maxItems: 3,
      subfields: [
        { id: 'titulo', label: 'Título', required: true, maxLength: 40 },
        { id: 'texto', label: 'Texto', required: true, maxLength: 80 },
      ],
      format: '{{titulo}}: {{texto}}',
    },
  ],
});
const answers: FunctionAnswers = {
  'base.politicas': [{ itemKey: KEY, values: { titulo: 'Pagamento', texto: 'Só cartão.' } }],
};

const msg = (id: string, role: ConversationMessage['role'], text: string): ConversationMessage => ({
  id,
  role,
  text,
  at: null,
  hasAttachment: false,
});

const defaultMessages = [
  msg('c1', 'CUSTOMER', 'Quanto tempo leva a entrega?'),
  msg('a1', 'AGENT', `Entregamos em 5 dias. ${SECRET_TEXT}`),
  msg('c2', 'CUSTOMER', 'Aceitam boleto?'),
  msg('a2', 'AGENT', 'Só cartão.'),
];

function setup(options: { keySource?: 'tenant' | 'platform'; env?: Partial<Env> } = {}) {
  const keySource = options.keySource ?? 'platform';
  const ai = {
    tenantLimit: vi.fn(async () => undefined),
    chooseKey: vi.fn(async () => keySource),
    assertBalance: vi.fn(async () => undefined),
    apiKey: vi.fn(async () => 'vibe_api_x'),
    ask: vi.fn(
      async (
        _session: unknown,
        _apiKey: string,
        _messages: Array<{ role: string; content: string }>,
        _schema: unknown,
      ): Promise<HallucinationModelOutput> => ({ findings: [] }),
    ),
    charge: vi.fn(async () => undefined),
  };
  const templates = {
    forAgent: vi.fn(async () => ({
      content,
      functionName: 'Suporte',
      functionDescription: '',
      agentName: 'Atendente',
    })),
  };
  const conversations = {
    messages: vi.fn(async () => ({ messages: defaultMessages, omitted: 0 })),
  };
  const rows: Array<{ content: string | null }> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => rows }) }),
      }),
    }),
  };
  const env = { REVIEW_CREDITS_PER_FIELD: 2, ...options.env } as Env;
  const redis = new FakeRedis();
  const service = new HallucinationAnalysisService(
    db as never,
    env,
    ai as never,
    templates as never,
    conversations as never,
    redis.asRedis(),
  );
  const request = (extra: Partial<HallucinationRequest> = {}): HallucinationRequest => ({
    analysisId: ANALYSIS,
    source: 'TEST',
    conversationId: 'conv-1',
    answers,
    ...extra,
  });
  const run = (extra?: Partial<HallucinationRequest>) =>
    service.analyze(TENANT, AGENT, request(extra));
  return { service, ai, templates, conversations, rows, run, redis, request };
}

const finding = (extra: Partial<HallucinationModelOutput['findings'][number]> = {}) => ({
  messageRef: 'm2',
  claim: 'Entregamos em 5 dias',
  verdict: 'UNSUPPORTED' as const,
  reason: 'Nada na base fala de prazo',
  cause: 'MISSING_IN_BASE' as const,
  ...extra,
});

const errorOf = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

describe('análise de alucinação', () => {
  const logged: unknown[][] = [];

  beforeEach(() => {
    logged.length = 0;
    vi.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('analisa a conversa, devolve os achados com o id real e debita só depois da saída', async () => {
    const { ai, run } = setup();
    ai.ask.mockResolvedValueOnce({
      findings: [
        finding({
          suggestion: {
            kind: 'ADD_ITEM',
            fieldId: 'base.politicas',
            item: { titulo: 'Prazo', texto: 'Entregamos em [preencher: prazo em dias]' },
          },
        }),
      ],
    });

    const result = await run();

    expect(result).toMatchObject({ analysisId: ANALYSIS, credits: 2, omitted: 0 });
    expect(result.findings).toEqual([
      expect.objectContaining({
        messageId: 'a1',
        verdict: 'UNSUPPORTED',
        suggestion: expect.objectContaining({ kind: 'ADD_ITEM', applicable: true }),
      }),
    ]);
    expect(ai.ask).toHaveBeenCalledTimes(1);
    expect(ai.charge).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        keySource: 'platform',
        purpose: 'análise de alucinação',
      }),
      expect.objectContaining({
        key: `hallucination:${TENANT}:${ANALYSIS}`,
        amount: 2,
        refType: 'hallucination_analysis',
        refId: ANALYSIS,
        agentId: AGENT,
      }),
    );
    // A cobrança vem depois da IA.
    expect(ai.ask.mock.invocationCallOrder[0]!).toBeLessThan(
      ai.charge.mock.invocationCallOrder[0]!,
    );
  });

  it('manda a base, a conversa com referências curtas e a nota para a IA', async () => {
    const { ai, rows, run } = setup();
    rows.push({ content: 'Texto de treinamento manual' });

    await run({ note: SECRET_NOTE });

    const messages = ai.ask.mock.calls[0]![2];
    const user = messages.find((message) => message.role === 'user')!.content;
    expect(user).toContain('[m2] AGENTE: Entregamos em 5 dias.');
    expect(user).toContain('titulo: Pagamento | texto: Só cartão.');
    expect(user).toContain('Texto de treinamento manual');
    expect(user).toContain(`<nota>${SECRET_NOTE}</nota>`);
  });

  it('com a chave do cliente não informa crédito debitado', async () => {
    const { ai, run } = setup({ keySource: 'tenant' });
    const result = await run();
    expect(result.credits).toBe(0);
    expect(ai.charge).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, keySource: 'tenant' }),
      expect.anything(),
    );
  });

  it.each([
    ['sem preço próprio, o de um campo revisado', {}, 2],
    ['com preço próprio', { HALLUCINATION_CREDITS_PER_ANALYSIS: 7 }, 7],
    ['preço próprio zero é de graça', { HALLUCINATION_CREDITS_PER_ANALYSIS: 0 }, 0],
  ])('preço: %s', async (_nome, env, expected) => {
    const { ai, run } = setup({ env: env as Partial<Env> });
    const result = await run();
    expect(result.credits).toBe(expected);
    expect(ai.assertBalance).toHaveBeenCalledWith(expect.anything(), expected);
  });

  it('sem saldo, a IA nem é chamada e nada é cobrado', async () => {
    const { ai, run } = setup();
    ai.assertBalance.mockRejectedValueOnce(reviewError('NO_CREDIT'));

    const error = await errorOf(run());

    expect(error).toMatchObject({ code: 'NO_CREDIT' });
    expect(ai.ask).not.toHaveBeenCalled();
    expect(ai.charge).not.toHaveBeenCalled();
  });

  it('saída da IA fora do formato: erro e nenhum débito', async () => {
    const { ai, run } = setup();
    ai.ask.mockRejectedValueOnce(reviewError('AI_BAD_OUTPUT'));

    const error = await errorOf(run());

    expect(error).toMatchObject({ code: 'AI_BAD_OUTPUT' });
    expect(ai.charge).not.toHaveBeenCalled();
  });

  it('conversa sem resposta do agente: nem a IA nem o saldo são tocados', async () => {
    const { ai, conversations, run } = setup();
    conversations.messages.mockResolvedValueOnce({
      messages: [msg('c1', 'CUSTOMER', 'oi'), msg('o1', 'OTHER', 'transferido')],
      omitted: 0,
    });

    const error = await errorOf(run());

    expect(error).toMatchObject({ code: 'HALLUCINATION_NOTHING_TO_ANALYZE', status: 422 });
    expect(ai.chooseKey).not.toHaveBeenCalled();
    expect(ai.assertBalance).not.toHaveBeenCalled();
    expect(ai.ask).not.toHaveBeenCalled();
    expect(ai.charge).not.toHaveBeenCalled();
  });

  it('conversa de outro tenant (404 da leitura) não chega à IA', async () => {
    const { ai, conversations, run } = setup();
    conversations.messages.mockRejectedValueOnce(
      new DomainError('CONVERSATION_NOT_FOUND', 'Conversa não encontrada', HttpStatus.NOT_FOUND),
    );

    const error = await errorOf(run());

    expect(error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 });
    expect(ai.ask).not.toHaveBeenCalled();
    expect(ai.charge).not.toHaveBeenCalled();
  });

  it('a conversa é lida com o tenant e o agente da sessão e a origem pedida', async () => {
    const { conversations, run } = setup();
    await run({ source: 'REAL', conversationId: 'public-api-x' });
    expect(conversations.messages).toHaveBeenCalledWith(TENANT, AGENT, 'REAL', 'public-api-x');
  });

  describe('respostas marcadas', () => {
    it('só as marcadas entram no foco', async () => {
      const { ai, run } = setup();
      ai.ask.mockResolvedValueOnce({
        findings: [finding({ messageRef: 'm2' }), finding({ messageRef: 'm4' })],
      });

      const result = await run({ flaggedMessageIds: ['a2'] });

      expect(result.findings.map((entry) => entry.messageId)).toEqual(['a2']);
      const user = ai.ask.mock.calls[0]![2][1]!.content;
      expect(user).toContain('[m4] AGENTE (marcada como suspeita): Só cartão.');
    });

    it('marcação que não é resposta do agente nesta conversa é recusada antes da IA', async () => {
      const { ai, run } = setup();

      const error = await errorOf(run({ flaggedMessageIds: ['c1', 'inexistente'] }));

      expect(error).toMatchObject({ code: 'HALLUCINATION_FLAGGED_NOT_FOUND', status: 422 });
      expect(ai.ask).not.toHaveBeenCalled();
    });

    it('ignora marcação desconhecida quando outra vale', async () => {
      const { ai, run } = setup();
      await run({ flaggedMessageIds: ['a1', 'inexistente'] });
      const user = ai.ask.mock.calls[0]![2][1]!.content;
      expect(user).toContain('[m2] AGENTE (marcada como suspeita)');
    });
  });

  it('resposta sustentada não gera sugestão, mesmo que a IA mande uma', async () => {
    const { ai, run } = setup();
    ai.ask.mockResolvedValueOnce({
      findings: [
        finding({
          messageRef: 'm4',
          verdict: 'SUPPORTED',
          suggestion: {
            kind: 'ADD_ITEM',
            fieldId: 'base.politicas',
            item: { titulo: 'x', texto: 'y' },
          },
        }),
      ],
    });

    const result = await run();

    expect(result.findings[0]).toMatchObject({
      verdict: 'SUPPORTED',
      cause: null,
      suggestion: null,
    });
  });

  it('respostas da tela inválidas: recusa antes de ler a conversa', async () => {
    const { conversations, ai, run } = setup();

    const error = await errorOf(
      run({
        answers: {
          'base.politicas': [{ itemKey: KEY, values: { titulo: 'x'.repeat(100), texto: 'y' } }],
        },
      }),
    );

    expect(error).toMatchObject({ code: 'FUNCTION_ANSWERS_INVALID', status: 422 });
    expect(conversations.messages).not.toHaveBeenCalled();
    expect(ai.ask).not.toHaveBeenCalled();
  });

  it('informa as mensagens omitidas de conversa longa', async () => {
    const { conversations, run } = setup();
    conversations.messages.mockResolvedValueOnce({ messages: defaultMessages, omitted: 70 });
    expect((await run()).omitted).toBe(70);
  });

  it('o log leva só identificadores e contagens, nunca o texto da conversa nem a nota', async () => {
    const { ai, rows, run } = setup();
    rows.push({ content: 'treinamento-secreto-111' });
    ai.ask.mockResolvedValueOnce({ findings: [finding()] });

    await run({ note: SECRET_NOTE });

    const text = JSON.stringify(logged);
    expect(text).toContain(ANALYSIS);
    expect(text).not.toContain(SECRET_TEXT);
    expect(text).not.toContain(SECRET_NOTE);
    expect(text).not.toContain('treinamento-secreto-111');
    expect(text).not.toContain('Só cartão');
  });

  describe('reenvio e simultaneidade', () => {
    it('análise já feita não roda a IA de novo nem cobra de novo', async () => {
      const { ai, run } = setup();

      await run();
      const error = await errorOf(run());

      expect(error).toMatchObject({ code: 'HALLUCINATION_ALREADY_ANALYZED', status: 409 });
      expect(ai.ask).toHaveBeenCalledTimes(1);
      expect(ai.charge).toHaveBeenCalledTimes(1);
    });

    it('depois de uma falha o mesmo id pode tentar de novo, e só a que deu certo cobra', async () => {
      const { ai, run } = setup();
      ai.ask.mockRejectedValueOnce(reviewError('AI_UNAVAILABLE'));

      expect(await errorOf(run())).toMatchObject({ code: 'AI_UNAVAILABLE' });
      await run();

      expect(ai.ask).toHaveBeenCalledTimes(2);
      expect(ai.charge).toHaveBeenCalledTimes(1);
    });

    it('falha no débito também libera o id para uma nova tentativa', async () => {
      const { ai, run } = setup();
      ai.charge.mockRejectedValueOnce(new Error('ledger fora do ar'));

      await errorOf(run());
      await run();

      expect(ai.charge).toHaveBeenCalledTimes(2);
    });

    it('o mesmo id de outro tenant não é bloqueado', async () => {
      const { service, ai, request } = setup();

      await service.analyze(TENANT, AGENT, request());
      await service.analyze('outro-tenant', AGENT, request());

      expect(ai.ask).toHaveBeenCalledTimes(2);
    });

    it('duas análises do mesmo tenant ao mesmo tempo: a segunda espera sua vez (nada de saldo negativo)', async () => {
      const { ai, run } = setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      ai.ask.mockImplementationOnce(async () => {
        await gate;
        return { findings: [] };
      });

      const first = run({ analysisId: ANALYSIS });
      await vi.waitFor(() => expect(ai.ask).toHaveBeenCalledTimes(1));
      const second = await errorOf(run({ analysisId: '1b9e4d2c-8f3a-4e5b-a6c7-d8e9f0a1b2c3' }));
      release();
      await first;

      expect(second).toMatchObject({ code: 'HALLUCINATION_IN_PROGRESS', status: 409 });
      // A recusada nem conferiu saldo, nem chamou a IA, nem reservou o id.
      expect(ai.assertBalance).toHaveBeenCalledTimes(1);
      expect(ai.ask).toHaveBeenCalledTimes(1);
      expect(ai.charge).toHaveBeenCalledTimes(1);
    });

    it('a recusada por já haver análise em curso pode tentar de novo depois', async () => {
      const { ai, run } = setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      ai.ask.mockImplementationOnce(async () => {
        await gate;
        return { findings: [] };
      });
      const other = '1b9e4d2c-8f3a-4e5b-a6c7-d8e9f0a1b2c3';

      const first = run();
      await vi.waitFor(() => expect(ai.ask).toHaveBeenCalledTimes(1));
      expect(await errorOf(run({ analysisId: other }))).toMatchObject({
        code: 'HALLUCINATION_IN_PROGRESS',
      });
      release();
      await first;

      await expect(run({ analysisId: other })).resolves.toMatchObject({ analysisId: other });
    });

    it('análises de tenants diferentes não esperam uma pela outra', async () => {
      const { service, ai, request } = setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      ai.ask.mockImplementationOnce(async () => {
        await gate;
        return { findings: [] };
      });

      const first = service.analyze(TENANT, AGENT, request());
      await vi.waitFor(() => expect(ai.ask).toHaveBeenCalledTimes(1));
      await expect(
        service.analyze(
          'outro-tenant',
          AGENT,
          request({ analysisId: '1b9e4d2c-8f3a-4e5b-a6c7-d8e9f0a1b2c3' }),
        ),
      ).resolves.toBeDefined();
      release();
      await first;
    });
  });

  it('o limite por cliente usa a contagem própria da análise', async () => {
    const { ai, run } = setup();
    await run();
    expect(ai.tenantLimit).toHaveBeenCalledWith(TENANT, `hallucination:tenant:${TENANT}`);
  });
});
