import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GptthinkLanding } from '@/components/landing/gptthink-landing';
import { landingMetadata } from '@/components/landing/landing-metadata';
import { landingLocaleFromParam } from '@/lib/landing';

// Só `en` e `es` existem aqui; qualquer outro valor (inclusive `pt-BR`) responde 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'es' }];
}

export async function generateMetadata({
  params,
}: PageProps<'/lp/gptthink/[locale]'>): Promise<Metadata> {
  const locale = landingLocaleFromParam((await params).locale);
  if (!locale) notFound();
  return landingMetadata(locale);
}

export default async function GptthinkLocaleLandingPage({
  params,
}: PageProps<'/lp/gptthink/[locale]'>) {
  const locale = landingLocaleFromParam((await params).locale);
  if (!locale) notFound();
  return <GptthinkLanding locale={locale} />;
}
