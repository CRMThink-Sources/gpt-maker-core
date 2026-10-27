import { ApiRequestError } from '@/lib/platform-session';

/** Mensagem para o operador: a da API (fora os HTTP genéricos) ou a de uma validação local. */
export function message(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) return e.code.startsWith('HTTP_') ? fallback : e.message;
  return e instanceof Error && e.message ? e.message : fallback;
}
