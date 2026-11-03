import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FunctionAnswers } from './agent-function-answers';
import { type FunctionReviewWarning, reviewFunctionAnswers } from './agent-function-review';
import { type FunctionField, functionFieldSchema } from './agent-functions';

const KEYS = [
  '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b',
  '8a3d2c9f-3b5e-4d7f-8c2b-4e6a8f0b2d3c',
  '9b4e3d0a-4c6f-4e8a-9d3c-5f7b9a1c3e4d',
];

const fields: FunctionField[] = z.array(functionFieldSchema).parse([
  {
    kind: 'TEXT',
    id: 'empresa.descricao',
    label: 'O que a empresa faz',
    required: true,
    maxLength: 100,
    placeholder: 'Ex.: vendemos software de gestão',
    review: { minLength: 40 },
  },
  {
    kind: 'TEXT_LIST',
    id: 'sdr.perguntas',
    label: 'Perguntas',
    required: false,
    minItems: 0,
    maxItems: 5,
    itemMaxLength: 50,
    placeholder: 'Qual é o seu orçamento?',
    review: { recommendedItems: 2 },
  },
  {
    kind: 'KNOWLEDGE',
    id: 'base.problemas',
    label: 'Problemas comuns',
    required: false,
    maxItems: 20,
    review: { recommendedItems: 3, rubric: 'Solução em passos.' },
    subfields: [
      { id: 'problema', label: 'Problema', required: true, maxLength: 150 },
      {
        id: 'solucao',
        label: 'Solução',
        required: true,
        maxLength: 850,
        review: { minLength: 80 },
      },
    ],
    format: 'Problema: {{problema}}\nSolução: {{solucao}}',
  },
  {
    kind: 'KNOWLEDGE',
    id: 'base.faq',
    label: 'Perguntas frequentes',
    required: false,
    maxItems: 20,
    subfields: [
      { id: 'pergunta', label: 'Pergunta', required: true, maxLength: 200 },
      { id: 'resposta', label: 'Resposta', required: true, maxLength: 800 },
    ],
    format: 'Pergunta: {{pergunta}}\nResposta: {{resposta}}',
  },
  {
    kind: 'CHOICE',
    id: 'sdr.canal',
    label: 'Canal',
    required: true,
    options: [
      { value: 'nenhum', label: 'Nenhum', snippet: 'Sem canal.' },
      {
        value: 'whats',
        label: 'WhatsApp',
        snippet: 'Use {{sdr.numero}}.',
        dependents: [
          {
            kind: 'TEXT',
            id: 'sdr.numero',
            label: 'Número',
            required: true,
            maxLength: 30,
            review: { minLength: 10 },
          },
        ],
      },
    ],
  },
  {
    kind: 'BITRIX_SPA',
    id: 'suporte.spa',
    label: 'Chamados',
    required: true,
    values: [
      { id: 'origem', label: 'Origem', required: true },
      { id: 'problema', label: 'Problema relatado', required: true },
      { id: 'prioridade', label: 'Prioridade', required: true, options: ['LOW', 'HIGH'] },
    ],
  },
]);

const review = (answers: FunctionAnswers) => reviewFunctionAnswers({ fields }, answers);
const codes = (warnings: FunctionReviewWarning[]) => warnings.map((warning) => warning.code);
const long = (length: number) => 'x'.repeat(length);

const problema = (key: number, title: string, solution = long(100)) => ({
  itemKey: KEYS[key]!,
  values: { problema: title, solucao: solution },
});

