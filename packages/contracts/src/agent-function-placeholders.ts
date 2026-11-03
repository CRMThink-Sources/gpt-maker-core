/**
 * Marcador que a revisão por IA deixa onde falta um dado que só o cliente sabe (prazo, valor,
 * política): `[preencher: prazo de troca]`. Enquanto houver um, a publicação é recusada.
 */
export const REVIEW_PLACEHOLDER = /\[preencher:[^\]]*\]/i;

export function hasPlaceholder(text: string): boolean {
  return REVIEW_PLACEHOLDER.test(text);
}
