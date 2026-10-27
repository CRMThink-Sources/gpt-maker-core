import { describe, expect, it } from 'vitest';
import { type FunctionAnswers, validateFunctionAnswers } from './agent-function-answers';
import { compileAgent } from './agent-function-compiler';
import { contentHash, diffLines, planPublication, publishedStateOf } from './agent-function-plan';
import { sdrFixture } from './agent-functions.fixture';

const A = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const B = '1b9e4d2c-8f3a-4e5b-a6c7-d8e9f0a1b2c3';

const raw: FunctionAnswers = {
  'empresa.nome': 'CRMThink',
  'empresa.descricao': 'Implantação de Bitrix24.',
  'comum.tom': 'normal',
  'comum.emojis': 'nao',
  'sdr.perguntas': ['Quantos vendedores?'],
  'sdr.cliente_atual': 'transferir',
  'registro.onde': 'conversa',
  'base.produtos': [
    { itemKey: A, values: { nome: 'Plano Pro', descricao: 'CRM completo' } },
    { itemKey: B, values: { nome: 'Plano Start', descricao: 'Para começar' } },
  ],
};

const compile = (answers: FunctionAnswers) =>
  compileAgent({
    content: sdrFixture,
    answers: validateFunctionAnswers(sdrFixture, answers).answers,
    agentName: 'Ana',
    mode: 'SIMPLE',
  });

describe('plano de publicação', () => {
  const published = publishedStateOf(compile(raw));

  it('primeira publicação cria tudo', () => {
    const plan = planPublication(compile(raw), null);
    expect(plan.empty).toBe(false);
    expect(plan.trainings.create).toHaveLength(2);
    expect(plan.intentions.create.map((intention) => intention.key)).toEqual(['qualificacao']);
    expect(plan.behavior.diff.every((line) => line.op === 'add')).toBe(true);
  });

  it('nada mudou', () => {
    expect(planPublication(compile(raw), published).empty).toBe(true);
  });

  it('item editado atualiza só o seu treinamento', () => {
    const edited = {
      ...raw,
      'base.produtos': [
        { itemKey: A, values: { nome: 'Plano Pro', descricao: 'CRM completo com IA' } },
        { itemKey: B, values: { nome: 'Plano Start', descricao: 'Para começar' } },
      ],
    };
    const plan = planPublication(compile(edited), published);
    expect(plan.trainings.update.map((training) => training.key)).toEqual([`base.produtos:${A}`]);
    expect(plan.trainings.create).toEqual([]);
    expect(plan.trainings.remove).toEqual([]);
    expect(plan.behavior.changed).toBe(false);
  });

  it('item removido e item novo', () => {
    const C = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
    const plan = planPublication(
      compile({
        ...raw,
        'base.produtos': [{ itemKey: C, values: { nome: 'Plano Max', descricao: 'Tudo' } }],
      }),
      published,
    );
    expect(plan.trainings.create.map((training) => training.key)).toEqual([`base.produtos:${C}`]);
    expect(plan.trainings.remove).toEqual([`base.produtos:${A}`, `base.produtos:${B}`]);
  });

  it('mudança de escolha muda comportamento, tom, settings e intenção', () => {
    const plan = planPublication(
      compile({
        ...raw,
        'comum.tom': 'formal',
        'comum.emojis': 'sim',
        'sdr.perguntas': ['Quantos vendedores?', 'Usa CRM?'],
      }),
      published,
    );
    expect(plan.agent).toEqual([{ field: 'communicationType', from: 'NORMAL', to: 'FORMAL' }]);
    expect(plan.settings).toEqual([{ key: 'enabledEmoji', from: false, to: true }]);
    expect(plan.intentions.update.map((intention) => intention.key)).toEqual(['qualificacao']);
    expect(plan.behavior.diff).toContainEqual({
      op: 'remove',
      text: 'Use linguagem cordial. Não use emojis.',
    });
    expect(plan.behavior.diff).toContainEqual({
      op: 'add',
      text: 'Use linguagem formal. Pode usar emojis.',
    });
  });
});

describe('utilitários', () => {
  it('hash estável para a mesma estrutura em outra ordem', () => {
    expect(contentHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      contentHash({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
    expect(contentHash('x')).not.toBe(contentHash('y'));
  });

  it('diff por linhas', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'remove', text: 'b' },
      { op: 'add', text: 'x' },
      { op: 'equal', text: 'c' },
    ]);
  });
});
