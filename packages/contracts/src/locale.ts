import { z } from 'zod';

/** Idiomas do app (spec app-i18n). `pt-BR` é o padrão histórico dos tenants. */
export const LOCALES = ['pt-BR', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'pt-BR';
/** Idioma de reserva quando o do portal Bitrix não é suportado (spec app-i18n). */
export const FALLBACK_LOCALE: Locale = 'en';

export const localeSchema = z.enum(LOCALES);

export const updateLocaleSchema = z.object({ locale: localeSchema });
export type UpdateLocaleInput = z.infer<typeof updateLocaleSchema>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Idioma do portal Bitrix (`BX24.getLang()`: `br`, `la`, `en`, ...) → idioma do app. */
export function localeFromBitrixLang(lang: string | null | undefined): Locale {
  switch (lang?.toLowerCase()) {
    case 'br':
      return 'pt-BR';
    case 'la':
      return 'es';
    default:
      return FALLBACK_LOCALE;
  }
}

/** Valor vindo do banco (coluna de texto) → `Locale`; desconhecido cai no padrão. */
export function toLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
