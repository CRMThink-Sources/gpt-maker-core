import { LOCALES, type Locale } from '@gptmaker/contracts';
import { LOCALE_LABELS } from '@/i18n/config';
import { landingPath } from '@/lib/landing';

/**
 * Seletor de idioma da LP (spec landing-page): um link por versão, sem estado. Cada idioma é uma
 * URL própria, então não há o que guardar no navegador. Mostra a sigla (PT, EN, ES) e nomeia o
 * link com o idioma por extenso.
 */
export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  return (
    <nav
      aria-label={label}
      className="flex items-center rounded-lg border border-lp-line p-0.5 text-xs font-semibold"
    >
      {LOCALES.map((locale) => (
        <a
          key={locale}
          href={landingPath(locale)}
          hrefLang={locale}
          lang={locale}
          aria-label={LOCALE_LABELS[locale]}
          aria-current={locale === current ? 'page' : undefined}
          className={`rounded-md px-2 py-1 ${
            locale === current ? 'bg-lp-primary text-white' : 'text-lp-muted hover:text-lp-ink'
          }`}
        >
          {locale.slice(0, 2).toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
