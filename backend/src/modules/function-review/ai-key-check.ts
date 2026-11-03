import { VibecodeError, type VibecodeClient } from '../vibecode';
import { fromVibecode, reviewError } from './review-errors';

/** Único escopo que a revisão precisa; qualquer outro abre dados do portal do cliente. */
const AI_SCOPE = 'vibe:ai';

/**
 * Confere a chave `vibe_api_` do cliente antes de salvar (design D6): o Vibecode a aceita, ela
 * enxerga o modelo fixo da revisão e não abre mais do que `vibe:ai`. Lança `DomainError` com a
 * mensagem do spec.
 */
export async function verifyAiKey(
  vibecode: Pick<VibecodeClient, 'listModels' | 'scopes'>,
  model: string,
  apiKey: string,
): Promise<void> {
  let models: string[];
  try {
    models = await vibecode.listModels(apiKey);
  } catch (error) {
    throw fromVibecode(error);
  }
  if (!models.includes(model)) throw reviewError('AI_MODEL_UNAVAILABLE');

  let scopes: string[] | null = null;
  try {
    scopes = await vibecode.scopes(apiKey);
  } catch (error) {
    // Chave recusada: vale. Falha de outro tipo em /v1/me: fica só a orientação na tela.
    if (
      error instanceof VibecodeError &&
      (error.code === 'AI_KEY_INVALID' || error.code === 'AI_KEY_SCOPE')
    ) {
      throw fromVibecode(error);
    }
  }
  if (scopes === null) return;
  if (!scopes.includes(AI_SCOPE)) throw reviewError('AI_KEY_SCOPE');
  if (scopes.some((scope) => scope !== AI_SCOPE)) {
    throw reviewError(
      'AI_KEY_SCOPE',
      'A chave tem outras permissões além de vibe:ai e abriria dados do seu portal. Crie uma chave só com o escopo vibe:ai.',
    );
  }
}
