import { describe, expect, it } from 'vitest';
import { GPTTHINK_MARKET_URL, landingLocaleFromParam, landingPath } from './landing';

describe('landingPath', () => {
  it.each([
    ['pt-BR', '/lp/gptthink'],
    ['en', '/lp/gptthink/en'],
    ['es', '/lp/gptthink/es'],
  ] as const)('monta o caminho de %s', (locale, path) => {
    expect(landingPath(locale)).toBe(path);
  });
});

describe('landingLocaleFromParam', () => {
  it.each([
    ['en', 'en'],
    ['es', 'es'],
    ['pt-BR', null],
    ['fr', null],
    ['', null],
  ])('"%s" vira %s', (param, expected) => {
    expect(landingLocaleFromParam(param)).toBe(expected);
  });
});

describe('GPTTHINK_MARKET_URL', () => {
  it('é um link https', () => {
    expect(GPTTHINK_MARKET_URL.startsWith('https://')).toBe(true);
  });
});
