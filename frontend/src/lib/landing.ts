import type { Locale } from '@gptmaker/contracts';

/**
 * Link do GPTThink no Market do Bitrix24 (CTA "Instalar"). PROVISÓRIO: aponta para a raiz do
 * Market até a CRMThink informar o link real do app (spec/design da LP, "Deixado para quem constrói").
 */
export const GPTTHINK_MARKET_URL = 'https://www.bitrix24.com.br/apps/';

const BASE_PATH = '/lp/gptthink';

/** pt-BR vive na URL sem sufixo; os demais idiomas ganham `/<idioma>` (uma URL por conteúdo). */
export function landingPath(locale: Locale): string {
  return locale === 'pt-BR' ? BASE_PATH : `${BASE_PATH}/${locale}`;
}

/** Idioma do segmento `[locale]`; só `en` e `es` existem aí (`pt-BR` é a URL base → 404 no segmento). */
export function landingLocaleFromParam(param: string): Locale | null {
  return param === 'en' || param === 'es' ? param : null;
}

export const LANDING_TAB_IDS = [
  'activate',
  'create',
  'train',
  'intentions',
  'channel',
  'credits',
] as const;

export const LANDING_FEATURE_IDS = [
  'agents',
  'training',
  'intentions',
  'functions',
  'crm',
  'handoff',
  'offHours',
  'testChat',
  'credits',
] as const;

export const LANDING_FAQ_IDS = [1, 2, 3, 4, 5, 6] as const;
