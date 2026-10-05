import { describe, expect, it } from 'vitest';
import { type BalanceView, splitOutflow } from './ledger.service';

const balance = (trial: number, plan: number, extra: number): BalanceView => ({
  trial,
  plan,
  extra,
  total: trial + plan + extra,
  trialEndsAt: null,
  expiresAt: null,
});

describe('divisão de uma saída entre as carteiras', () => {
  it.each([
    ['tudo em PLAN', balance(0, 10, 100), 3, [['PLAN', 3]]],
    [
      'atravessa PLAN e EXTRA',
      balance(0, 2, 100),
      3,
      [
        ['PLAN', 2],
        ['EXTRA', 1],
      ],
    ],
    [
      'TRIAL primeiro',
      balance(5, 10, 0),
      7,
      [
        ['TRIAL', 5],
        ['PLAN', 2],
      ],
    ],
    [
      'excedente negativo em PLAN',
      balance(1, 0, 1),
      5,
      [
        ['TRIAL', 1],
        ['PLAN', 3],
        ['EXTRA', 1],
      ],
    ],
    [
      'PLAN já negativo',
      balance(0, -4, 2),
      3,
      [
        ['PLAN', 1],
        ['EXTRA', 2],
      ],
    ],
    ['sem saldo', balance(0, 0, 0), 2, [['PLAN', 2]]],
  ] as const)('%s', (_name, current, amount, expected) => {
    expect(splitOutflow(current, amount)).toEqual(expected);
  });
});
