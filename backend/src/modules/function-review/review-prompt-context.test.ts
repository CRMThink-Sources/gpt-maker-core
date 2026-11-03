import { type FunctionAnswers, type FunctionField, functionFieldSchema } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import {
  capTitles,
  fieldMessages,
  gapBase,
  gapsMessages,
  otherBaseTitles,
  ROLE_BY_KIND,
  toFieldResult,
} from './review-prompt';

type Knowledge = Extract<FunctionField, { kind: 'KNOWLEDGE' }>;

const knowledge = (id: string, label: string, review?: object): Knowledge =>
  functionFieldSchema.parse({
    kind: 'KNOWLEDGE',
    id,
    label,
    required: false,
    maxItems: 5,
    subfields: [
      { id: 'problema', label: 'Problema', required: true, maxLength: 50 },
      { id: 'solucao', label: 'Solução', required: true, maxLength: 100 },
    ],
    format: 'Problema: {{problema}}\nSolução: {{solucao}}',
    ...(review ? { review } : {}),
  }) as Knowledge;

const field = knowledge('base.problemas', 'Problemas comuns');
const KEY = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const items = [{ index: 0, values: { problema: 'Boleto', solucao: 'Peça no portal.' } }];
const ctx = { functionName: 'Suporte', agentName: 'Ana' };

const text = (messages: ReturnType<typeof fieldMessages>, role: 'system' | 'user') =>
  messages.find((message) => message.role === role)!.content;

describe('revisão do campo: contexto de papel', () => {
  it('leva o papel do tipo do campo e mantém a regra de não inventar dado', () => {
    const system = text(fieldMessages(field, items, ctx), 'system');
    expect(system).toContain(ROLE_BY_KIND.KNOWLEDGE);
    expect(system).toContain('consulta quando o cliente final faz uma pergunta parecida');
    expect(system).toContain('Nunca invente preço, prazo, política');

    const texto = functionFieldSchema.parse({
      kind: 'TEXT',
      id: 'empresa.desc',
      label: 'Descrição',
      required: true,
      maxLength: 300,
    }) as Extract<FunctionField, { kind: 'TEXT' }>;
    const textSystem = text(fieldMessages(texto, [], ctx), 'system');
    expect(textSystem).toContain(ROLE_BY_KIND.TEXT);
    expect(textSystem).not.toContain(ROLE_BY_KIND.KNOWLEDGE);
  });

  it('pede categoria e gravidade e não pede mais o code', () => {
    const system = text(fieldMessages(field, items, ctx), 'system');
    expect(system).toContain('"category"');
    expect(system).toContain('"severity"');
    expect(system).not.toContain('slug curto');
  });

  it('a cobertura também leva o papel da base', () => {
    const system = text(gapsMessages('x'.repeat(30), [gapBase(field, {})], ctx), 'system');
    expect(system).toContain(ROLE_BY_KIND.KNOWLEDGE);
  });

  it('o problema volta com categoria, gravidade e o code igual à categoria', () => {
    const result = toFieldResult(field, items, {
      summary: 's',
      items: [
        {
          index: 0,
          problems: [{ category: 'missing_term', severity: 'blocks', text: 'Falta o prazo.' }],
        },
      ],
    });
    expect(result.items[0]!.problems).toEqual([
      {
        code: 'missing_term',
        category: 'missing_term',
        severity: 'blocks',
        text: 'Falta o prazo.',
      },
    ]);
  });
});

