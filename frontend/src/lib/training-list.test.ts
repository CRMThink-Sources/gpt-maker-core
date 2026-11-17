import { describe, expect, it } from 'vitest';
import {
  changeTrainingFilters,
  EMPTY_TRAINING_FILTERS,
  expiresInDays,
  hasActiveTrainingFilters,
  isoToLocalInput,
  localInputToIso,
  parseTrainingFilters,
  tagTone,
  toggleItem,
  trainingFiltersQuery,
} from './training-list';

describe('filtros da lista de treinamentos na URL', () => {
  it('URL vazia dá os padrões', () => {
    expect(parseTrainingFilters(new URLSearchParams(''))).toEqual(EMPTY_TRAINING_FILTERS);
  });

  it('lê página, busca, tipo, estado e tags (normalizadas)', () => {
    const filters = parseTrainingFilters(
      new URLSearchParams(
        'page=2&q=preços&type=TEXT,WEBSITE&status=EXPIRED&tags=Promo, promo,Frete',
      ),
    );
    expect(filters).toEqual({
      page: 2,
      q: 'preços',
      type: ['TEXT', 'WEBSITE'],
      status: ['EXPIRED'],
      tags: ['promo', 'frete'],
    });
  });

  it.each([
    ['página inválida', 'page=abc', { page: 1 }],
    ['página zero', 'page=0', { page: 1 }],
    ['tipo desconhecido', 'type=AUDIO,TEXT', { type: ['TEXT'] }],
    ['estado desconhecido', 'status=X', { status: [] }],
  ])('ignora %s', (_nome, query, expected) => {
    expect(parseTrainingFilters(new URLSearchParams(query))).toMatchObject(expected);
  });

  it('a query omite os padrões e volta ao mesmo filtro ao ser lida', () => {
    expect(trainingFiltersQuery(EMPTY_TRAINING_FILTERS)).toBe('');
    const filters = {
      page: 3,
      q: 'garantia',
      type: ['VIDEO' as const],
      status: ['DONE' as const, 'FAILED' as const],
      tags: ['promo'],
    };
    expect(parseTrainingFilters(new URLSearchParams(trainingFiltersQuery(filters)))).toEqual(
      filters,
    );
  });

  it('a chamada da API leva o tamanho de página só quando não é o padrão', () => {
    expect(trainingFiltersQuery(EMPTY_TRAINING_FILTERS, { pageSize: 20 })).toBe('');
    expect(trainingFiltersQuery(EMPTY_TRAINING_FILTERS, { pageSize: 50 })).toBe('pageSize=50');
  });

  it('mudar um filtro volta à página 1', () => {
    const current = { ...EMPTY_TRAINING_FILTERS, page: 3 };
    expect(changeTrainingFilters(current, { tags: ['promo'] })).toMatchObject({
      page: 1,
      tags: ['promo'],
    });
  });

  it('sabe se há filtro ativo (a página sozinha não conta)', () => {
    expect(hasActiveTrainingFilters({ ...EMPTY_TRAINING_FILTERS, page: 4 })).toBe(false);
    expect(hasActiveTrainingFilters({ ...EMPTY_TRAINING_FILTERS, q: ' x ' })).toBe(true);
    expect(hasActiveTrainingFilters({ ...EMPTY_TRAINING_FILTERS, status: ['EXPIRED'] })).toBe(true);
  });

  it('liga e desliga itens de filtro', () => {
    expect(toggleItem(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleItem(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('expiração na tela', () => {
  const now = new Date('2026-11-17T12:00:00.000Z');

  it('conta dias para expirar, arredondando para cima', () => {
    expect(expiresInDays('2026-11-20T12:00:00.000Z', now)).toBe(3);
    expect(expiresInDays('2026-11-17T18:00:00.000Z', now)).toBe(1);
  });

  it('data passada ou ausente não tem contagem', () => {
    expect(expiresInDays('2026-11-16T12:00:00.000Z', now)).toBeNull();
    expect(expiresInDays(null, now)).toBeNull();
  });

  it('converte entre o campo de data local e o ISO', () => {
    const iso = localInputToIso('2026-12-01T09:30');
    expect(iso).toBe(new Date(2026, 11, 1, 9, 30).toISOString());
    expect(isoToLocalInput(iso)).toBe('2026-12-01T09:30');
    expect(localInputToIso('')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
  });
});

describe('tagTone', () => {
  it('a mesma tag sempre recebe a mesma cor', () => {
    expect(tagTone('promo')).toBe(tagTone('promo'));
  });

  it('tags diferentes se distribuem em mais de uma cor', () => {
    const tones = new Set(['promo', 'frete', 'preços', 'garantia', 'suporte'].map(tagTone));
    expect(tones.size).toBeGreaterThan(1);
  });
});
