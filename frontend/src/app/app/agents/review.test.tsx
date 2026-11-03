import {
  type AiKeyView,
  type FunctionAnswers,
  functionTemplateContentSchema,
} from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FunctionForm } from './function-form';
import { answerKey, attentionCount, canAddGap, canApply, reviewCost } from './review-logic';
import { ReviewPanel } from './review-ui';
import type { ReviewState } from './use-function-review';
import type { ReviewGap } from '@gptmaker/contracts';

const form = functionTemplateContentSchema.parse({
  agentType: 'SUPPORT',
  profile: {},
  fields: [
    {
      kind: 'TEXT_LIST',
      id: 'base.itens',
      label: 'Itens',
      required: false,
      minItems: 0,
      maxItems: 10,
      itemMaxLength: 30,
      review: { recommendedItems: 3 },
    },
    {
      kind: 'TEXT',
      id: 'empresa.desc',
      label: 'Descrição',
      required: false,
      maxLength: 100,
      review: { minLength: 40 },
    },
  ],
  behavior: '{{empresa.desc}}',
});

type Ai = NonNullable<ComponentProps<typeof FunctionForm>['ai']>;

function Harness({ initial = {}, ai }: { initial?: FunctionAnswers; ai?: Ai }) {
  const [answers, setAnswers] = useState<FunctionAnswers>(initial);
  return (
    <>
      <FunctionForm form={form} answers={answers} onChange={setAnswers} ai={ai} />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  );
}

afterEach(cleanup);

