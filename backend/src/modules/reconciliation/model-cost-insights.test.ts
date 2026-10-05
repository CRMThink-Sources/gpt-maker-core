import { describe, expect, it } from 'vitest';
import { deviates, insightFor, type ModelDay, STALE_DAYS } from './model-cost-insights';

const days = (values: Array<[number, number]>): ModelDay[] =>
  values.map(([real, responses], i) => ({
    day: `2026-10-${String(i + 1).padStart(2, '0')}`,
    real,
    responses,
  }));

describe('média real por modelo e sugestão de custo', () => {
  it('desvio exige 0,5 crédito e 10% do custo', () => {
    expect(deviates(1.4, 1)).toBe(false); // 0,4 < 0,5
    expect(deviates(1.5, 1)).toBe(true);
    expect(deviates(14.5, 14)).toBe(false); // 0,5 < 10% de 14
    expect(deviates(15.5, 14)).toBe(true);
  });

  it('7 dias seguidos fora do custo: destaca e sugere a média dos 7 dias', () => {
    const series = days([
      [10, 10],
      ...Array.from({ length: STALE_DAYS }, () => [20, 10] as [number, number]),
    ]);
    expect(insightFor('GPT_5_MINI', 1, series)).toEqual({
      modelCode: 'GPT_5_MINI',
      average: 1.88,
      real: 150,
      responses: 80,
      suggestion: 2,
      stale: true,
    });
  });

  it('um dia sem respostas ou dentro do custo quebra a sequência', () => {
    const gap = days([...Array.from({ length: 6 }, () => [20, 10] as [number, number]), [0, 0]]);
    expect(insightFor('M', 1, gap).stale).toBe(false);
    const ok = days([...Array.from({ length: 6 }, () => [20, 10] as [number, number]), [10, 10]]);
    expect(insightFor('M', 1, ok).stale).toBe(false);
  });

  it('sem respostas: sem média nem sugestão', () => {
    expect(insightFor('M', 3, days([[0, 0]]))).toMatchObject({
      average: null,
      suggestion: null,
      stale: false,
    });
  });
});
