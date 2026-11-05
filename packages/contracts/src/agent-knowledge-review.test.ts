import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  aiKeyInputSchema,
  aiKeyViewSchema,
  createReviewInputSchema,
  createReviewResultSchema,
  reviewableFields,
  reviewCrossInputSchema,
  reviewCrossResultSchema,
  reviewGapsInputSchema,
  reviewGapsModelOutputSchema,
  reviewGapsResultSchema,
  reviewErrorCodeSchema,
  reviewFieldInputSchema,
  reviewFieldResultSchema,
  reviewModelFieldOutputSchema,
} from './agent-knowledge-review';
import { type FunctionField, functionFieldSchema } from './agent-functions';

const KEY = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const ID = '8a3d2c9f-3b5e-4d7f-8c2b-4e6a8f0b2d3c';

describe('contratos da revisão por IA', () => {
  it('cria a revisão com os campos escolhidos', () => {
    expect(createReviewInputSchema.safeParse({ fieldIds: ['base.faq'] }).success).toBe(true);
    expect(createReviewInputSchema.safeParse({ fieldIds: [] }).success).toBe(false);
    const result = createReviewResultSchema.safeParse({
      reviewId: ID,
      keySource: 'platform',
      creditsPerField: 2,
    });
    expect(result.success).toBe(true);
    expect(
      createReviewResultSchema.safeParse({ reviewId: ID, keySource: 'outra', creditsPerField: 2 })
        .success,
    ).toBe(false);
    expect(
      createReviewResultSchema.safeParse({ reviewId: ID, keySource: 'tenant', creditsPerField: -1 })
        .success,
    ).toBe(false);
  });

  it('recebe as respostas da tela ao revisar um campo', () => {
    const input = {
      fieldId: 'base.faq',
      answers: { 'base.faq': [{ itemKey: KEY, values: { pergunta: 'a', resposta: 'b' } }] },
    };
    expect(reviewFieldInputSchema.safeParse(input).success).toBe(true);
    expect(reviewFieldInputSchema.safeParse({ ...input, fieldId: '' }).success).toBe(false);
  });

  it('valida a saída da IA e aceita item sem problema nem sugestão', () => {
    const output = {
      summary: 'Soluções sem passos.',
      items: [
        {
          index: 0,
          problems: [
            { category: 'incomplete', severity: 'blocks', text: 'A solução não tem passos.' },
          ],
          suggestion: { solucao: '1. Abra o menu. 2. Troque a senha.' },
        },
        { index: 1 },
      ],
    };
    const parsed = reviewModelFieldOutputSchema.safeParse(output);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items[1]!.problems).toEqual([]);
  });

  it('recusa saída da IA fora do formato', () => {
    const bad = (value: unknown) => reviewModelFieldOutputSchema.safeParse(value).success;
    expect(bad({ items: [] })).toBe(false);
    expect(bad({ summary: 'x', items: [{ index: -1 }] })).toBe(false);
    expect(
      bad({
        summary: 'x',
        items: [{ index: 0, problems: [{ category: 'other', severity: 'polish', text: '' }] }],
      }),
    ).toBe(false);
    expect(bad({ summary: 'x', items: [{ index: 0, suggestion: 'texto solto' }] })).toBe(false);
    expect(bad({ summary: 'y'.repeat(501), items: [] })).toBe(false);
    expect(
      bad({ summary: 'x', items: [{ index: 0, suggestion: { text: 'z'.repeat(1029) } }] }),
    ).toBe(false);
  });

  it('entrega o resultado do campo com a sugestão marcada como aplicável ou não', () => {
    const result = {
      fieldId: 'base.problemas',
      summary: 'ok',
      items: [
        {
          index: 0,
          problems: [],
          suggestion: { values: { solucao: 'texto' }, applicable: false },
        },
      ],
    };
    expect(reviewFieldResultSchema.safeParse(result).success).toBe(true);
    expect(
      reviewFieldResultSchema.safeParse({
        ...result,
        items: [{ index: 0, problems: [], suggestion: { values: { solucao: 'texto' } } }],
      }).success,
    ).toBe(false);
  });

  it('pede contradições com pelo menos dois resumos', () => {
    const summary = (fieldId: string) => ({ fieldId, summary: 'resumo' });
    expect(
      reviewCrossInputSchema.safeParse({ summaries: [summary('a'), summary('b')] }).success,
    ).toBe(true);
    expect(reviewCrossInputSchema.safeParse({ summaries: [summary('a')] }).success).toBe(false);
    expect(
      reviewCrossResultSchema.safeParse({
        contradictions: [{ fields: ['base.politicas', 'base.faq'], text: '7 dias contra 30 dias' }],
      }).success,
    ).toBe(true);
    expect(
      reviewCrossResultSchema.safeParse({ contradictions: [{ fields: [], text: 'x' }] }).success,
    ).toBe(false);
  });

  it('só aceita a chave do Vibecode no formato vibe_api_', () => {
    expect(aiKeyInputSchema.safeParse({ apiKey: ' vibe_api_abc123 ' }).data).toEqual({
      apiKey: 'vibe_api_abc123',
    });
    const wrong = aiKeyInputSchema.safeParse({ apiKey: 'sk-123' });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.message).toBe('a chave começa com vibe_api_');
  });

  it('mostra a chave sem o valor dela', () => {
    const view = {
      configured: true,
      last4: '1a2b',
      verifiedAt: '2026-11-02T10:00:00.000Z',
      creditsPerField: 2,
      platformAvailable: true,
    };
    expect(aiKeyViewSchema.safeParse(view).success).toBe(true);
    expect(
      aiKeyViewSchema.safeParse({ ...view, configured: false, last4: null, verifiedAt: null })
        .success,
    ).toBe(true);
    // A tela nunca recebe a chave: um campo a mais é descartado, não repassado.
    expect(aiKeyViewSchema.parse({ ...view, apiKey: 'vibe_api_x' })).not.toHaveProperty('apiKey');
    expect(aiKeyViewSchema.safeParse({ ...view, last4: '1a2b3' }).success).toBe(false);
  });

  it('lista os códigos de erro que o app traduz', () => {
    expect(reviewErrorCodeSchema.options).toContain('NO_CREDIT');
    expect(reviewErrorCodeSchema.safeParse('QUALQUER').success).toBe(false);
  });
});

