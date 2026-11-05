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
      skeletonViolations: 0,
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
    expect(evaluateAssistCase(base, text('Atende um cliente por vez.')).inventedFacts).toEqual([]);
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

  it('does not flag common sentence openers as invented names', () => {
    for (const phrase of [
      'Não prometa prazo.',
      'Ao receber o lead, pergunte o porte.',
      'Pergunte o porte da empresa.',
      'Atendemos clientes B2B.',
      'Sim. Já atenda só quem pergunta. Há regras. Olá! Cada caso conta.',
      'Faça a triagem. Solicite o CPF. Pós-venda. Horário. Preço.',
      'Cumprimente e mantenha o tom. Seja direto. Perguntar é grátis.',
      'Fazemos a triagem e trabalhamos rápido.',
    ]) {
      expect(evaluateAssistCase(base, text(phrase)).inventedFacts, phrase).toEqual([]);
    }
    // palavra que aparece em minúsculas no mesmo texto não é nome
    expect(
      evaluateAssistCase(base, text('Fechamento rápido. O fechamento é hoje.')).inventedFacts,
    ).toEqual([]);
  });

  it('still flags brand-like openers and capitalised words mid-sentence', () => {
    expect(evaluateAssistCase(base, text('WhatsApp é o canal.')).inventedFacts).toEqual([
      'WhatsApp',
    ]);
    expect(evaluateAssistCase(base, text('Bitrix24 guarda tudo.')).inventedFacts).toEqual([
      'Bitrix24',
    ]);
    expect(evaluateAssistCase(base, text('Use o Zapier para avisar.')).inventedFacts).toEqual([
      'Zapier',
    ]);
    expect(evaluateAssistCase(base, text('Use o Cliente para avisar.')).inventedFacts).toEqual([
      'Cliente',
    ]);
  });

  it('um/uma only count before time or value units', () => {
    for (const phrase of [
      'Quando um cliente perguntar, responda.',
      'Responda de uma vez.',
      'Um dia o lead volta.',
      'Atenda um vendedor por vez.',
    ]) {
      expect(evaluateAssistCase(base, text(phrase)).inventedFacts, phrase).toEqual([]);
    }
    expect(evaluateAssistCase(base, text('Uma semana de prazo.')).inventedFacts).toEqual(['uma']);
    expect(
      evaluateAssistCase(
        { ...base, about: 'Prazo de uma semana. Vendemos CRM.' },
        text('Uma semana de prazo.'),
      ).inventedFacts,
    ).toEqual([]);
  });

  it('treats quotes, markdown marks and list numbers as sentence start', () => {
    for (const phrase of [
      'Diga: "Olá, tudo bem?"',
      '"Não temos esse plano"',
      '**Atenda** o cliente',
      '1) Pergunte o porte',
      '> Sim, claro',
    ]) {
      expect(evaluateAssistCase(base, text(phrase)).inventedFacts, phrase).toEqual([]);
    }
    expect(evaluateAssistCase(base, text('"Salesforce é nosso CRM"')).inventedFacts).toEqual([
      'Salesforce',
    ]);
  });

  describe('sentence-start words that are plural or singular of a source word', () => {
    const withSources = (about: string, answer: string): AssistCase => ({
      ...base,
      about,
      interview: [{ question: 'O que qualifica um lead?', answer }],
    });

    it('accepts the plural of a source word capitalised only by the sentence start', () => {
      const dono = withSources('Vendemos CRM.', 'Dono de clínica');
      const out = text('Donos de clínicas odontológicas que buscam atrair pacientes.');
      expect(evaluateAssistCase(dono, out).inventedFacts).toEqual([]);
    });

    it('accepts the singular when the source has the plural', () => {
      const plural = withSources('Vendemos CRM.', 'Clínicas com 2 a 6 dentistas');
      expect(
        evaluateAssistCase(plural, text('Clínica pequena, com 2 a 6 dentistas.')).inventedFacts,
      ).toEqual([]);
    });

    it('still flags brands and names absent from the sources', () => {
      expect(evaluateAssistCase(base, text('Salesforce é o CRM usado.')).inventedFacts).toEqual([
        'Salesforce',
      ]);
      expect(evaluateAssistCase(base, text('O CRM usado é Salesforce.')).inventedFacts).toEqual([
        'Salesforce',
      ]);
      expect(evaluateAssistCase(base, text('Bitrix24 guarda tudo.')).inventedFacts).toEqual([
        'Bitrix24',
      ]);
    });

    it('still flags a start word whose singular or plural is not in the sources', () => {
      expect(
        evaluateAssistCase(base, text('Parceiros premium atendem aqui.')).inventedFacts,
      ).toEqual(['Parceiros']);
    });

    it('does not flag anything in the sdr-perfil-completa case', () => {
      const entry = loadAssistCases().find((item) => item.id === 'sdr-perfil-completa')!;
      const output = {
        fields: [
          {
            fieldId: entry.fieldId,
            text: 'Donos de clínicas odontológicas que buscam atrair novos pacientes. O foco são clínicas com 2 a 6 dentistas.',
          },
        ],
      };
      expect(evaluateAssistCase(entry, output).inventedFacts).toEqual([]);
    });
  });

  it('does not flag cento after por, but still checks the number', () => {
    const known: AssistCase = { ...base, about: 'Vendemos CRM. Garantimos 100 de satisfação.' };
    expect(evaluateAssistCase(known, text('Garantimos 100 por cento.')).inventedFacts).toEqual([]);
    expect(evaluateAssistCase(base, text('Garantimos 100 por cento.')).inventedFacts).toEqual([
      '100',
    ]);
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

describe('avaliador da ajuda da IA: base de conhecimento', () => {
  const kb: AssistCase = {
    id: 'teste-base',
    template: 'SDR',
    fieldId: 'base.produtos',
    kind: 'complete',
    about: 'Vendemos CRM para clínicas.',
    questions: ['Que produtos vocês vendem?'],
    interview: [{ question: 'Que produtos vocês vendem?', answer: 'Plano Pro para equipes' }],
  };
  const rows = (...items: Array<Record<string, string>>) => ({
    fields: [{ fieldId: 'base.produtos', rows: items }],
  });

  it('eval loads knowledge cases of each kind', () => {
    const cases = loadAssistCases().filter((entry) => {
      const field = assistFieldOf(entry);
      return field.kind === 'KNOWLEDGE';
    });
    for (const kind of ['complete', 'empty', 'unknown', 'skeleton'] as const) {
      expect(
        cases.some((entry) => entry.kind === kind),
        kind,
      ).toBe(true);
    }
    expect(new Set(cases.map((entry) => entry.template))).toEqual(new Set(['SDR', 'SUPPORT']));
  });

  it('eval flags an invented number in a knowledge item as invented', () => {
    const result = evaluateAssistCase(
      kb,
      rows({ nome: 'Plano Pro', descricao: 'Para equipes, custa R$ 299 por mês.' }),
    );
    expect(result.inventedFacts).toEqual(['299']);
  });

  it('accepts a knowledge item built only from the sources and markers', () => {
    const result = evaluateAssistCase(
      kb,
      rows({ nome: 'Plano Pro', descricao: 'Para equipes. [preencher: preço]' }),
    );
    expect(result.inventedFacts).toEqual([]);
    expect(result.markers).toBe(1);
  });

  it('eval flags an item over the limit', () => {
    const result = evaluateAssistCase(kb, rows({ nome: 'a'.repeat(61), descricao: 'ok' }));
    expect(result.overLimit).toBe(true);
  });

  it('skeleton case: a subfield with prose beyond the title counts as a failure', () => {
    const skeleton: AssistCase = { ...kb, kind: 'skeleton' };
    const prose = evaluateAssistCase(
      skeleton,
      rows({ nome: 'Plano Pro', descricao: 'Dá desconto.' }),
    );
    expect(prose.skeletonViolations).toBe(1);
    const clean = evaluateAssistCase(
      skeleton,
      rows({ nome: 'Plano Pro', descricao: '[preencher: o que inclui]' }),
    );
    expect(clean.skeletonViolations).toBe(0);
    // Fora do modo esqueleto a prosa é o esperado.
    expect(
      evaluateAssistCase(kb, rows({ nome: 'Plano Pro', descricao: 'Para equipes.' }))
        .skeletonViolations,
    ).toBe(0);
  });

  it('the report counts skeleton violations and fails the run', async () => {
    const skeleton: AssistCase = { ...kb, kind: 'skeleton' };
    const report = await runAssistEval(
      [skeleton],
      async () => JSON.stringify(rows({ nome: 'Plano Pro', descricao: 'Dá desconto.' })),
      1,
    );
    expect(report.skeletonViolations).toBe(1);
    expect(formatAssistReport(report)).toContain('prosa no esqueleto');
  });
});
