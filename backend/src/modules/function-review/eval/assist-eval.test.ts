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
      text('Qualificado com 5 vendedores. Fala com as Clínicas. [preencher: prazo de 30 dias]'),
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

  it('does not hide numbers that follow a sentence end, only list numbering', () => {
    const result = evaluateAssistCase(
      base,
      text(
        ['Paga R$ 5000. Depois fecha em 45. Se não, (10) clientes.', '1. Ter 5 vendedores'].join(
          String.fromCharCode(10),
        ),
      ),
    );
    expect(result.inventedFacts).toEqual(['5000', '45', '10']);
  });

  it('flags spelled-out numbers absent from the sources and accepts present ones', () => {
    const out = evaluateAssistCase(
      base,
      text('Fecha em dez dias, tem cinco vendedores, duas semanas, mil clientes e uma semana.'),
    );
    expect(out.inventedFacts).toEqual(
      expect.arrayContaining(['dez', 'cinco', 'duas', 'mil', 'uma']),
    );
    const withSources: AssistCase = {
      ...base,
      about:
        'Vendemos CRM. Fechamos em dez dias, com cinco vendedores, duas semanas, mil clientes.',
    };
    expect(
      evaluateAssistCase(
        withSources,
        text('Dez dias, cinco vendedores, duas semanas, mil clientes.'),
      ).inventedFacts,
    ).toEqual([]);
    expect(
      evaluateAssistCase(base, text('Uma pessoa fala com um bom atendente.')).inventedFacts,
    ).toEqual([]);
    expect(evaluateAssistCase(base, text('Atende um cliente por vez.')).inventedFacts).toEqual([
      'um',
    ]);
  });

  it('checks proper names at the start of a sentence or list item', () => {
    expect(evaluateAssistCase(base, text('Salesforce é o CRM usado.')).inventedFacts).toEqual([
      'Salesforce',
    ]);
    const list: AssistCase = { ...base, fieldId: 'sdr.perguntas' };
    const items = {
      fields: [{ fieldId: 'sdr.perguntas', items: ['Hubspot ou RD?', 'Quando quer começar?'] }],
    };
    expect(evaluateAssistCase(list, items).inventedFacts).toEqual(['Hubspot']);
  });

  it('matches sources by whole word', () => {
    const out = evaluateAssistCase(
      { ...base, about: 'Temos um time maior que o normal.' },
      text('Fecha em maio.'),
    );
    expect(out.inventedFacts).toEqual(['maio']);
  });

  it('keeps hours and prices as one token', () => {
    expect(evaluateAssistCase(base, text('Atende às 14h30.')).inventedFacts).toEqual(['14h30']);
    expect(evaluateAssistCase(base, text('Custa R$ 1.299,90.')).inventedFacts).toEqual([
      '1.299,90',
    ]);
    const known: AssistCase = {
      ...base,
      about: 'Atendemos às 14h30 e cobramos R$ 1.299,90 por mês.',
    };
    expect(
      evaluateAssistCase(known, text('Atende às 14h30 por R$ 1.299,90.')).inventedFacts,
    ).toEqual([]);
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
