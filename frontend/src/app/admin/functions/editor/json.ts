import type { z } from 'zod';

export type JsonCheck<T> = { value: T; errors: [] } | { value: null; errors: string[] };

/** Lê o JSON e valida com o schema; os erros saem com o caminho do campo. */
export function checkJson<T>(text: string, schema: z.ZodType<T>): JsonCheck<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { value: null, errors: [`JSON inválido: ${(e as Error).message}`] };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { value: parsed.data, errors: [] };
  return {
    value: null,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
    ),
  };
}