describe('campos revisáveis', () => {
  const fields: FunctionField[] = z.array(functionFieldSchema).parse([
    { kind: 'TEXT', id: 'empresa.nome', label: 'Nome', required: true, maxLength: 100 },
    { kind: 'URL', id: 'empresa.site', label: 'Site', required: false },
    {
      kind: 'TEXT_LIST',
      id: 'sdr.perguntas',
      label: 'Perguntas',
      required: false,
      minItems: 0,
      maxItems: 5,
      itemMaxLength: 50,
    },
    {
      kind: 'KNOWLEDGE',
      id: 'base.faq',
      label: 'FAQ',
      required: false,
      maxItems: 20,
      subfields: [
        { id: 'pergunta', label: 'Pergunta', required: true, maxLength: 200 },
        { id: 'resposta', label: 'Resposta', required: true, maxLength: 800 },
      ],
      format: 'P: {{pergunta}}\nR: {{resposta}}',
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
            { kind: 'TEXT', id: 'sdr.numero', label: 'Número', required: true, maxLength: 30 },
          ],
        },
      ],
    },
  ]);
  const ids = (answers: Record<string, unknown>) =>
    reviewableFields({ fields }, answers as never).map((field) => field.id);

  it('devolve só texto, lista e base com resposta', () => {
    expect(
      ids({
        'empresa.nome': 'CRMThink',
        'empresa.site': 'https://crmthink.com.br',
        'sdr.perguntas': ['Qual o prazo?'],
        'base.faq': [{ itemKey: KEY, values: { pergunta: 'Como?', resposta: '' } }],
        'sdr.canal': 'nenhum',
      }),
    ).toEqual(['empresa.nome', 'sdr.perguntas', 'base.faq']);
  });

  it('ignora campo vazio, lista de brancos e base sem texto', () => {
    expect(
      ids({
        'empresa.nome': '  ',
        'sdr.perguntas': [' ', ''],
        'base.faq': [{ itemKey: KEY, values: { pergunta: ' ', resposta: '' } }],
      }),
    ).toEqual([]);
  });

  it('inclui o dependente só com a opção escolhida', () => {
    expect(ids({ 'sdr.canal': 'nenhum', 'sdr.numero': '11999990000' })).toEqual([]);
    expect(ids({ 'sdr.canal': 'whats', 'sdr.numero': '11999990000' })).toEqual(['sdr.numero']);
  });

  it('não quebra com respostas fora do formato', () => {
    expect(() =>
      ids({ 'empresa.nome': 5, 'sdr.perguntas': 'x', 'base.faq': [null, 3] }),
    ).not.toThrow();
  });
});

