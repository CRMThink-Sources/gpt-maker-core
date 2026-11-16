import type { Locale } from '@gptmaker/contracts';
import {
  GPTTHINK_MARKET_URL,
  LANDING_FAQ_IDS,
  LANDING_FEATURE_IDS,
  LANDING_TAB_IDS,
} from '@/lib/landing';
import { LandingTabs, type LandingTab } from './landing-tabs';
import { landingT } from './landing-t';
import { LanguageSwitcher } from './language-switcher';

const STEPS = [1, 2, 3] as const;

/** CTA de instalar: sempre o Market do Bitrix24, em nova aba (spec landing-page). */
function InstallLink({ children, className }: { children: string; className: string }) {
  return (
    <a href={GPTTHINK_MARKET_URL} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m5 12 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * LP pública do GPTThink, no padrão da LP do ThinkZap. Componente de servidor (sem hooks): só as
 * abas de Primeiros passos rodam no cliente.
 */
export function GptthinkLanding({ locale }: { locale: Locale }) {
  const t = landingT(locale);

  const tabs: LandingTab[] = LANDING_TAB_IDS.map((id) => ({
    id,
    label: t(`start.tabs.${id}.label`),
    title: t(`start.tabs.${id}.title`),
    steps: STEPS.map((n) => ({
      text: t(`start.tabs.${id}.step${n}`),
      counter: t('start.stepOf', { current: n, total: STEPS.length }),
    })),
  }));

  const primaryBtn =
    'inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 font-medium text-white hover:bg-brand-700';

  return (
    <div lang={locale} className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-lg font-bold text-brand-700">GPTThink</span>
          <nav className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
            <a href="#funcionalidades" className="hover:text-zinc-900">
              {t('nav.features')}
            </a>
            <a href="#primeiros-passos" className="hover:text-zinc-900">
              {t('nav.start')}
            </a>
            <a href="#duvidas" className="hover:text-zinc-900">
              {t('nav.faq')}
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <LanguageSwitcher current={locale} label={t('nav.language')} />
            <InstallLink className={`${primaryBtn} !px-4 !py-2 text-sm`}>
              {t('nav.install')}
            </InstallLink>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 md:py-20">
          <div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('hero.title')}</h1>
            <p className="mt-5 text-lg text-zinc-600">{t('hero.subtitle')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <InstallLink className={primaryBtn}>{t('hero.ctaInstall')}</InstallLink>
              <a
                href="#primeiros-passos"
                className="inline-flex items-center justify-center rounded-lg px-5 py-3 font-medium text-zinc-700 ring-1 ring-zinc-300 hover:bg-white"
              >
                {t('hero.ctaStart')}
              </a>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="rounded-2xl bg-white p-5 shadow-lg ring-1 ring-zinc-200"
          >
            <p className="border-b border-zinc-100 pb-3 text-sm font-medium text-zinc-500">
              {t('mock.contact')}
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2">
                {t('mock.customer')}
              </p>
              <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-white">
                {t('mock.agent')}
              </p>
              <p className="rounded-lg bg-brand-50 px-3 py-2 text-center text-xs text-brand-700">
                {t('mock.note')}
              </p>
            </div>
          </div>
        </section>

        <section id="funcionalidades" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">{t('features.title')}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LANDING_FEATURE_IDS.map((id) => (
              <article key={id} className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                  <CheckIcon />
                </span>
                <h3 className="mt-4 font-semibold">{t(`features.items.${id}.title`)}</h3>
                <p className="mt-2 text-sm text-zinc-600">
                  {t(`features.items.${id}.description`)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="primeiros-passos"
          className="mx-auto max-w-4xl scroll-mt-20 px-4 py-14 sm:px-6"
        >
          <h2 className="text-3xl font-bold tracking-tight">{t('start.title')}</h2>
          <p className="mt-3 mb-8 text-zinc-600">{t('start.subtitle')}</p>
          <LandingTabs tabs={tabs} backLabel={t('start.back')} nextLabel={t('start.next')} />
        </section>

        <section id="duvidas" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-14 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">{t('faq.title')}</h2>
          <div className="mt-8 space-y-3">
            {LANDING_FAQ_IDS.map((n) => (
              <details key={n} className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
                <summary className="cursor-pointer font-medium">{t(`faq.q${n}`)}</summary>
                <p className="mt-3 text-zinc-600">{t(`faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="rounded-3xl bg-brand-700 px-6 py-12 text-center text-white sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight">{t('cta.title')}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-brand-100">{t('cta.text')}</p>
            <InstallLink className="mt-8 inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 font-medium text-brand-700 hover:bg-brand-50">
              {t('cta.button')}
            </InstallLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500">
        {t('footer.text')}
      </footer>
    </div>
  );
}
