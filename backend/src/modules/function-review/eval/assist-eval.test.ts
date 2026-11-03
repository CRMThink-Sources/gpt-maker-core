import { describe, expect, it } from 'vitest';
import {
  type AssistCase,
  assistFieldOf,
  evaluateAssistCase,
  formatAssistReport,
  loadAssistCases,
  runAssistEval,
} from './assist-eval';

const base: AssistCase = {
  id: 'teste',
  template: 'SDR',
  fieldId: 'sdr.criterio',
  kind: 'complete',
  about: 'Vendemos CRM para clínicas.',
  questions: ['O que qualifica um lead?'],
  interview: [{ question: 'O que qualifica um lead?', answer: 'Ter 5 vendedores' }],
};

const text = (value: string) => ({ fields: [{ fieldId: 'sdr.criterio', text: value }] });

describe('avaliador da ajuda da IA', () => {
  it('flags a number that is not in the interview', () => {
    const result = evaluateAssistCase(base, text('Qualificado com 10 vendedores e 5 filiais.'));
    expect(result.inventedFacts).toEqual(['10']);
    expect(result.overLimit).toBe(false);
  });

  it('accepts facts that come from the interview', () => {
    const result = evaluateAssistCase(
      base,
      text('Qualificado com 5 vendedores. Fala com a Clínica. [preencher: prazo de 30 dias]'),
    );
    expect(result.inventedFacts).toEqual([]);
    expect(result.markers).toBe(1);
  });

  it('flags proper names, prices and terms of time that were not said', () => {
    const result = evaluateAssistCase(
      base,
      text('Qualificado se usa o Salesforce, paga R$ 300 e fecha na segunda.'),
    );
    expect(result.inventedFacts).toEqual(expect.arrayContaining(['300', 'Salesforce', 'segunda']));
  });

  it('flags text above the limit', () => {
    const field = assistFieldOf(base);
    const long = 'a'.repeat((field.kind === 'TEXT' ? field.maxLength : 0) + 1);
    expect(evaluateAssistCase(base, text(long)).overLimit).toBe(true);
  });

  it('flags a list above the item limits and reads items', () => {
    const list: AssistCase = { ...base, fieldId: 'sdr.perguntas' };
    const tooMany = { fields: [{ fieldId: 'sdr.perguntas', items: Array(6).fill('Quantos?') }] };
    expect(evaluateAssistCase(list, tooMany).overLimit).toBe(true);
    const ok = { fields: [{ fieldId: 'sdr.perguntas', items: ['Quantos vendedores?'] }] };
    expect(evaluateAssistCase(list, ok)).toEqual({
      inventedFacts: [],
      overLimit: false,
      markers: 0,
    });
  });

  it('all cases load and validate', () => {
    const cases = loadAssistCases();
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    for (const kind of ['complete', 'empty', 'unknown'] as const) {
      expect(cases.some((entry) => entry.kind === kind)).toBe(true);
    }
    expect(new Set(cases.map((entry) => entry.template))).toEqual(new Set(['SDR', 'SUPPORT']));
    for (const entry of cases) {
      expect(assistFieldOf(entry).assist?.questions).toEqual(entry.questions);
      if (entry.kind === 'empty') expect(entry.interview).toEqual([]);
    }
  });

  it('runs the cases with a fake chat and reports invented facts', async () => {
    const cases = [base];
    const report = await runAssistEval(
      cases,
      async () => JSON.stringify(text('Qualificado com 99 vendedores.')),
      1,
    );
    expect(report.inventedFacts).toBe(1);
    expect(report.perCase[0]!.failed).toBe(0);
    expect(formatAssistReport(report)).toContain('teste');
    const broken = await runAssistEval(cases, async () => 'nada', 1);
    expect(broken.perCase[0]!.failed).toBe(1);
  });
});