describe('revisão do campo: contexto da função', () => {
  it('leva o que a função faz e a expectativa como dado do cliente', () => {
    const user = text(
      fieldMessages(field, items, {
        ...ctx,
        functionDescription: 'Atende dúvidas de clientes.',
        expectation: 'Responder sobre trocas e boletos.',
      }),
      'user',
    );
    expect(user).toContain('O que a função faz: Atende dúvidas de clientes.');
    expect(user).toContain('<expectativa>\nResponder sobre trocas e boletos.\n</expectativa>');
  });

  it('sem expectativa nem descrição o pedido segue sem esses blocos', () => {
    const user = text(fieldMessages(field, items, ctx), 'user');
    expect(user).not.toContain('<expectativa>');
    expect(user).not.toContain('O que a função faz');
    expect(user).not.toContain('<outros>');
  });

  it('leva só os títulos dos outros campos de base, nunca o conteúdo', () => {
    const faq = knowledge('base.faq', 'Perguntas frequentes');
    const answers: FunctionAnswers = {
      'base.problemas': [{ itemKey: KEY, values: { problema: 'Boleto', solucao: 'Portal.' } }],
      'base.faq': [
        { itemKey: KEY, values: { problema: 'Prazo de troca', solucao: 'SEGREDO-DA-RESPOSTA' } },
      ],
    };
    const others = otherBaseTitles([field, faq], answers, 'base.problemas');
    expect(others).toEqual([
      { fieldId: 'base.faq', label: 'Perguntas frequentes', titles: ['Prazo de troca'] },
    ]);
    const user = text(fieldMessages(field, items, { ...ctx, otherTitles: others }), 'user');
    expect(user).toContain('Perguntas frequentes [base.faq]: "Prazo de troca"');
    expect(user).not.toContain('SEGREDO-DA-RESPOSTA');
  });
});

describe('revisão do campo: exemplos do template', () => {
  const comExemplos = knowledge('base.problemas', 'Problemas comuns', {
    examples: { good: 'BOM: passos numerados', bad: 'RUIM: reinicie' },
  });

  it('leva o exemplo bom e o ruim com a instrução de não copiar', () => {
    const messages = fieldMessages(comExemplos, items, ctx);
    const user = text(messages, 'user');
    expect(user).toContain('<exemplo-bom>\nBOM: passos numerados\n</exemplo-bom>');
    expect(user).toContain('<exemplo-ruim>\nRUIM: reinicie\n</exemplo-ruim>');
    expect(text(messages, 'system')).toContain('Nunca copie o exemplo');
  });

  it('sem exemplos o pedido não os menciona', () => {
    expect(text(fieldMessages(field, items, ctx), 'user')).not.toContain('<exemplo-bom>');
  });
});

describe('teto dos títulos dos outros campos', () => {
  it('corta em 40 títulos por campo', () => {
    const titles = Array.from({ length: 60 }, (_, i) => `T${i}`);
    const [only] = capTitles([{ fieldId: 'a', label: 'A', titles }]);
    expect(only!.titles).toHaveLength(40);
    expect(only!.titles[0]).toBe('T0');
  });

  it('acima do total saem primeiro os títulos mais longos', () => {
    const curto = 'curto';
    const longo = 'L'.repeat(60);
    const list = capTitles([{ fieldId: 'a', label: 'A', titles: [curto, longo, curto] }], 40, 20);
    expect(list[0]!.titles).toEqual([curto, curto]);
  });

  it('campo que perdeu todos os títulos some da lista (fim do teto)', () => {
    expect(capTitles([{ fieldId: 'a', label: 'A', titles: ['L'.repeat(30)] }], 40, 10)).toEqual([]);
  });
});

