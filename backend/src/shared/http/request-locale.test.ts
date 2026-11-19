import { describe, expect, it } from 'vitest';
import { localeFromAcceptLanguage } from './request-locale';

describe('localeFromAcceptLanguage', () => {
  it.each([
    ['pt-BR', 'pt-BR'],
    ['en', 'en'],
    ['es', 'es'],
    ['en-US', 'en'],
    ['es-MX', 'es'],
    ['pt', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['EN', 'en'],
    ['fr-FR,en;q=0.8', 'en'],
    ['es-AR,es;q=0.9,en;q=0.8', 'es'],
  ])('%s → %s', (header, expected) => {
    expect(localeFromAcceptLanguage(header)).toBe(expected);
  });

  it.each([undefined, '', 'fr', 'de-DE,ja;q=0.5', '*'])('%j cai em pt-BR', (header) => {
    expect(localeFromAcceptLanguage(header)).toBe('pt-BR');
  });

  it('usa o primeiro valor quando o cabeçalho vem repetido', () => {
    expect(localeFromAcceptLanguage(['en', 'es'])).toBe('en');
  });
});
