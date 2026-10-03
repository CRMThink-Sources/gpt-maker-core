import { describe, expect, it } from 'vitest';
import { creditAlertFor } from './credit-alerts';

describe('creditAlertFor (80% e saldo zerado no ciclo)', () => {
  it.each([
    [0, 5000, null],
    [3999, 1001, null],
    [4000, 1000, 'CREDIT_80'],
    [4999, 1, 'CREDIT_80'],
    [5000, 0, 'CREDIT_ZERO'],
    [5003, -3, 'CREDIT_ZERO'],
    // Pacote comprado no meio do ciclo aumenta o disponível: 4000 de 6000 é 67%.
    [4000, 2000, null],
  ] as const)('consumido %i, saldo %i ⇒ %s', (consumed, total, expected) => {
    expect(creditAlertFor(consumed, total)).toBe(expected);
  });
});
