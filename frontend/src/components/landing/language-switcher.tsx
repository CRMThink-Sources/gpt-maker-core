import { LOCALES, type Locale } from '@gptmaker/contracts';
import { LOCALE_LABELS } from '@/i18n/config';
import { landingPath } from '@/lib/landing';

/**
 * Seletor de idioma da LP (spec landing-page): um link por versão, sem estado. Cada idioma é uma
 * URL própria, então não há o que guardar no navegador.
 */
export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  return (
    <nav aria-label={label} className="flex items-center gap-1 text-sm">
      {LOCALES.map((locale) => (
        <a
          key={locale}
          href={landingPath(locale)}
          hrefLang={locale}
          lang={locale}
          aria-current={locale === current ? 'page' : undefined}
          className={`rounded-md px-2 py-1 ${
            locale === current
              ? 'bg-brand-50 font-semibold text-brand-700'
              : 'text-zinc-600 hover:text-zinc-900'
          }`}
        >
          {LOCALE_LABELS[locale]}
        </a>
      ))}
    </nav>
  );
}
