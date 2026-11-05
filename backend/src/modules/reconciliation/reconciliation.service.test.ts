import { describe, expect, it } from 'vitest';
import { GptMakerError } from '../gptmaker';
import {
  agentGone,
  dayIn,
  decideAdjustment,
  MAX_PENDING_DAYS,
  pendingExpired,
  previousDays,
} from './reconciliation.service';

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
    [
      'já aprovado, diferença nova pequena: lança',
      530,
      20,
      -500,
      { desired: -510, status: 'APPLIED' },
    ],
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

describe('pendências que não voltam', () => {
  it('agente que não existe mais: 400 ou 404 do GPTMaker', () => {
    const op = 'agent.credits-spent';
    expect(agentGone(new GptMakerError('VALIDATION', op, 'HTTP 400', { status: 400 }))).toBe(true);
    expect(agentGone(new GptMakerError('NOT_FOUND', op, 'HTTP 404', { status: 404 }))).toBe(true);
    expect(agentGone(new GptMakerError('UNAVAILABLE', op, 'HTTP 503', { status: 503 }))).toBe(
      false,
    );
    expect(agentGone(new Error('rede'))).toBe(false);
  });

  it(`sai da fila ${MAX_PENDING_DAYS} dias depois da primeira falha`, () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(pendingExpired(Date.parse('2026-10-05T12:00:00Z'), now)).toBe(true);
    expect(pendingExpired(Date.parse('2026-10-10T12:00:00Z'), now)).toBe(false);
  });
});
