import {
  type AiKeyView,
  type FunctionAnswers,
  functionTemplateContentSchema,
  type HallucinationResult,
} from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { ApiRequestError } from '@/lib/platform-session';
import { HallucinationEntry } from './hallucination-modal';

const api = vi.fn();
vi.mock('../session-provider', () => ({
  useAppSession: () => ({ api: (...args: unknown[]) => api(...args) }),
}));

const form = functionTemplateContentSchema.parse({
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
const KEY = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const answers: FunctionAnswers = {
  'base.politicas': [{ itemKey: KEY, values: { titulo: 'Pagamento', texto: 'Só cartão.' } }],
};
const platformKey: AiKeyView = {
  configured: false,
  last4: null,
  verifiedAt: null,
  creditsPerField: 2,
  creditsPerAnalysis: 3,
  platformAvailable: true,
};
const ownKey: AiKeyView = { ...platformKey, configured: true, last4: '1a2b' };
const noKey: AiKeyView = { ...platformKey, platformAvailable: false };

const testList = {
  conversations: [
    {
      id: 'c-test-1',
      source: 'TEST',
      title: 'Maria',
      at: '2026-01-02T10:00:00.000Z',
      messageCount: 4,
    },
  ],
  nextCursor: null,
};
const messages = (extra: Array<Record<string, unknown>> = []) => ({
  messages: [
    { id: 'u1', role: 'CUSTOMER', text: 'Qual o prazo?', at: null, hasAttachment: false },
    { id: 'a1', role: 'AGENT', text: 'Entregamos em 5 dias.', at: null, hasAttachment: false },
    ...extra,
  ],
  omitted: 0,
});
const finding = (extra: Record<string, unknown> = {}) => ({
  messageId: 'a1',
  claim: 'Entregamos em 5 dias',
  verdict: 'UNSUPPORTED',
  reason: 'Nada na base fala de prazo.',
  cause: 'MISSING_IN_BASE',
  source: null,
  suggestion: {
    kind: 'ADD_ITEM',
    fieldId: 'base.politicas',
    item: { titulo: 'Prazo', texto: 'Entregamos em [preencher: prazo em dias]' },
    applicable: true,
  },
  ...extra,
});
const analysis = (findings: unknown[], extra: Partial<HallucinationResult> = {}) => ({
  analysisId: 'x',
  findings,
  credits: 3,
  omitted: 0,
  ...extra,
});

interface Routes {
  list?: unknown | Error;
  real?: unknown | Error;
  messages?: unknown | Error;
  analyze?: unknown | Error;
}

function mockApi(routes: Routes = {}) {
  api.mockImplementation((path: string, init?: RequestInit) => {
    const settle = (value: unknown) =>
      value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    if (path.includes('/function/hallucination'))
      return settle(routes.analyze ?? analysis([finding()]));
    if (path.includes('/messages')) return settle(routes.messages ?? messages());
    if (path.includes('source=REAL'))
      return settle(routes.real ?? { conversations: [], nextCursor: null });
    if (path.includes('/conversations')) return settle(routes.list ?? testList);
    throw new Error(`rota inesperada: ${init?.method ?? 'GET'} ${path}`);
  });
}

function Harness({
  aiKey = platformKey,
  onApplied = () => undefined,
}: {
  aiKey?: AiKeyView | null;
  onApplied?: (next: FunctionAnswers) => void;
}) {
  const [current, setCurrent] = useState(answers);
  return (
    <I18nProvider>
      <HallucinationEntry
        agentId="ag1"
        form={form}
        answers={current}
        aiKey={aiKey}
        canConfigureKey
        onApply={(next) => {
          setCurrent(next);
          onApplied(next);
        }}
      />
      <output data-testid="answers">{JSON.stringify(current)}</output>
    </I18nProvider>
  );
}

async function openAndChoose() {
  fireEvent.click(screen.getByRole('button', { name: 'Analisar alucinação' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher' }));
  await screen.findByText('Qual o prazo?');
}
const analyzeButton = () => screen.getByRole('button', { name: /^Analisar \(/ });
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));
const analysisCalls = () =>
  api.mock.calls.filter(([path]) => String(path).includes('/function/hallucination'));

beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('entrada', () => {
  it('não aparece enquanto a chave de IA não carregou', () => {
    mockApi();
    render(<Harness aiKey={null} />);
    expect(screen.queryByRole('button', { name: 'Analisar alucinação' })).toBeNull();
  });
});

describe('escolher a conversa', () => {
  it('lista as de teste e troca para as reais', async () => {
    mockApi({
      real: {
        conversations: [
          {
            id: 'public-api-x',
            source: 'REAL',
            title: 'Cliente João',
            at: null,
            messageCount: null,
          },
        ],
        nextCursor: null,
      },
    });
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Analisar alucinação' }));
    expect(await screen.findByText('Maria')).toBeTruthy();
    expect(screen.getByText(/4 mensagens/)).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/app/agents/ag1/conversations?source=TEST&cursor=0');

    fireEvent.click(screen.getByRole('button', { name: 'Reais' }));
    expect(await screen.findByText('Cliente João')).toBeTruthy();
    expect(screen.getByText('sem data')).toBeTruthy();
    expect(screen.queryByText('Maria')).toBeNull();
    expect(api).toHaveBeenCalledWith('/app/agents/ag1/conversations?source=REAL&cursor=0');
  });

  it('"Carregar mais" pede a próxima página pelo cursor e soma à lista', async () => {
    api.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('cursor=0')
          ? { ...testList, nextCursor: 20 }
          : {
              conversations: [
                { id: 'c-test-2', source: 'TEST', title: 'Pedro', at: null, messageCount: 1 },
              ],
              nextCursor: null,
            },
      ),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Analisar alucinação' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Pedro')).toBeTruthy();
    expect(screen.getByText('Maria')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/app/agents/ag1/conversations?source=TEST&cursor=20');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('GPTMaker fora do ar nas reais mostra o erro e as de teste continuam', async () => {
    mockApi({
      real: new ApiRequestError(503, 'CONVERSATIONS_UNAVAILABLE', 'x'),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Analisar alucinação' }));
    await screen.findByText('Maria');

    fireEvent.click(screen.getByRole('button', { name: 'Reais' }));
    expect(await screen.findByText(/Não foi possível carregar as conversas agora/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Teste' }));
    expect(await screen.findByText('Maria')).toBeTruthy();
  });

  it('origem sem conversas avisa', async () => {
    mockApi({ list: { conversations: [], nextCursor: null } });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Analisar alucinação' }));
    expect(await screen.findByText('Nenhuma conversa encontrada nesta origem.')).toBeTruthy();
  });
});

describe('marcar e enviar', () => {
  it('só as respostas do agente podem ser marcadas', async () => {
    mockApi();
    render(<Harness />);
    await openAndChoose();

    expect(screen.getAllByRole('button', { name: 'Marcar como suspeita' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como suspeita' }));
    expect(screen.getByRole('button', { name: 'Suspeita' })).toBeTruthy();
  });

  it('avisa para onde vai o texto e mostra o custo com a chave da CRMThink', async () => {
    mockApi();
    render(<Harness aiKey={platformKey} />);
    await openAndChoose();

    expect(screen.getByText(/na conta da CRMThink/)).toBeTruthy();
    expect(analyzeButton().textContent).toBe('Analisar (3 créditos)');
  });

  it('com a chave do cliente, o aviso é da conta dele e não há custo', async () => {
    mockApi();
    render(<Harness aiKey={ownKey} />);
    await openAndChoose();

    expect(screen.getByText(/na sua conta/)).toBeTruthy();
    expect(analyzeButton().textContent).toBe('Analisar (sem uso de créditos)');
  });

  it('o pedido leva a conversa, as marcações e a nota; nada é salvo', async () => {
    mockApi();
    render(<Harness />);
    await openAndChoose();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como suspeita' }));
    fireEvent.change(screen.getByLabelText(/O que estava errado/), {
      target: { value: '  o prazo de 5 dias não existe ' },
    });

    fireEvent.click(analyzeButton());
    await screen.findByText('Resultado da análise');

    expect(analysisCalls()).toHaveLength(1);
    const [path, init] = analysisCalls()[0]!;
    expect(path).toBe('/app/agents/ag1/function/hallucination');
    expect((init as RequestInit).method).toBe('POST');
    expect(bodyOf(analysisCalls()[0]!)).toMatchObject({
      source: 'TEST',
      conversationId: 'c-test-1',
      flaggedMessageIds: ['a1'],
      note: 'o prazo de 5 dias não existe',
      answers,
    });
    expect(bodyOf(analysisCalls()[0]!).analysisId).toMatch(/^[0-9a-f-]{36}$/);
    // Só leituras e a análise: nenhum PUT/DELETE de salvar ou publicar.
    expect(
      api.mock.calls.filter(([, init]) =>
        ['PUT', 'DELETE', 'PATCH'].includes((init as RequestInit | undefined)?.method ?? ''),
      ),
    ).toHaveLength(0);
  });

  it('conversa longa avisa as mensagens que ficaram de fora', async () => {
    mockApi({ messages: { ...messages(), omitted: 70 } });
    render(<Harness />);
    await openAndChoose();
    expect(screen.getByText(/70 mensagens anteriores ficaram de fora da análise/)).toBeTruthy();
  });

  it('conversa sem resposta do agente avisa e não deixa analisar', async () => {
    mockApi({
      messages: {
        messages: [{ id: 'u1', role: 'CUSTOMER', text: 'Oi', at: null, hasAttachment: false }],
        omitted: 0,
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Analisar alucinação' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Escolher' }));

    expect(
      await screen.findByText('Esta conversa não tem resposta do agente para analisar.'),
    ).toBeTruthy();
    expect((analyzeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('sem nenhuma chave de IA, não analisa e orienta a configurar', async () => {
    mockApi();
    render(<Harness aiKey={noKey} />);
    await openAndChoose();

    expect((analyzeButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Para analisar, informe a chave do Vibecode/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Configurar a chave' })).toBeTruthy();
  });

  it('créditos acabados: mostra a mensagem da API e permite tentar de novo', async () => {
    mockApi({ analyze: new ApiRequestError(402, 'NO_CREDIT', 'x') });
    render(<Harness />);
    await openAndChoose();

    fireEvent.click(analyzeButton());

    expect(await screen.findByText(/Seus créditos de IA acabaram/)).toBeTruthy();
    expect(screen.queryByText('Resultado da análise')).toBeNull();
    expect((analyzeButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('a nova tentativa depois de uma falha reaproveita o mesmo analysisId (não cobra de novo)', async () => {
    mockApi({ analyze: new ApiRequestError(503, 'AI_UNAVAILABLE', 'x') });
    render(<Harness />);
    await openAndChoose();

    fireEvent.click(analyzeButton());
    await screen.findByText(/fora do ar/);
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(analysisCalls()).toHaveLength(2));

    expect(bodyOf(analysisCalls()[0]!).analysisId).toBe(bodyOf(analysisCalls()[1]!).analysisId);
  });
});

describe('idempotência da análise', () => {
  it('a análise de outra conversa usa um analysisId novo', async () => {
    mockApi({
      list: {
        conversations: [
          { id: 'c-1', source: 'TEST', title: 'Maria', at: null, messageCount: 2 },
          { id: 'c-2', source: 'TEST', title: 'Pedro', at: null, messageCount: 2 },
        ],
        nextCursor: null,
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Analisar alucinação' }));
    const choose = await screen.findAllByRole('button', { name: 'Escolher' });
    fireEvent.click(choose[0]!);
    await screen.findByText('Qual o prazo?');
    fireEvent.click(analyzeButton());
    await screen.findByText('Resultado da análise');

    fireEvent.click(screen.getByRole('button', { name: 'Analisar outra conversa' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Escolher' }))[1]!);
    await screen.findByText('Qual o prazo?');
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(analysisCalls()).toHaveLength(2));

    const [first, second] = analysisCalls().map((call) => bodyOf(call));
    expect(first.conversationId).toBe('c-1');
    expect(second.conversationId).toBe('c-2');
    expect(first.analysisId).not.toBe(second.analysisId);
  });

  it.each([
    ['HALLUCINATION_ALREADY_ANALYZED', /Esta análise já foi feita/],
    ['HALLUCINATION_IN_PROGRESS', /Já há uma análise em andamento/],
  ])('erro %s aparece traduzido', async (code, message) => {
    mockApi({ analyze: new ApiRequestError(409, code, 'x') });
    render(<Harness />);
    await openAndChoose();

    fireEvent.click(analyzeButton());

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText('Resultado da análise')).toBeNull();
  });
});

describe('resultado', () => {
  async function analyzeWith(findings: unknown[], extra: Partial<HallucinationResult> = {}) {
    mockApi({ analyze: analysis(findings, extra) });
    const applied = vi.fn();
    render(<Harness onApplied={applied} />);
    await openAndChoose();
    fireEvent.click(analyzeButton());
    await screen.findByText('Resultado da análise');
    return applied;
  }

  it('mostra veredito, trecho, motivo, causa e origem', async () => {
    await analyzeWith([
      finding({ source: { fieldId: 'base.politicas', label: 'Políticas', index: 0 } }),
    ]);

    expect(screen.getByText('Sem base')).toBeTruthy();
    expect(screen.getByText('Falta na base')).toBeTruthy();
    expect(screen.getByText(/“Entregamos em 5 dias”/)).toBeTruthy();
    expect(screen.getByText('Nada na base fala de prazo.')).toBeTruthy();
    expect(screen.getByText('Origem na base: Políticas, item 1')).toBeTruthy();
    expect(screen.getByText('Custo: 3 créditos.')).toBeTruthy();
  });

  it('"Aplicar" muda só o formulário e marca como aplicado', async () => {
    const applied = await analyzeWith([finding()]);

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(applied).toHaveBeenCalledTimes(1);
    const next = applied.mock.calls[0]![0] as FunctionAnswers;
    expect(next['base.politicas']).toHaveLength(2);
    expect(JSON.parse(screen.getByTestId('answers').textContent!)['base.politicas']).toHaveLength(
      2,
    );
    expect(screen.getByText(/Aplicado ao formulário \(ainda não salvo\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
    // Nada foi salvo: só a leitura e a análise passaram pela API.
    expect(
      api.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'),
    ).toHaveLength(0);
  });

  it('troca o texto de um item existente', async () => {
    const applied = await analyzeWith([
      finding({
        cause: 'CONFLICTING_BASE',
        suggestion: {
          kind: 'REPLACE_TEXT',
          fieldId: 'base.politicas',
          index: 0,
          values: { texto: 'Cartão e boleto.' },
          applicable: true,
        },
      }),
    ]);

    expect(screen.getByText('Sugestão: trocar o texto do item 1 de "Políticas"')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect((applied.mock.calls[0]![0] as FunctionAnswers)['base.politicas']).toEqual([
      { itemKey: KEY, values: { titulo: 'Pagamento', texto: 'Cartão e boleto.' } },
    ]);
  });

  it('sugestão só leitura aparece sem "Aplicar" e com o motivo', async () => {
    await analyzeWith([
      finding({
        suggestion: {
          kind: 'ADD_ITEM',
          fieldId: 'base.politicas',
          item: { titulo: 'Prazo', texto: 'x' },
          applicable: false,
          reason: 'LIMIT',
        },
      }),
    ]);

    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
    expect(screen.getByText(/algum texto passa do limite de caracteres/)).toBeTruthy();
  });

  it('causa de comportamento explica, sem "Aplicar"', async () => {
    await analyzeWith([finding({ cause: 'PERMISSIVE_BEHAVIOR', suggestion: null, source: null })]);

    expect(screen.getByText('Comportamento permissivo')).toBeTruthy();
    expect(screen.getByText(/não há texto para aplicar/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
  });

  it('resposta sustentada não traz sugestão', async () => {
    await analyzeWith([
      finding({ verdict: 'SUPPORTED', cause: null, suggestion: null, claim: 'Só cartão' }),
    ]);

    expect(screen.getByText('Sustentada pela base')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
  });

  it('sem afirmações a conferir, avisa', async () => {
    await analyzeWith([], { credits: 0 });
    expect(screen.getByText('A IA não encontrou afirmações do agente para conferir.')).toBeTruthy();
    expect(screen.queryByText(/^Custo:/)).toBeNull();
  });

  it('com a chave do cliente não mostra custo no resultado', async () => {
    mockApi({ analyze: analysis([finding()], { credits: 0 }) });
    render(<Harness aiKey={ownKey} />);
    await openAndChoose();
    fireEvent.click(analyzeButton());
    await screen.findByText('Resultado da análise');
    expect(screen.queryByText(/^Custo:/)).toBeNull();
  });

  it('"Analisar outra conversa" volta para a lista', async () => {
    await analyzeWith([finding()]);

    fireEvent.click(screen.getByRole('button', { name: 'Analisar outra conversa' }));

    expect(await within(document.body).findByRole('button', { name: 'Escolher' })).toBeTruthy();
  });
});
