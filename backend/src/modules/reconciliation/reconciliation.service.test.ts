import { describe, expect, it } from 'vitest';
import { dayIn, decideAdjustment, previousDays } from './reconciliation.service';

const limits = { tolerance: 2, reviewThreshold: 100 };

describe('decideAdjustment', () => {
  it.each([
    ['consumo real maior: cobra a diferença', 10, 7, 0, { desired: -3, status: 'APPLIED' }],
    ['consumo real menor: devolve a diferença', 7, 10, 0, { desired: 3, status: 'APPLIED' }],
    ['dentro da tolerância: nada', 9, 8, 0, { desired: 0, status: 'WITHIN_TOLERANCE' }],
    [
      'volta à tolerância depois de ajustado: desfaz',
      9,
      8,
      -3,
      { desired: 0, status: 'WITHIN_TOLERANCE' },
    ],
    ['acima do limite: revisão, mantém o ajustado', 500, 10, -3, { desired: -3, status: 'REVIEW' }],
  ] as const)('%s', (_label, real, debited, adjusted, expected) => {
    expect(decideAdjustment({ real, debited, adjusted, ...limits })).toEqual(expected);
  });
});

describe('dias no fuso', () => {
  it('dia de Brasília, não de UTC', () => {
    // 02:30 UTC de 04/10 ainda é 03/10 em Brasília.
    expect(dayIn(new Date('2026-10-04T02:30:00Z'), 'America/Sao_Paulo')).toBe('2026-10-03');
  });

  it('dias anteriores a hoje, do mais antigo ao mais recente', () => {
    expect(previousDays(new Date('2026-10-04T02:30:00Z'), 'America/Sao_Paulo', 3)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(previousDays(new Date('2026-03-01T15:00:00Z'), 'America/Sao_Paulo', 1)).toEqual([
      '2026-02-28',
    ]);
  });
});
