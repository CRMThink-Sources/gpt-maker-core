'use client';

import { createFormatter, createTranslator } from 'next-intl';
import type { Locale } from '@gptmaker/contracts';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadBx24 } from '@/lib/bx24';
import { localeFromBitrixLang } from '@gptmaker/contracts';
import { DEFAULT_LOCALE, MESSAGES, readStoredLocale, storeLocale } from './config';

interface I18nValue {
  locale: Locale;
  /** Troca o idioma da interface e guarda a preferência. */
  setLocale(locale: Locale): void;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Idioma da interface do `/app` (spec app-i18n): preferência salva → idioma do portal Bitrix
 * (`BX24.getLang()`) → `en`. Enquanto o portal não responde, a tela sai em pt-BR.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = readStoredLocale();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência só existe no navegador
      setLocaleState(stored);
      return;
    }
    if (window.parent === window) return;
    let cancelled = false;
    loadBx24()
      .then((bx24) => {
        if (!cancelled) setLocaleState(localeFromBitrixLang(bx24.getLang?.()));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    // Ao sair do `/app` (navegação para `/admin`) o `lang` volta ao padrão do documento.
    return () => {
      document.documentElement.lang = DEFAULT_LOCALE;
    };
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale(next) {
        storeLocale(next);
        setLocaleState(next);
      },
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Sem provider (testes, páginas fora do `/app`) vale o idioma padrão. */
export function useLocale(): I18nValue {
  return useContext(I18nContext) ?? { locale: DEFAULT_LOCALE, setLocale: () => undefined };
}

export type T = {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
};

/** Tradutor de um namespace de `messages/*.json`; `t('chave', { variavel })`. */
export function createT(locale: Locale, namespace?: string) {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: namespace as never,
    onError: () => undefined,
    getMessageFallback: ({ namespace: ns, key }) => (ns ? `${ns}.${key}` : key),
  }) as unknown as T;
}

export function useT(namespace?: string): T {
  const { locale } = useLocale();
  return useMemo(() => createT(locale, namespace), [locale, namespace]);
}

/** Datas, horas, números e moeda no idioma ativo (spec app-i18n, "Formatação localizada"). */
export function useFormat() {
  const { locale } = useLocale();
  return useMemo(() => createFormatter({ locale }), [locale]);
}

/**
 * Mensagem de um erro de API (spec app-i18n, "Erros de API traduzidos por código"): procura o
 * `error.code` em `<namespace>.errors` e depois em `errors`; sem tradução, mostra o `message`
 * recebido (pt-BR). Códigos `HTTP_*` (resposta sem envelope) usam `errors.generic`.
 */
export function useErrorMessage(namespace?: string) {
  const { locale } = useLocale();
  return useMemo(() => {
    const local = namespace ? createT(locale, `${namespace}.errors`) : null;
    const shared = createT(locale, 'errors');
    return (error: unknown): string => {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string') {
        if (local?.has(code)) return local(code);
        if (shared.has(code)) return shared(code);
        if (code.startsWith('HTTP_')) return shared('generic');
      }
      return error instanceof Error && error.message ? error.message : shared('generic');
    };
  }, [locale, namespace]);
}

/** Formatador fora de componentes (helpers de `lib/` que recebem o idioma). */
export function createFormat(locale: Locale) {
  return createFormatter({ locale });
}
