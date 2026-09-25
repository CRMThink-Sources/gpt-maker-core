import { describe, expect, it } from 'vitest';
import {
  currentContext,
  enrichContext,
  runWithContext,
  traceIdFromHeaders,
} from './request-context';

describe('traceIdFromHeaders', () => {
  it('usa o trace id do traceparent', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    expect(traceIdFromHeaders({ traceparent: `00-${traceId}-00f067aa0ba902b7-01` })).toBe(traceId);
  });

  it('ignora traceparent inválido e usa x-request-id', () => {
    expect(traceIdFromHeaders({ traceparent: 'lixo', 'x-request-id': 'req-12345678' })).toBe(
      'req-12345678',
    );
  });

  it('gera trace id quando não há cabeçalho', () => {
    expect(traceIdFromHeaders({})).toMatch(/^[\da-f]{32}$/);
  });
});

describe('runWithContext', () => {
  it('isola contextos concorrentes', async () => {
    const seen = await Promise.all(
      ['t1', 't2'].map((tenantId) =>
        runWithContext({ traceId: tenantId }, async () => {
          enrichContext({ tenantId });
          await new Promise((resolve) => setTimeout(resolve, 5));
          return currentContext()?.tenantId;
        }),
      ),
    );
    expect(seen).toEqual(['t1', 't2']);
    expect(currentContext()).toBeUndefined();
  });
});
