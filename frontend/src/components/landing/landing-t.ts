import { createTranslator } from 'next-intl';
import type { Locale } from '@gptmaker/contracts';
import { MESSAGES } from '@/i18n/config';

export type LandingT = (key: string, values?: Record<string, string | number>) => string;

/**
 * Tradutor do namespace `landing` para componentes de servidor. `createT` de `@/i18n` não serve
 * aqui: aquele módulo é `'use client'` (carrega o provider do `/app`, que depende de `BX24`).
 */
export function landingT(locale: Locale): LandingT {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: 'landing',
    onError: () => undefined,
    getMessageFallback: ({ key }) => `landing.${key}`,
  }) as unknown as LandingT;
}
