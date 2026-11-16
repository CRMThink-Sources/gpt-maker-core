import { describe, expect, it } from 'vitest';
import { isLocale, localeFromBitrixLang, toLocale } from './locale';

describe('localeFromBitrixLang', () => {
  it.each([
    ['br', 'pt-BR'],
    ['BR', 'pt-BR'],
    ['la', 'es'],
    ['en', 'en'],
    ['de', 'en'],
    ['', 'en'],
    [undefined, 'en'],
  ])('mapeia %s para %s', (lang, esperado) => {
    expect(localeFromBitrixLang(lang)).toBe(esperado);
  });
});

describe('isLocale', () => {
  it('aceita só os idiomas suportados', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('toLocale', () => {
  it('valor desconhecido ou ausente cai em pt-BR', () => {
    expect(toLocale('fr')).toBe('pt-BR');
    expect(toLocale(null)).toBe('pt-BR');
    expect(toLocale('es')).toBe('es');
  });
});
