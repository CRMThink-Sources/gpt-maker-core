import { describe, expect, it } from 'vitest';
import { interpretCallback } from './training-callback';

describe('leitura do callback de treinamento', () => {
  it.each([
    [{ status: 'DONE' }],
    [{ status: 'completed' }],
    [{ status: 'TRAINING_FINISHED' }],
    [{ event: 'training.success' }],
    [{ success: true }],
    [{ data: { status: 'SUCCESS' } }],
  ])('conclusão: %j', (payload) => {
    expect(interpretCallback(payload)).toMatchObject({ status: 'DONE' });
  });

  it.each([
    [{ status: 'FAILED', error: 'site fora do ar' }, 'site fora do ar'],
    [{ status: 'error', message: 'arquivo corrompido' }, 'arquivo corrompido'],
    [{ success: false, error: { message: 'sem acesso' } }, 'sem acesso'],
    [{ error: 'timeout' }, 'timeout'],
    [{ training: { status: 'FAILURE' } }, 'O GPTMaker não conseguiu processar'],
  ])('falha: %j', (payload, error) => {
    expect(interpretCallback(payload)).toEqual({ status: 'FAILED', error });
  });

  it.each([[{}], [null], ['ok'], [[1, 2]], [{ status: 'PROCESSING' }], [{ foo: 'bar' }]])(
    'não reconhecido: %j',
    (payload) => {
      expect(interpretCallback(payload)).toEqual({ status: 'unknown' });
    },
  );

  it('pega o id do treinamento só de campos explícitos', () => {
    expect(interpretCallback({ status: 'DONE', trainingId: 'tr-1' })).toEqual({
      status: 'DONE',
      gptmakerTrainingId: 'tr-1',
    });
    expect(interpretCallback({ data: { id: 'tr-2', status: 'DONE' } })).toMatchObject({
      gptmakerTrainingId: 'tr-2',
    });
    // `id` no topo pode ser do evento.
    expect(interpretCallback({ id: 'evt-1', status: 'DONE' })).toEqual({ status: 'DONE' });
  });

  it('corta mensagens de erro longas', () => {
    const outcome = interpretCallback({ status: 'FAILED', error: 'x'.repeat(2000) });
    expect(outcome.status === 'FAILED' && outcome.error.length).toBe(500);
  });
});
