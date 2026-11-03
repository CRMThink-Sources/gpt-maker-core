import type { FunctionAnswers } from './agent-function-answers';
import { visibleFields } from './agent-function-answers';
import type { FunctionTemplateContent } from './agent-functions';

/**
 * Marcador que a revisão por IA deixa onde falta um dado que só o cliente sabe (prazo, valor,
 * política): `[preencher: prazo de troca]`. Enquanto houver um, a publicação é recusada.
 */
export const REVIEW_PLACEHOLDER = /\[preencher:[^\]]*\]/i;

export function hasPlaceholder(text: string): boolean {
  return REVIEW_PLACEHOLDER.test(text);
}

export interface PlaceholderLocation {
  field: string;
  /** Posição do item, nas listas e na base. */
  item?: number;
  /** Subcampo da base. */
  subfield?: string;
}

/** Onde as respostas (dos campos visíveis) ainda têm um marcador `[preencher: …]`. */
export function findPlaceholders(
  content: Pick<FunctionTemplateContent, 'fields'>,
  answers: FunctionAnswers,
): PlaceholderLocation[] {
  const found: PlaceholderLocation[] = [];
  for (const field of visibleFields(content.fields, answers)) {
    const value = answers[field.id];
    if (field.kind === 'TEXT') {
      if (typeof value === 'string' && hasPlaceholder(value)) found.push({ field: field.id });
    } else if (field.kind === 'TEXT_LIST') {
      if (!Array.isArray(value)) continue;
      value.forEach((item, index) => {
        if (typeof item === 'string' && hasPlaceholder(item))
          found.push({ field: field.id, item: index });
      });
    } else if (field.kind === 'KNOWLEDGE') {
      if (!Array.isArray(value)) continue;
      value.forEach((item, index) => {
        if (typeof item !== 'object' || item === null || !('values' in item)) return;
        for (const [subfield, text] of Object.entries(item.values)) {
          if (hasPlaceholder(text)) found.push({ field: field.id, item: index, subfield });
        }
      });
    }
  }
  return found;
}