describe('avisos por regras fixas na tela (6.1)', () => {
  it('aparecem ao digitar', () => {
    render(<Harness />);
    expect(screen.getAllByText(/o recomendado é ter ao menos 3/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('textbox', { name: /^Descrição/ }), {
      target: { value: 'curta' },
    });
    expect(screen.getAllByText(/caracteres/i).length).toBeGreaterThan(0);
  });

  it('o resumo leva ao campo com aviso de atenção', () => {
    render(<Harness />);
    const link = screen.getByRole('link', { name: /Itens \(1\)/ });
    expect(link.getAttribute('href')).toBe('#pergunta-base.itens');
    expect(screen.getByText(/1 ponto de atenção/)).toBeTruthy();
  });

  it('mostra no máximo 3 por campo, com "ver mais"', () => {
    render(<Harness initial={{ 'base.itens': Array.from({ length: 5 }, () => 'igual') }} />);
    const count = () => screen.getAllByLabelText('Avisos')[0]!.querySelectorAll('li').length;
    expect(count()).toBe(4); // 3 avisos + o "ver mais"
    fireEvent.click(screen.getByRole('button', { name: /ver mais \d+/ }));
    expect(count()).toBeGreaterThan(4);
  });
});

describe('resultado da IA no campo (6.5, 6.6)', () => {
  const done = (
    suggestion: { values: Record<string, string>; applicable: boolean },
    key: string,
  ): Ai => ({
    busy: false,
    onRerun: vi.fn(),
    onApplied: vi.fn(),
    fields: {
      'base.itens': {
        status: 'done',
        answerKey: key,
        result: {
          fieldId: 'base.itens',
          summary: 'x',
          items: [{ index: 0, problems: [{ code: 'curto', text: 'Muito vago.' }], suggestion }],
        },
      },
    },
  });
  const initial = { 'base.itens': ['vago', 'b', 'c'] };
  const key = answerKey(initial['base.itens']);

  it('Aplicar troca o texto do item pelo mesmo caminho da digitação', () => {
    const ai = done({ values: { text: 'Texto melhor' }, applicable: true }, key);
    render(<Harness initial={initial} ai={ai} />);
    expect(screen.getByText(/Muito vago\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByTestId('answers').textContent).toContain('Texto melhor');
    expect(ai.onApplied).toHaveBeenCalledWith('base.itens', 0, ['Texto melhor', 'b', 'c']);
  });

  it('sugestão acima do limite não tem Aplicar', () => {
    const long = 'x'.repeat(40);
    render(
      <Harness initial={initial} ai={done({ values: { text: long }, applicable: false }, key)} />,
    );
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
    // Mesmo vindo como aplicável, a validação local recusa o que passa do limite do item (30).
    expect(
      canApply(form, initial, form.fields[0]!, 0, { values: { text: long }, applicable: true }),
    ).toBe(false);
  });

  it('editar depois da revisão marca "desatualizado" e oferece revisar o campo', () => {
    const ai = done({ values: { text: 'ok' }, applicable: true }, 'resposta-antiga');
    render(<Harness initial={initial} ai={ai} />);
    expect(screen.getByText(/desatualizado/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'revisar este campo' }));
    expect(ai.onRerun).toHaveBeenCalledWith('base.itens');
  });

  it('campo sem créditos mostra o caminho para adicionar', () => {
    const ai: Ai = {
      busy: false,
      onRerun: vi.fn(),
      onApplied: vi.fn(),
      fields: {
        'base.itens': {
          status: 'error',
          answerKey: '',
          code: 'NO_CREDIT',
          message: 'Seus créditos de IA acabaram.',
        },
      },
    };
    render(<Harness initial={initial} ai={ai} />);
    expect(screen.getByRole('link', { name: 'Adicionar créditos' }).getAttribute('href')).toBe(
      '/app/plan',
    );
  });
});

describe('botão Revisar com IA (6.4)', () => {
  const state: ReviewState = {
    fields: {},
    gaps: { status: 'idle' },
    contradictions: [],
    cross: 'idle',
    error: null,
  };
  const key = (patch: Partial<AiKeyView>): AiKeyView => ({
    configured: false,
    last4: null,
    verifiedAt: null,
    creditsPerField: 5,
    platformAvailable: true,
    ...patch,
  });
  const answers = { 'base.itens': ['a'], 'empresa.desc': 'Vendemos roupas.' };
  const panel = (aiKey: AiKeyView) =>
    render(
      <ReviewPanel
        form={form}
        answers={answers}
        aiKey={aiKey}
        state={state}
        running={false}
        canConfigureKey
        expectation=""
        onExpectation={() => undefined}
        onAddGap={() => undefined}
        onReview={() => undefined}
      />,
    );

  it('com a chave da CRMThink mostra o custo: preço × campos preenchidos', () => {
    panel(key({}));
    expect(screen.getByRole('button', { name: 'Revisar com IA · 10 créditos' })).toBeTruthy();
  });

  it('com chave própria: sem uso de créditos', () => {
    panel(key({ configured: true, last4: '1a2b' }));
    expect(
      screen.getByRole('button', { name: 'Revisar com IA · sem uso de créditos' }),
    ).toBeTruthy();
  });

  it('sem nenhuma chave: desativado, com o link para configurar', () => {
    panel(key({ platformAvailable: false }));
    const button = screen.getByRole('button', { name: /Revisar com IA/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Configurar a chave' }).getAttribute('href')).toBe(
      '/app/ai-key',
    );
  });

  it('reviewCost: singular e chave própria', () => {
    expect(reviewCost(1, 1, false).label).toBe('1 crédito');
    expect(reviewCost(5, 3, true)).toEqual({ credits: 0, label: 'sem uso de créditos' });
  });
});

describe('confirmação ao publicar (6.2)', () => {
  it('só avisos de atenção pedem confirmação', () => {
    // Vazio com recomendado = attention.
    expect(attentionCount(form, {})).toBe(1);
    // Itens suficientes e texto curto (hint): publica direto.
    expect(attentionCount(form, { 'base.itens': ['a', 'b', 'c'], 'empresa.desc': 'curta' })).toBe(
      0,
    );
  });
});

const base = functionTemplateContentSchema.parse({
  agentType: 'SUPPORT',
  profile: {},
  fields: [
    {
      kind: 'KNOWLEDGE',
      id: 'base.faq',
      label: 'Perguntas frequentes',
      required: false,
      maxItems: 2,
      subfields: [
        { id: 'pergunta', label: 'Pergunta', required: true, maxLength: 60 },
        { id: 'resposta', label: 'Resposta', required: true, maxLength: 120 },
      ],
      format: 'P: {{pergunta}}\nR: {{resposta}}',
    },
  ],
  behavior: 'x',
});
const KEY_A = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const KEY_B = '8a3d2c9f-3b5e-4d7f-8c2b-4e6a8f0b2d3c';
const gapOf = (patch: Partial<ReviewGap> = {}): ReviewGap => ({
  fieldId: 'base.faq',
  title: 'Segunda via de boleto',
  why: 'A expectativa cita boleto.',
  item: { pergunta: 'Como pedir a 2ª via?', resposta: 'Pelo [preencher: canal].' },
  applicable: true,
  ...patch,
});

describe('expectativa e cobertura (3.1, 3.3)', () => {
  const aiKey = (patch: Partial<AiKeyView> = {}): AiKeyView => ({
    configured: false,
    last4: null,
    verifiedAt: null,
    creditsPerField: 5,
    platformAvailable: true,
    ...patch,
  });
  const idle: ReviewState = {
    fields: {},
    gaps: { status: 'idle' },
    contradictions: [],
    cross: 'idle',
    error: null,
  };
  const answers = {
    'base.faq': [
      { itemKey: KEY_A, values: { pergunta: 'Qual o prazo?', resposta: 'Até 5 dias.' } },
    ],
  };
  const expectation = 'Clientes pedem segunda via de boleto.';

  function panel(props: {
    key?: AiKeyView;
    state?: ReviewState;
    expectation?: string;
    answers?: FunctionAnswers;
    onAddGap?: (gap: ReviewGap, index: number) => void;
  }) {
    return render(
      <ReviewPanel
        form={base}
        answers={props.answers ?? answers}
        aiKey={props.key ?? aiKey()}
        state={props.state ?? idle}
        running={false}
        canConfigureKey
        expectation={props.expectation ?? ''}
        onExpectation={() => undefined}
        onAddGap={props.onAddGap ?? (() => undefined)}
        onReview={() => undefined}
      />,
    );
  }
  const done = (gaps: ReviewGap[], covered: string[] = []): ReviewState => ({
    ...idle,
    gaps: {
      status: 'done',
      result: { gaps, covered: covered.map((text) => ({ text })) },
      added: [],
    },
  });

  it('o botão soma a cobertura quando a expectativa é válida', () => {
    panel({});
    expect(screen.getByRole('button', { name: 'Revisar com IA · 5 créditos' })).toBeTruthy();
    cleanup();
    panel({ expectation });
    expect(screen.getByRole('button', { name: 'Revisar com IA · 10 créditos' })).toBeTruthy();
  });

  it('chave própria continua sem uso de créditos', () => {
    panel({ expectation, key: aiKey({ configured: true, last4: '1a2b' }) });
    expect(
      screen.getByRole('button', { name: 'Revisar com IA · sem uso de créditos' }),
    ).toBeTruthy();
  });

  it('expectativa curta: avisa o motivo e não soma a cobertura', () => {
    panel({ expectation: 'atender bem' });
    expect(screen.getByText(/Descreva situações reais/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisar com IA · 5 créditos' })).toBeTruthy();
  });

  it('Adicionar entrega a lacuna e a posição dela', () => {
    const onAddGap = vi.fn();
    panel({ state: done([gapOf()]), expectation, onAddGap });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(onAddGap).toHaveBeenCalledWith(gapOf(), 0);
    expect(screen.getByText(/dependem de dados do seu negócio/)).toBeTruthy();
  });

  it('campo cheio e rascunho acima do limite: sem Adicionar, com o motivo', () => {
    panel({
      state: done([
        gapOf({ applicable: false, reason: 'FULL' }),
        gapOf({ title: 'Outra', applicable: false, reason: 'LIMIT' }),
      ]),
      expectation,
    });
    expect(screen.queryByRole('button', { name: 'Adicionar' })).toBeNull();
    expect(screen.getByText('O campo já está no máximo de itens.')).toBeTruthy();
    expect(screen.getByText(/passa do limite de caracteres/)).toBeTruthy();
  });

  it('a validação local também recusa campo que ficou cheio depois da revisão', () => {
    const full = {
      'base.faq': [
        { itemKey: KEY_A, values: { pergunta: 'a', resposta: 'b' } },
        { itemKey: KEY_B, values: { pergunta: 'c', resposta: 'd' } },
      ],
    };
    expect(canAddGap(base, full, base.fields[0], gapOf())).toBe(false);
    expect(canAddGap(base, answers, base.fields[0], gapOf())).toBe(true);
  });

  it('sem lacuna: mostra a mensagem e o que a base já cobre', () => {
    panel({ state: done([], ['Prazo de entrega']), expectation });
    expect(screen.getByText('Nenhuma lacuna encontrada.')).toBeTruthy();
    expect(screen.getByText('Prazo de entrega')).toBeTruthy();
  });

  it('lacuna já adicionada mostra "Adicionado"', () => {
    const state = done([gapOf()]);
    if (state.gaps.status === 'done') state.gaps.added = [0];
    panel({ state, expectation });
    expect(screen.getByText('Adicionado.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Adicionar' })).toBeNull();
  });

  it('falta de créditos na cobertura mostra o caminho para adicionar', () => {
    panel({
      state: {
        ...idle,
        gaps: { status: 'error', message: 'Créditos acabaram.', code: 'NO_CREDIT' },
      },
      expectation,
    });
    expect(screen.getByRole('link', { name: 'Adicionar créditos' })).toBeTruthy();
  });
});

describe('marcador pendente no formulário (3.4)', () => {
  function Marked({ initial }: { initial: FunctionAnswers }) {
    const [answers, setAnswers] = useState<FunctionAnswers>(initial);
    return <FunctionForm form={base} answers={answers} onChange={setAnswers} />;
  }

  it('o item com [preencher: …] mostra o aviso, e ele some ao preencher', () => {
    const marked = {
      'base.faq': [
        { itemKey: KEY_A, values: { pergunta: 'Prazo?', resposta: 'Em [preencher: dias] dias.' } },
      ],
    };
    render(<Marked initial={marked} />);
    expect(
      screen.getAllByText(/ainda tem um trecho \[preencher: …\]|trecho \[preencher: …\] para você/)
        .length,
    ).toBeGreaterThan(0);
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'Em 7 dias.' } });
    expect(screen.queryByText(/trecho \[preencher: …\] para você/)).toBeNull();
  });

  it('o marcador não pede a confirmação "pontos de atenção" (a prévia já o recusa)', () => {
    const marked = {
      'base.faq': [{ itemKey: KEY_A, values: { pergunta: 'P?', resposta: '[preencher: x]' } }],
    };
    expect(attentionCount(base, marked)).toBe(0);
  });
});
