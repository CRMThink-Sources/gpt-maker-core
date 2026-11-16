import type { Locale } from '@gptmaker/contracts';
import { LogoMark } from '@/components/logo';
import { GPTTHINK_MARKET_URL, LANDING_FAQ_IDS, LANDING_FEATURE_IDS } from '@/lib/landing';
import { FeatureIcon } from './feature-icons';
import { LandingTabs } from './landing-tabs';
import { landingT } from './landing-t';
import { LanguageSwitcher } from './language-switcher';
import { buildTutorialTabs } from './tutorial/tutorial-tabs';

/** CTA de instalar: sempre o Market do Bitrix24, em nova aba (spec landing-page). */
function InstallLink({ children, className }: { children: string; className: string }) {
  return (
    <a href={GPTTHINK_MARKET_URL} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

/** Marca: robô do logo + "GPT" em tinta e "Think" em violeta, como no logo oficial. */
function Wordmark({ className = 'text-[17px]' }: { className?: string }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark className="size-8" />
      <span className={`font-lp-heading font-bold tracking-[-0.02em] text-lp-ink ${className}`}>
        GPT<span className="text-lp-primary">Think</span>
      </span>
    </span>
  );
}

const BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-[10px] bg-lp-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-lp-primary-dark';

const SECTION_TITLE =
  'font-lp-heading text-[28px] leading-9 font-bold tracking-[-0.025em] text-lp-ink sm:text-3xl';

/**
 * LP pública do GPTThink, no padrão da LP do ThinkZap. Componente de servidor (sem hooks): só as
 * abas de Primeiros passos (e o destaque delas) rodam no cliente.
 */
export function GptthinkLanding({ locale }: { locale: Locale }) {
  const t = landingT(locale);
  const tabs = buildTutorialTabs(locale);

  return (
    <div lang={locale} className="min-h-screen bg-white text-lp-ink">
      <header className="sticky top-0 z-10 border-b border-lp-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Wordmark />
          <nav className="hidden items-center gap-7 text-[13px] text-lp-muted md:flex">
            <a href="#funcionalidades" className="hover:text-lp-ink">
              {t('nav.features')}
            </a>
            <a href="#primeiros-passos" className="hover:text-lp-ink">
              {t('nav.start')}
            </a>
            <a href="#duvidas" className="hover:text-lp-ink">
              {t('nav.faq')}
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <LanguageSwitcher current={locale} label={t('nav.language')} />
            <InstallLink className={BUTTON}>{t('nav.install')}</InstallLink>
          </div>
        </div>
      </header>

      <main>
        <section className="bg-linear-to-b from-lp-wash to-white">
          <div className="mx-auto grid max-w-5xl items-center gap-12 px-4 py-14 sm:px-6 md:grid-cols-[1.05fr_1fr] md:py-20">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-lp-primary uppercase">
                {t('hero.eyebrow')}
              </p>
              <h1 className="font-lp-heading mt-4 text-[38px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-5xl">
                {t('hero.title')}
              </h1>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-lp-muted">
                {t('hero.subtitle')}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                <InstallLink className={`${BUTTON} !px-5 !py-2.5`}>
                  {t('hero.ctaInstall')}
                </InstallLink>
                <a
                  href="#primeiros-passos"
                  className="text-sm font-semibold text-lp-primary hover:text-lp-primary-dark"
                >
                  {t('hero.ctaStart')} ↓
                </a>
              </div>
            </div>

            <div
              aria-hidden="true"
              className="rounded-2xl border border-lp-line bg-white p-5 shadow-[0_12px_40px_-12px_rgba(28,22,64,0.18)]"
            >
              <div className="flex items-center gap-3 border-b border-lp-line pb-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-lp-wash text-xs font-bold text-lp-primary">
                  {t('mock.name')
                    .split(' ')
                    .map((part) => part[0])
                    .join('')}
                </span>
                <span>
                  <span className="block text-[13px] font-semibold">{t('mock.name')}</span>
                  <span className="block text-[11px] text-lp-muted">{t('mock.contact')}</span>
                </span>
              </div>
              <div className="mt-4 space-y-3 text-[13px]">
                <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-2.5">
                  {t('mock.customer')}
                </p>
                <div className="ml-auto max-w-[85%]">
                  <p className="mb-1 text-right text-[10px] text-lp-muted">
                    {t('mock.agentLabel')}
                  </p>
                  <p className="rounded-2xl rounded-br-md bg-lp-primary px-4 py-2.5 text-white">
                    {t('mock.agent')}
                  </p>
                </div>
                <p className="rounded-lg bg-lp-wash px-3 py-2 text-[11px] text-lp-muted">
                  <span className="mr-1.5 inline-block size-1.5 rounded-full bg-lp-accent align-middle" />
                  {t('mock.note')}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="funcionalidades" className="scroll-mt-16">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
            <h2 className={`${SECTION_TITLE} text-center`}>{t('features.title')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-sm text-lp-muted">
              {t('features.subtitle')}
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {LANDING_FEATURE_IDS.map((id) => (
                <article key={id} className="rounded-[14px] border border-lp-line bg-white p-6">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-lp-wash text-lp-primary">
                    <FeatureIcon id={id} />
                  </span>
                  <h3 className="font-lp-heading mt-4 text-[15px] font-semibold">
                    {t(`features.items.${id}.title`)}
                  </h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-lp-muted">
                    {t(`features.items.${id}.description`)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="primeiros-passos" className="scroll-mt-16 bg-lp-wash">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
            <h2 className={`${SECTION_TITLE} text-center`}>{t('start.title')}</h2>
            <p className="mx-auto mt-3 mb-8 max-w-xl text-center text-sm text-lp-muted">
              {t('start.subtitle')}
            </p>
            <LandingTabs
              tabs={tabs}
              labels={{
                back: t('start.back'),
                next: t('start.next'),
                finish: t('start.finish'),
                hint: t('start.hint'),
              }}
            />
          </div>
        </section>

        <section id="duvidas" className="scroll-mt-16">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
            <h2 className={`${SECTION_TITLE} text-center`}>{t('faq.title')}</h2>
            <div className="mt-8 divide-y divide-lp-line border-y border-lp-line">
              {LANDING_FAQ_IDS.map((n) => (
                <details key={n} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                    {t(`faq.q${n}`)}
                    <span
                      aria-hidden="true"
                      className="text-xl leading-none text-lp-primary transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-lp-muted">
                    {t(`faq.a${n}`)}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-lp-wash">
          <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
            <h2 className={SECTION_TITLE}>{t('cta.title')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-lp-muted">
              {t('cta.text')}
            </p>
            <InstallLink className={`${BUTTON} mt-7 !px-6 !py-3`}>{t('cta.button')}</InstallLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-lp-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-lp-muted sm:flex-row sm:px-6">
          <Wordmark className="text-sm" />
          <span>{t('footer.text')}</span>
        </div>
      </footer>
    </div>
  );
}
