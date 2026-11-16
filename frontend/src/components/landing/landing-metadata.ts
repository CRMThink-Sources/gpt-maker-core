import type { Metadata } from 'next';
import { LOCALES, type Locale } from '@gptmaker/contracts';
import { landingPath } from '@/lib/landing';
import { landingT } from './landing-t';

/** Título/descrição no idioma da página, canonical da própria versão e `hreflang` das três (spec landing-page). */
export function landingMetadata(locale: Locale): Metadata {
  const t = landingT(locale);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: landingPath(locale),
      languages: Object.fromEntries(LOCALES.map((l) => [l, landingPath(l)])),
    },
  };
}
