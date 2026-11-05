import { flattenFields, reviewableFields } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { loadCases, toAnswers } from './eval-case';
import { loadSeedTemplate } from './eval-template';

// Valida o conjunto de casos sem chamar a IA (roda no CI): a avaliação em si é sob demanda.
describe('casos de avaliação da revisão', () => {
  const cases = loadCases();
  const template = loadSeedTemplate();
  const fieldIds = new Set(flattenFields(template.fields).map((field) => field.id));

  it('tem de 10 a 15 casos, com ids únicos', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.length).toBeLessThanOrEqual(15);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
  });

  it('cobre bom, ruim, contradição, repetição e instrução escondida', () => {
    const types = new Set(cases.map((entry) => entry.type));
    for (const type of ['good', 'bad', 'contradiction', 'duplicate', 'injection'] as const) {
      expect(types.has(type), `falta caso do tipo ${type}`).toBe(true);
    }
  });

  it.each(cases.map((entry) => [entry.id, entry] as const))(
    '%s: só usa campos do template e respostas que a revisão lê',
    (_id, testCase) => {
      for (const fieldId of Object.keys(testCase.answers)) expect(fieldIds.has(fieldId)).toBe(true);
      for (const expected of testCase.expected) expect(fieldIds.has(expected.fieldId)).toBe(true);
      for (const fieldId of testCase.crossFields ?? []) expect(fieldIds.has(fieldId)).toBe(true);
      const readable = new Set(
        reviewableFields(template, toAnswers(testCase)).map((field) => field.id),
      );
      for (const fieldId of Object.keys(testCase.answers)) {
        expect(readable.has(fieldId), `${fieldId} não é revisável`).toBe(true);
      }
    },
  );

  it('cada tipo declara o que espera', () => {
    for (const testCase of cases) {
      if (testCase.type === 'good') expect(testCase.expected).toEqual([]);
      if (testCase.type === 'bad' || testCase.type === 'duplicate') {
        expect(testCase.expected.length, testCase.id).toBeGreaterThan(0);
      }
      if (testCase.type === 'contradiction')
        expect(testCase.crossFields, testCase.id).toBeDefined();
      if (testCase.type === 'injection')
        expect(testCase.forbidden?.obey, testCase.id).toBeDefined();
    }
  });

  it('não tem dado pessoal real: e-mail, telefone, CPF ou CNPJ', () => {
    const text = JSON.stringify(cases);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/);
    expect(text).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(text).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  });
});