describe('cobertura da base (agent-knowledge-gaps)', () => {
  const input = {
    expectation: 'Cliente pede segunda via de boleto e troca de produto.',
    answers: {},
    summaries: [],
  };

  it('createReview aceita withGaps', () => {
    expect(createReviewInputSchema.parse({ fieldIds: ['base.faq'], withGaps: true }).withGaps).toBe(
      true,
    );
  });

  it('a expectativa vale de 20 a 1000 caracteres, aparada', () => {
    expect(reviewGapsInputSchema.safeParse(input).success).toBe(true);
    expect(reviewGapsInputSchema.safeParse({ ...input, expectation: 'atender bem' }).success).toBe(
      false,
    );
    expect(
      reviewGapsInputSchema.safeParse({ ...input, expectation: 'x'.repeat(1001) }).success,
    ).toBe(false);
    expect(
      reviewGapsInputSchema.safeParse({
        ...input,
        expectation: ` ${'x'.repeat(10)}${' '.repeat(30)}`,
      }).success,
    ).toBe(false);
  });

  it('resumos podem ser vazios (base ainda vazia)', () => {
    expect(reviewGapsInputSchema.safeParse({ ...input, summaries: [] }).success).toBe(true);
  });

  it('saída da IA: lacuna sem campo é recusada; listas ausentes viram vazias', () => {
    expect(reviewGapsModelOutputSchema.parse({})).toEqual({ gaps: [], covered: [] });
    expect(
      reviewGapsModelOutputSchema.safeParse({
        gaps: [{ title: 'Boleto', why: 'x', item: {} }],
      }).success,
    ).toBe(false);
    expect(
      reviewGapsModelOutputSchema.safeParse({
        gaps: [
          {
            fieldId: 'base.problemas',
            title: 'Segunda via de boleto',
            why: 'A expectativa cita boleto e a base não trata.',
            item: { problema: 'Preciso da 2ª via', solucao: 'Em [preencher: onde pedir]' },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('resultado entregue ao app aceita o motivo de não poder adicionar', () => {
    expect(
      reviewGapsResultSchema.safeParse({
        gaps: [{ fieldId: 'f', title: 't', why: 'w', item: {}, applicable: false, reason: 'FULL' }],
        covered: [{ text: 'Prazo de entrega' }],
      }).success,
    ).toBe(true);
    expect(
      reviewGapsResultSchema.safeParse({
        gaps: [{ fieldId: 'f', title: 't', why: 'w', item: {}, applicable: false, reason: 'X' }],
        covered: [],
      }).success,
    ).toBe(false);
  });

  it('normaliza categoria e gravidade desconhecidas sem derrubar o campo', () => {
    const parsed = reviewModelFieldOutputSchema.parse({
      summary: 'x',
      items: [
        {
          index: 0,
          problems: [
            { category: 'tom_de_voz', severity: 'urgente', text: 'Tom informal demais.' },
            { text: 'Sem categoria nem gravidade.' },
            { category: 'missing_term', severity: 'blocks', text: 'Falta o prazo.' },
          ],
        },
      ],
    });
    expect(parsed.items[0]!.problems).toEqual([
      { category: 'other', severity: 'polish', text: 'Tom informal demais.' },
      { category: 'other', severity: 'polish', text: 'Sem categoria nem gravidade.' },
      { category: 'missing_term', severity: 'blocks', text: 'Falta o prazo.' },
    ]);
  });

  it('aceita a expectativa ao criar a revisão, com os mesmos limites da cobertura', () => {
    const base = { fieldIds: ['a'] };
    expect(createReviewInputSchema.safeParse(base).success).toBe(true);
    const ok = 'Atender dúvidas de troca e envio.';
    expect(createReviewInputSchema.safeParse({ ...base, expectation: ok }).success).toBe(true);
    expect(createReviewInputSchema.safeParse({ ...base, expectation: 'curta' }).success).toBe(
      false,
    );
    expect(
      createReviewInputSchema.safeParse({ ...base, expectation: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });
});
