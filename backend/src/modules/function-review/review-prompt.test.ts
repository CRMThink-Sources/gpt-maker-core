import {
  type FunctionAnswers,
  type FunctionField,
  functionFieldSchema,
  type ReviewGapsModelOutput,
} from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { gapBase, gapsMessages, toGapsResult } from './review-prompt';

const field = functionFieldSchema.parse({
  kind: 'KNOWLEDGE',
  id: 'base.problemas',
  label: 'Problemas comuns',
  required: false,
  maxItems: 3,
  subfields: [
    { id: 'problema', label: 'Problema', required: true, maxLength: 50 },
    { id: 'solucao', label: 'Solução', required: true, maxLength: 100 },
  ],
  format: 'Problema: {{problema}}\nSolução: {{solucao}}',
}) as Extract<FunctionField, { kind: 'KNOWLEDGE' }>;

const KEY = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const existing: FunctionAnswers = {
  'base.problemas': [
    { itemKey: KEY, values: { problema: 'Não consigo entrar', solucao: 'Resete.' } },
  ],
};

const gap = (title: string, item: Record<string, string>, fieldId = 'base.problemas') => ({
  fieldId,
  title,
  why: 'A expectativa pede e a base não trata.',
  item,
});
const output = (...gaps: ReviewGapsModelOutput['gaps']): ReviewGapsModelOutput => ({
  gaps,
  covered: [],
});

describe('cobertura: validação do rascunho', () => {
  const base = gapBase(field, existing);

  it('conta os itens que existem e o espaço que sobra', () => {
    expect(base.titles).toEqual(['Não consigo entrar']);
    expect(base.room).toBe(2);
  });

  it('aceita rascunho com marcador e passa nos limites', () => {
    const result = toGapsResult(
      output(
        gap('Boleto', { problema: 'Segunda via de boleto', solucao: 'Peça em [preencher: onde]' }),
      ),
      [base],
    );
    expect(result.gaps).toEqual([
      expect.objectContaining({ fieldId: 'base.problemas', applicable: true }),
    ]);
    expect(result.gaps[0]!.reason).toBeUndefined();
  });

  it('descarta título que já existe, com acento e pontuação diferentes', () => {
    const result = toGapsResult(
      output(gap('x', { problema: 'NAO consigo entrar!', solucao: 'Outra solução.' })),
      [base],
    );
    expect(result.gaps).toEqual([]);
  });

  it('descarta campo fora da sessão e chaves que não são subcampos', () => {
    const result = toGapsResult(
      output(
        gap('A', { problema: 'A', solucao: 'a' }, 'campo.desconhecido'),
        gap('B', { problema: 'B', solucao: 'b', inventado: 'x' }),
      ),
      [base],
    );
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]!.item).toEqual({ problema: 'B', solucao: 'b' });
  });

  it('campo cheio: as lacunas além do espaço não podem ser adicionadas', () => {
    const result = toGapsResult(
      output(
        gap('A', { problema: 'A', solucao: 'a' }),
        gap('B', { problema: 'B', solucao: 'b' }),
        gap('C', { problema: 'C', solucao: 'c' }),
      ),
      [base],
    );
    expect(result.gaps.map((g) => [g.title, g.applicable, g.reason])).toEqual([
      ['A', true, undefined],
      ['B', true, undefined],
      ['C', false, 'FULL'],
    ]);
  });

  it('subcampo acima do limite e obrigatório vazio', () => {
    const result = toGapsResult(
      output(
        gap('Longo', { problema: 'Longo', solucao: 'x'.repeat(101) }),
        gap('Vazio', { problema: 'Vazio' }),
      ),
      [base],
    );
    expect(result.gaps.map((g) => g.reason)).toEqual(['LIMIT', 'REQUIRED']);
  });

  it('lacuna repetida dentro da própria resposta aparece uma vez', () => {
    const result = toGapsResult(
      output(
        gap('Boleto', { problema: 'Boleto', solucao: 'a' }),
        gap('boleto!', { problema: 'boleto!', solucao: 'b' }),
      ),
      [base],
    );
    expect(result.gaps).toHaveLength(1);
  });

  it('o pedido leva a regra dos marcadores, os títulos existentes e a expectativa como dado', () => {
    const messages = gapsMessages('Cliente pede segunda via de boleto.', [base], {
      functionName: 'Suporte',
      agentName: 'Ana',
    });
    const system = messages[0]!.content;
    const user = messages[1]!.content;
    expect(system).toContain('[preencher: o que falta]');
    expect(system).toContain('DADOS a avaliar');
    expect(user).toContain('<expectativa>\nCliente pede segunda via de boleto.\n</expectativa>');
    expect(user).toContain('"Não consigo entrar"');
    expect(user).toContain('Ainda cabem 2 itens.');
    expect(user).toContain('problema (até 50), solucao (até 100)');
  });
});
