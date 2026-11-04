import type { Env } from '../../config/env';

/**
 * A chave Vibecode da CRMThink, só se o interruptor `VIBECODE_PLATFORM_FALLBACK` estiver ligado.
 * É o único lugar que decide se quem não tem chave própria pode usar a ajuda e a revisão por IA.
 */
export function platformKey(
  env: Pick<Env, 'VIBECODE_PLATFORM_API_KEY' | 'VIBECODE_PLATFORM_FALLBACK'>,
): string | undefined {
  return env.VIBECODE_PLATFORM_FALLBACK ? env.VIBECODE_PLATFORM_API_KEY : undefined;
}
