import { createTranslator } from 'next-intl';
import type { Locale } from '@gptmaker/contracts';
import { MESSAGES } from '@/i18n/config';

export type LandingT = (key: string, values?: Record<string, string | number>) => string;

/**
 * Tradutor de um namespace para componentes de servidor. `createT` de `@/i18n` não serve aqui:
 * aquele módulo é `'use client'` (carrega o provider do `/app`, que depende de `BX24`). Chave
 * ausente vira `landing.…` (nunca some em silêncio): os testes procuram esse prefixo na tela.
 */
export function translatorFor(
  locale: Locale,
  namespace: keyof (typeof MESSAGES)['pt-BR'],
): LandingT {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace,
    onError: () => undefined,
    getMessageFallback: ({ key }) =>
      namespace === 'landing' ? `landing.${key}` : `landing.app.${namespace}.${key}`,
  }) as unknown as LandingT;
}

export function landingT(locale: Locale): LandingT {
  return translatorFor(locale, 'landing');
}