describe('avisos por regras fixas', () => {
  it('avisa base com menos itens que o recomendado', () => {
    const warnings = review({ 'base.problemas': [problema(0, 'Não consigo entrar')] });
    expect(warnings).toContainEqual({
      field: 'base.problemas',
      code: 'FEW_ITEMS',
      severity: 'attention',
      message: 'Só 1 item; o recomendado é ter ao menos 3.',
    });
  });

  it('avisa campo vazio só quando o template recomenda itens', () => {
    const warnings = review({});
    expect(warnings.map((warning) => [warning.field, warning.code])).toEqual([
      ['sdr.perguntas', 'FEW_ITEMS'],
      ['base.problemas', 'FEW_ITEMS'],
    ]);
    expect(warnings.find((warning) => warning.field === 'base.problemas')?.message).toBe(
      'Nenhum item preenchido; o recomendado é ter ao menos 3.',
    );
    // "base.faq" não tem review: vazia não gera aviso.
    expect(warnings.some((warning) => warning.field === 'base.faq')).toBe(false);
  });

  it('avisa texto e subcampo curtos como dica', () => {
    const warnings = review({
      'empresa.descricao': 'Software de gestão',
      'base.problemas': [problema(0, 'A'), problema(1, 'B', 'reinicie'), problema(2, 'C')],
    });
    expect(warnings).toContainEqual({
      field: 'empresa.descricao',
      code: 'SHORT_TEXT',
      severity: 'hint',
      message: 'Texto curto: 18 caracteres; o recomendado é ao menos 40.',
    });
    expect(warnings).toContainEqual({
      field: 'base.problemas',
      item: 1,
      subfield: 'solucao',
      code: 'SHORT_TEXT',
      severity: 'hint',
      message: 'Texto curto em "Solução": 8 caracteres; o recomendado é ao menos 80.',
    });
    expect(warnings.filter((warning) => warning.field === 'base.problemas')).toHaveLength(1);
  });

  it('não chama de curto o campo vazio', () => {
    expect(codes(review({ 'empresa.descricao': '   ' }))).not.toContain('SHORT_TEXT');
  });

  it('avisa texto igual ao exemplo, ignorando caixa e espaços', () => {
    const warnings = review({
      'empresa.descricao': '  ex.:  VENDEMOS software de gestão ',
      'sdr.perguntas': ['Qual é o seu orçamento?', 'Quantos vendedores?'],
    });
    expect(
      warnings
        .filter((warning) => warning.code === 'PLACEHOLDER_COPIED')
        .map((warning) => [warning.field, warning.item]),
    ).toEqual([
      ['empresa.descricao', undefined],
      ['sdr.perguntas', 0],
    ]);
  });

  it('avisa itens repetidos apontando os dois, mesmo com acento e pontuação diferentes', () => {
    const warnings = review({
      'base.problemas': [
        problema(0, 'Não consigo entrar'),
        problema(1, 'Outro problema'),
        problema(2, 'não consigo  entrar!'),
      ],
    });
    expect(warnings.filter((warning) => warning.code === 'DUPLICATE_ITEMS')).toEqual([
      {
        field: 'base.problemas',
        item: 0,
        code: 'DUPLICATE_ITEMS',
        severity: 'attention',
        message: 'Parece repetido com o item 3.',
      },
      {
        field: 'base.problemas',
        item: 2,
        code: 'DUPLICATE_ITEMS',
        severity: 'attention',
        message: 'Parece repetido com o item 1.',
      },
    ]);
  });

  it('acha repetido na lista de textos', () => {
    const warnings = review({ 'sdr.perguntas': ['Qual o prazo?', 'qual o prazo', 'Outra?'] });
    expect(
      warnings
        .filter((warning) => warning.code === 'DUPLICATE_ITEMS')
        .map((warning) => warning.item),
    ).toEqual([0, 1]);
  });

  it('avisa texto perto do limite, e só até o limite', () => {
    const near = (text: string) =>
      codes(review({ 'empresa.descricao': text })).filter((code) => code === 'NEAR_LIMIT');
    expect(near(long(90))).toEqual([]);
    expect(near(long(91))).toEqual(['NEAR_LIMIT']);
    expect(near(long(100))).toEqual(['NEAR_LIMIT']);
    // Acima do limite é erro de validação, não aviso.
    expect(near(long(101))).toEqual([]);
  });

  it('avisa subcampo e item de lista perto do limite', () => {
    const warnings = review({
      'sdr.perguntas': [long(46)],
      'base.problemas': [problema(0, long(140)), problema(1, 'B'), problema(2, 'C')],
    });
    const near = warnings.filter((warning) => warning.code === 'NEAR_LIMIT');
    expect(near.map((warning) => [warning.field, warning.item, warning.subfield])).toEqual([
      ['sdr.perguntas', 0, undefined],
      ['base.problemas', 0, 'problema'],
    ]);
  });

  it('ignora o dependente de uma opção que não está escolhida', () => {
    const answers = { 'sdr.numero': '123' };
    expect(codes(review({ ...answers, 'sdr.canal': 'nenhum' }))).not.toContain('SHORT_TEXT');
    const shown = review({ ...answers, 'sdr.canal': 'whats' });
    expect(shown.filter((warning) => warning.field === 'sdr.numero')).toHaveLength(1);
  });

  it('não quebra com respostas fora do formato', () => {
    expect(() =>
      review({
        'empresa.descricao': 5,
        'sdr.perguntas': 'não é lista',
        'base.problemas': [{ itemKey: 'x' }],
        'suporte.spa': 'texto',
      } as never),
    ).not.toThrow();
  });
});

