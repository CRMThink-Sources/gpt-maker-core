import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '@gptmaker/contracts';
import { MESSAGES } from '@/i18n/config';
import { GPTTHINK_MARKET_URL } from '@/lib/landing';
import { GptthinkLanding } from './gptthink-landing';
import { landingMetadata } from './landing-metadata';

afterEach(cleanup);

const LOCALES: Locale[] = ['pt-BR', 'en', 'es'];

describe('GptthinkLanding', () => {
  it.each(LOCALES)('mostra o hero e declara o idioma (%s)', (locale) => {
    const { container } = render(<GptthinkLanding locale={locale} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(MESSAGES[locale].landing.hero.title);
    expect(container.querySelector(`[lang="${locale}"]`)).toBeTruthy();
  });

  it.each(LOCALES)('todo botão de instalar vai ao Market em nova aba (%s)', (locale) => {
    const { container } = render(<GptthinkLanding locale={locale} />);
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a')].filter(
      (a) => a.getAttribute('href') === GPTTHINK_MARKET_URL,
    );
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('tem as seções na estrutura da LP: 9 funcionalidades, 6 abas e 6 perguntas', () => {
    const { container } = render(<GptthinkLanding locale="pt-BR" />);
    expect(container.querySelectorAll('#funcionalidades h3')).toHaveLength(9);
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(container.querySelectorAll('#duvidas details')).toHaveLength(6);
    expect(container.querySelector('#primeiros-passos')).toBeTruthy();
  });

  it('as âncoras do cabeçalho apontam para seções que existem', () => {
    const { container } = render(<GptthinkLanding locale="en" />);
    const hashes = [...container.querySelectorAll('header a[href^="#"]')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hashes).toEqual(['#funcionalidades', '#primeiros-passos', '#duvidas']);
    for (const h of hashes) expect(container.querySelector(h as string)).toBeTruthy();
  });

  it.each(LOCALES)('não mostra chave de tradução sem texto nem ícone legível (%s)', (locale) => {
    const { container } = render(<GptthinkLanding locale={locale} />);
    // `landingT` engole chave ausente e mostra `landing.<chave>`: isto pega o esquecimento.
    expect(container.textContent).not.toContain('landing.');
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('mostra o primeiro passo da primeira aba já formatado', () => {
    render(<GptthinkLanding locale="en" />);
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });
});

describe('landingMetadata', () => {
  it.each(LOCALES)('usa título e descrição do idioma (%s)', (locale) => {
    const meta = landingMetadata(locale);
    expect(meta.title).toBe(MESSAGES[locale].landing.meta.title);
    expect(meta.description).toBe(MESSAGES[locale].landing.meta.description);
  });

  it('aponta o canonical da própria versão e as três alternativas', () => {
    const meta = landingMetadata('es');
    expect(meta.alternates?.canonical).toBe('/lp/gptthink/es');
    expect(meta.alternates?.languages).toEqual({
      'pt-BR': '/lp/gptthink',
      en: '/lp/gptthink/en',
      es: '/lp/gptthink/es',
    });
  });
});
