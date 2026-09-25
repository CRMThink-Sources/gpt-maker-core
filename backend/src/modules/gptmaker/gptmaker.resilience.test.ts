import { describe, expect, it, vi } from 'vitest';
import { GptMakerError } from './gptmaker.errors';
import { CallOptions, GptMakerResilience } from './gptmaker.resilience';

const idempotent: CallOptions = { operation: 'agent.get', idempotent: true, timeoutMs: 1000 };
const nonIdempotent: CallOptions = {
  operation: 'agent.create',
  idempotent: false,
  timeoutMs: 1000,
};

function resilience(
  overrides: { breakerThreshold?: number; beforeAttempt?: () => Promise<void> } = {},
) {
  return new GptMakerResilience({
    maxAttempts: 3,
    breakerThreshold: overrides.breakerThreshold ?? 10,
    halfOpenAfterMs: 60_000,
    beforeAttempt: overrides.beforeAttempt ?? (async () => {}),
  });
}

const unavailable = () => new GptMakerError('UNAVAILABLE', 'op', '503', { status: 503 });

function networkError(code: string) {
  return Object.assign(new TypeError('fetch failed'), { cause: { code } });
}

describe('GptMakerResilience', () => {
  it('retenta operação idempotente em falha transitória', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValue('ok');
    await expect(resilience().execute(idempotent, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('desiste após o máximo de tentativas', async () => {
    const fn = vi.fn().mockRejectedValue(unavailable());
    await expect(resilience().execute(idempotent, fn)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('não retenta 5xx em operação não idempotente', async () => {
    const fn = vi.fn().mockRejectedValue(unavailable());
    await expect(resilience().execute(nonIdempotent, fn)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retenta operação não idempotente quando a conexão nem abriu', async () => {
    const fn = vi.fn().mockRejectedValueOnce(networkError('ECONNREFUSED')).mockResolvedValue('ok');
    await expect(resilience().execute(nonIdempotent, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('não retenta reset de conexão em operação não idempotente', async () => {
    const fn = vi.fn().mockRejectedValue(networkError('ECONNRESET'));
    await expect(resilience().execute(nonIdempotent, fn)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retenta 429 mesmo em operação não idempotente', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new GptMakerError('RATE_LIMITED', 'op', '429', { status: 429 }))
      .mockResolvedValue('ok');
    await expect(resilience().execute(nonIdempotent, fn)).resolves.toBe('ok');
  });

  it('não retenta erro do cliente (4xx)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new GptMakerError('VALIDATION', 'op', '400', { status: 400 }));
    await expect(resilience().execute(idempotent, fn)).rejects.toMatchObject({
      kind: 'VALIDATION',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('converte timeout em UNAVAILABLE', async () => {
    const fn = (signal: AbortSignal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('abort'))),
      );
    await expect(
      resilience().execute({ operation: 'slow', idempotent: false, timeoutMs: 20 }, fn),
    ).rejects.toMatchObject({ kind: 'UNAVAILABLE', message: expect.stringContaining('tempo') });
  });

  it('abre o circuito após falhas seguidas e recusa sem chamar', async () => {
    const r = resilience({ breakerThreshold: 2 });
    const fn = vi.fn().mockRejectedValue(unavailable());
    await expect(r.execute(nonIdempotent, fn)).rejects.toBeInstanceOf(GptMakerError);
    await expect(r.execute(nonIdempotent, fn)).rejects.toBeInstanceOf(GptMakerError);
    expect(r.circuitOpen).toBe(true);

    const next = vi.fn().mockResolvedValue('ok');
    await expect(r.execute(idempotent, next)).rejects.toMatchObject({ circuitOpen: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('4xx não abre o circuito', async () => {
    const r = resilience({ breakerThreshold: 1 });
    const fn = vi
      .fn()
      .mockRejectedValue(new GptMakerError('NOT_FOUND', 'op', '404', { status: 404 }));
    await expect(r.execute(idempotent, fn)).rejects.toMatchObject({ kind: 'NOT_FOUND' });
    expect(r.circuitOpen).toBe(false);
  });

  it('passa pelo rate limiter a cada tentativa', async () => {
    const beforeAttempt = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValueOnce(unavailable()).mockResolvedValue('ok');
    await resilience({ beforeAttempt }).execute(idempotent, fn);
    expect(beforeAttempt).toHaveBeenCalledTimes(2);
  });
});