describe('avisos do processo inteligente', () => {
  const spa = (value: Record<string, unknown>) => ({
    'suporte.spa': { entityTypeId: 1060, ...value } as never,
  });
  const forSpa = (answers: FunctionAnswers) =>
    review(answers).filter((warning) => warning.field === 'suporte.spa');

  it('avisa dois valores ligados ao mesmo campo do portal', () => {
    const warnings = forSpa(
      spa({
        fields: { origem: 'ufCrm1_Chat', problema: 'ufCrm1_Chat', prioridade: 'ufCrm1_Prio' },
      }),
    );
    expect(warnings.map((warning) => [warning.code, warning.subfield])).toEqual([
      ['SPA_DUPLICATE_FIELD', 'origem'],
      ['SPA_DUPLICATE_FIELD', 'problema'],
    ]);
    expect(warnings[0]!.severity).toBe('attention');
    expect(warnings[0]!.message).toContain('"Problema relatado"');
  });

  it('não avisa quando cada valor tem o seu campo', () => {
    expect(
      forSpa(spa({ fields: { origem: 'ufCrm1_A', problema: 'ufCrm1_B', prioridade: 'ufCrm1_C' } })),
    ).toEqual([]);
  });

  it('avisa valor com opções ligadas só em parte', () => {
    const warnings = forSpa(
      spa({
        fields: { origem: 'ufCrm1_A', problema: 'ufCrm1_B', prioridade: 'ufCrm1_C' },
        lists: { prioridade: { LOW: 11 } },
      }),
    );
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'SPA_PARTIAL_OPTIONS',
        subfield: 'prioridade',
        severity: 'attention',
      }),
    ]);
  });

  it('não avisa opções ligadas por inteiro nem valor sem ligação de opções', () => {
    const fieldsOk = { origem: 'ufCrm1_A', problema: 'ufCrm1_B', prioridade: 'ufCrm1_C' };
    expect(forSpa(spa({ fields: fieldsOk, lists: { prioridade: { LOW: 11, HIGH: 12 } } }))).toEqual(
      [],
    );
    expect(forSpa(spa({ fields: fieldsOk }))).toEqual([]);
  });

  it('ignora valor que o template não declara', () => {
    expect(
      forSpa(spa({ fields: { antigo: 'ufCrm1_A', outro: 'ufCrm1_A', origem: 'ufCrm1_B' } })),
    ).toEqual([]);
  });
});

describe('marcador [preencher: …] (agent-knowledge-gaps)', () => {
  const pending = (answers: FunctionAnswers) =>
    review(answers).filter((warning) => warning.code === 'PENDING_PLACEHOLDER');

  it('avisa em texto, item de lista e subcampo da base, apontando onde', () => {
    const warnings = pending({
      'empresa.descricao': 'Vendemos roupas. [preencher: onde atendem]',
      'sdr.perguntas': ['Qual o prazo?', 'Quanto custa? [Preencher: valor]'],
      'base.faq': [
        {
          itemKey: KEYS[0]!,
          values: { pergunta: 'Troca?', resposta: 'Em [preencher: dias] dias.' },
        },
      ],
    });
    expect(
      warnings.map(({ field, item, subfield, severity }) => [field, item, subfield, severity]),
    ).toEqual([
      ['empresa.descricao', undefined, undefined, 'attention'],
      ['sdr.perguntas', 1, undefined, 'attention'],
      ['base.faq', 0, 'resposta', 'attention'],
    ]);
  });

  it('sem marcador não avisa', () => {
    expect(
      pending({ 'empresa.descricao': 'Vendemos roupas.', 'sdr.perguntas': ['a', 'b'] }),
    ).toEqual([]);
  });

  it('colchetes comuns não são marcador', () => {
    expect(pending({ 'empresa.descricao': 'Veja [o site] e [preencher] sem dois pontos' })).toEqual(
      [],
    );
  });

  it('campo oculto (dependente de opção não escolhida) não avisa', () => {
    expect(pending({ 'sdr.canal': 'nenhum', 'sdr.numero': '[preencher: número]' })).toEqual([]);
    expect(pending({ 'sdr.canal': 'whats', 'sdr.numero': '[preencher: número]' })).toHaveLength(1);
  });
});