describe('resultado do campo: o que não deve virar ruído na tela', () => {
  const two = [
    { index: 0, values: { problema: 'Boleto', solucao: 'Peça no portal.' } },
    { index: 1, values: { problema: 'Senha', solucao: 'Use o link recebido.' } },
  ];
  const problem = (text: string) => ({
    category: 'other' as const,
    severity: 'polish' as const,
    text,
  });

  it('sugestão igual ao texto atual some, mesmo com espaços e quebras diferentes', () => {
    const result = toFieldResult(field, two, {
      summary: 's',
      items: [
        {
          index: 0,
          problems: [],
          suggestion: { problema: 'Boleto', solucao: '  Peça   no\nportal. ' },
        },
      ],
    });
    expect(result.items).toEqual([]);
  });

  it('com problema, o item fica mesmo sem sugestão útil', () => {
    const result = toFieldResult(field, two, {
      summary: 's',
      items: [
        {
          index: 0,
          problems: [problem('Vago.')],
          suggestion: { problema: 'Boleto', solucao: 'Peça no portal.' },
        },
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.suggestion).toBeUndefined();
  });

  it('só os subcampos que mudaram ficam na sugestão', () => {
    const result = toFieldResult(field, two, {
      summary: 's',
      items: [
        { index: 1, problems: [], suggestion: { problema: 'Senha', solucao: '1. Use o link.' } },
      ],
    });
    expect(result.items[0]!.suggestion!.values).toEqual({ solucao: '1. Use o link.' });
  });

  it('o mesmo item repetido vira uma entrada: problemas juntos e a primeira sugestão', () => {
    const result = toFieldResult(field, two, {
      summary: 's',
      items: [
        { index: 1, problems: [problem('Duas perguntas.')], suggestion: { solucao: 'Primeira.' } },
        {
          index: 1,
          problems: [problem('Duas perguntas.'), problem('Vago.')],
          suggestion: { solucao: 'Segunda.' },
        },
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.problems.map((p) => p.text)).toEqual(['Duas perguntas.', 'Vago.']);
    expect(result.items[0]!.suggestion!.values).toEqual({ solucao: 'Primeira.' });
  });

  it('o pedido numera os itens a partir de 1 e manda não contar caracteres', () => {
    const messages = fieldMessages(field, two, ctx);
    const user = text(messages, 'user');
    expect(user).toContain('<item index="1" posição="2">');
    const system = text(messages, 'system');
    expect(system).toContain('NUNCA conte caracteres');
    expect(system).toContain('item <posição>');
    expect(system).toContain('única entrada por item');
  });
});

describe('regras contra sugestão inútil', () => {
  const system = text(fieldMessages(field, items, ctx), 'system');

  it('texto já claro não ganha reparo nem reescrita equivalente', () => {
    expect(system).toContain('NÃO aponte ajuste de estilo');
    expect(system).toContain('não o devolva em "items"');
  });

  it('o marcador entra só na parte que falta, nunca no lugar do texto inteiro do cliente', () => {
    expect(system).toContain('NUNCA troque o texto inteiro do cliente por um marcador sozinho');
    expect(system).toContain('aponte o problema e não sugira texto');
  });
});

describe('falsos positivos vistos no teste local', () => {
  const texto = functionFieldSchema.parse({
    kind: 'TEXT',
    id: 'suporte.normal',
    label: 'Quando o chamado é de prioridade NORMAL',
    required: true,
    maxLength: 55,
  }) as Extract<FunctionField, { kind: 'TEXT' }>;
  const others = [
    { fieldId: 'base.faq', label: 'Perguntas frequentes', titles: ['Prazo de troca'] },
  ];

  it('os títulos dos outros campos de base só vão no pedido de um campo de base', () => {
    const base = text(fieldMessages(field, items, { ...ctx, otherTitles: others }), 'user');
    expect(base).toContain('<outros>');
    const simples = text(
      fieldMessages(texto, [{ index: 0, values: { text: 'Erro com alternativa.' } }], {
        ...ctx,
        otherTitles: others,
      }),
      'user',
    );
    expect(simples).not.toContain('<outros>');
    expect(simples).not.toContain('Prazo de troca');
  });

  it('sugestão que é só um marcador não é entregue, mas o problema continua', () => {
    const result = toFieldResult(texto, [{ index: 0, values: { text: 'Função parou.' } }], {
      summary: 's',
      items: [
        {
          index: 0,
          problems: [{ category: 'ambiguous', severity: 'polish', text: 'Igual ao exemplo.' }],
          suggestion: { text: '[preencher: critério para prioridade alta]' },
        },
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.problems).toHaveLength(1);
    expect(result.items[0]!.suggestion).toBeUndefined();
  });

  it('marcador dentro de uma frase com o texto do cliente é entregue', () => {
    const result = toFieldResult(texto, [{ index: 0, values: { text: 'Função parou.' } }], {
      summary: 's',
      items: [
        {
          index: 0,
          problems: [{ category: 'incomplete', severity: 'blocks', text: 'Falta o critério.' }],
          suggestion: { text: 'Função parou para [preencher: quantos usuários].' },
        },
      ],
    });
    expect(result.items[0]!.suggestion!.values.text).toContain('Função parou');
  });
});
