import { describe, expect, it } from 'vitest';
import { type FunctionAnswers, validateFunctionAnswers } from './agent-function-answers';
import { compileAgent } from './agent-function-compiler';
import {
  contentHash,
  planPublication,
  publishedStateOf,
  trainingHash,
} from './agent-function-plan';
import { sdrFixture } from './agent-functions.fixture';
import { createTrainingSchema, updateTrainingSchema } from './trainings';

const A = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const B = '1b9e4d2c-8f3a-4e5b-a6c7-d8e9f0a1b2c3';
const IMAGE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_IMAGE = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

describe('treinamento de texto: schemas', () => {
  it('cria com e sem imagem', () => {
    expect(createTrainingSchema.safeParse({ type: 'TEXT', text: 'Preços' }).success).toBe(true);
    expect(
      createTrainingSchema.safeParse({ type: 'TEXT', text: 'Preços', imageId: IMAGE }).success,
    ).toBe(true);
  });

  it('recusa imageId que não é UUID', () => {
    expect(
      createTrainingSchema.safeParse({ type: 'TEXT', text: 'Preços', imageId: 'x' }).success,
    ).toBe(false);
  });

  it('edição: null remove, ausente mantém, exige ao menos um campo', () => {
    expect(updateTrainingSchema.parse({ imageId: null })).toEqual({ imageId: null });
    expect('imageId' in updateTrainingSchema.parse({ text: 'Novo' })).toBe(false);
    expect(updateTrainingSchema.safeParse({}).success).toBe(false);
    expect(updateTrainingSchema.safeParse({ imageId: 'x' }).success).toBe(false);
  });
});

describe('treinamento de texto: hash e plano', () => {
  const base = (image?: string): FunctionAnswers => ({
    'empresa.nome': 'CRMThink',
    'empresa.descricao': 'Implantação de Bitrix24.',
    'comum.tom': 'normal',
    'comum.emojis': 'nao',
    'sdr.perguntas': ['Quantos vendedores?'],
    'sdr.cliente_atual': 'transferir',
    'registro.onde': 'conversa',
    'base.produtos': [
      {
        itemKey: A,
        values: { nome: 'Plano Pro', descricao: 'CRM completo' },
        ...(image ? { imageId: image } : {}),
      },
      { itemKey: B, values: { nome: 'Plano Start', descricao: 'Para começar' } },
    ],
  });
  const compile = (answers: FunctionAnswers) =>
    compileAgent({
      content: sdrFixture,
      answers: validateFunctionAnswers(sdrFixture, answers).answers,
      agentName: 'Ana',
      mode: 'SIMPLE',
    });

  it('sem imagem o hash é o mesmo de antes (texto puro)', () => {
    const training = compile(base()).trainings[0]!;
    expect(trainingHash(training)).toBe(contentHash(training.text));
  });

  it('o imageId do item chega ao treinamento compilado', () => {
    const [first, second] = compile(base(IMAGE)).trainings;
    expect(first!.imageId).toBe(IMAGE);
    expect(second!.imageId).toBeUndefined();
  });

  it('adicionar, trocar e remover só a imagem atualiza só aquele treinamento', () => {
    const published = publishedStateOf(compile(base()));
    const added = planPublication(compile(base(IMAGE)), published);
    expect(added.trainings.update.map((t) => t.key)).toEqual([`base.produtos:${A}`]);
    expect(added.empty).toBe(false);

    const withImage = publishedStateOf(compile(base(IMAGE)));
    expect(planPublication(compile(base(IMAGE)), withImage).empty).toBe(true);
    const swapped = planPublication(compile(base(OTHER_IMAGE)), withImage);
    expect(swapped.trainings.update.map((t) => t.key)).toEqual([`base.produtos:${A}`]);
    const removed = planPublication(compile(base()), withImage);
    expect(removed.trainings.update.map((t) => t.key)).toEqual([`base.produtos:${A}`]);
  });
});
