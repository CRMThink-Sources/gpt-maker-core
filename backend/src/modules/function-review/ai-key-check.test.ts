import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../shared/http/api-exception.filter';
import { VibecodeError } from '../vibecode';
import { verifyAiKey } from './ai-key-check';

const MODEL = 'bitrix/bitrixgpt-5.5';
const KEY = 'vibe_api_segredo123';

function fake(options: {
  models?: string[] | VibecodeError;
  scopes?: string[] | null | VibecodeError;
}) {
  const settle = <T>(value: T | VibecodeError): Promise<T> =>
    value instanceof VibecodeError ? Promise.reject(value) : Promise.resolve(value);
  return {
    listModels: vi.fn(() => settle(options.models ?? [MODEL])),
    scopes: vi.fn(() => settle(options.scopes === undefined ? ['vibe:ai'] : options.scopes)),
  };
}

const vibecodeError = (code: ConstructorParameters<typeof VibecodeError>[0]) =>
  new VibecodeError(code, 'models', 'falhou', { status: 400 });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    const domain = error as DomainError;
    return { code: domain.code, message: domain.message, status: domain.getStatus() };
  }
  throw new Error('esperava recusa');
}

describe('verifyAiKey', () => {
  it('aceita chave que enxerga o modelo e só tem vibe:ai', async () => {
    const vibecode = fake({});
    await expect(verifyAiKey(vibecode, MODEL, KEY)).resolves.toBeUndefined();
    expect(vibecode.listModels).toHaveBeenCalledWith(KEY);
    expect(vibecode.scopes).toHaveBeenCalledWith(KEY);
  });

  it('recusa chave que o Vibecode não aceita', async () => {
    const vibecode = fake({ models: vibecodeError('AI_KEY_INVALID') });
    expect(await refusal(verifyAiKey(vibecode, MODEL, KEY))).toMatchObject({
      code: 'AI_KEY_INVALID',
      status: 422,
    });
    expect(vibecode.scopes).not.toHaveBeenCalled();
  });

  it('recusa chave sem o escopo de IA, vinda do teste de modelos', async () => {
    const vibecode = fake({ models: vibecodeError('AI_KEY_SCOPE') });
    expect(await refusal(verifyAiKey(vibecode, MODEL, KEY))).toMatchObject({
      code: 'AI_KEY_SCOPE',
      message: 'A chave precisa ter o escopo vibe:ai.',
    });
  });

  it('recusa chave que não enxerga o modelo da revisão', async () => {
    const vibecode = fake({ models: ['bitrix/outro'] });
    expect(await refusal(verifyAiKey(vibecode, MODEL, KEY))).toMatchObject({
      code: 'AI_MODEL_UNAVAILABLE',
    });
  });

  it('recusa chave cujos escopos não incluem vibe:ai', async () => {
    const vibecode = fake({ scopes: ['vibe:storage'] });
    expect(await refusal(verifyAiKey(vibecode, MODEL, KEY))).toMatchObject({
      code: 'AI_KEY_SCOPE',
      message: 'A chave precisa ter o escopo vibe:ai.',
    });
  });

  it('recusa chave com escopos além de vibe:ai, explicando o motivo', async () => {
    const vibecode = fake({ scopes: ['vibe:ai', 'crm'] });
    const result = await refusal(verifyAiKey(vibecode, MODEL, KEY));
    expect(result.code).toBe('AI_KEY_SCOPE');
    expect(result.message).toContain('outras permissões');
    expect(result.status).toBe(422);
  });

  it('aceita quando a resposta não traz os escopos', async () => {
    await expect(verifyAiKey(fake({ scopes: null }), MODEL, KEY)).resolves.toBeUndefined();
  });

  it('aceita quando /v1/me falha por outro motivo, valendo só a orientação na tela', async () => {
    const vibecode = fake({ scopes: vibecodeError('AI_UNAVAILABLE') });
    await expect(verifyAiKey(vibecode, MODEL, KEY)).resolves.toBeUndefined();
  });

  it('recusa quando /v1/me rejeita a chave', async () => {
    const vibecode = fake({ scopes: vibecodeError('AI_KEY_INVALID') });
    expect(await refusal(verifyAiKey(vibecode, MODEL, KEY))).toMatchObject({
      code: 'AI_KEY_INVALID',
    });
  });

  it('Vibecode fora do ar vira 503 sem salvar nada', async () => {
    const vibecode = fake({ models: vibecodeError('AI_UNAVAILABLE') });
    expect(await refusal(verifyAiKey(vibecode, MODEL, KEY))).toMatchObject({
      code: 'AI_UNAVAILABLE',
      status: 503,
    });
  });

  it('a mensagem de recusa nunca traz a chave', async () => {
    const vibecode = fake({ scopes: ['vibe:ai', 'crm'] });
    const result = await refusal(verifyAiKey(vibecode, MODEL, KEY));
    expect(result.message).not.toContain(KEY);
  });
});
