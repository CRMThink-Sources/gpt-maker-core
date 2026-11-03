import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/platform-session';
import { useFunctionReview } from './use-function-review';

afterEach(cleanup);

const BASE = '/app/agents/a1';
const answers = { f1: 'um', f2: 'dois', f3: 'três', f4: 'quatro' };
const result = (fieldId: string) => ({
  fieldId,
  summary: `resumo ${fieldId}`,
  items: [],
});

/** API falsa: cada campo responde como o script mandar (resultado ou erro). */
function fakeApi(script: Record<string, 'ok' | ApiRequestError> = {}) {
  const calls: string[] = [];
  const api = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith('/function/review')) return { reviewId: 'r1', keySource: 'platform' };
    if (path.endsWith('/cross'))
      return { contradictions: [{ fields: ['f1', 'f2'], text: 'Prazos diferentes.' }] };
    const outcome = script[body.fieldId] ?? 'ok';
    if (outcome !== 'ok') throw outcome;
    return result(body.fieldId);
  });
  return { api: api as never, calls };
}

describe('fluxo da revisão (6.5)', () => {
  it('revisa por campo, depois as contradições', async () => {
    const { api, calls } = fakeApi();
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1', 'f2', 'f3'], answers));
    expect(Object.values(hook.current.state.fields).map((f) => f.status)).toEqual([
      'done',
      'done',
      'done',
    ]);
    expect(hook.current.state.contradictions).toHaveLength(1);
    expect(calls.at(-1)).toMatch(/cross$/);
    expect(hook.current.running).toBe(false);
  });

  it('falha num campo não afeta os outros', async () => {
    const { api } = fakeApi({
      f2: new ApiRequestError(502, 'AI_BAD_OUTPUT', 'Não foi possível revisar este campo.'),
    });
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1', 'f2', 'f3'], answers));
    const fields = hook.current.state.fields;
    expect(fields.f1!.status).toBe('done');
    expect(fields.f3!.status).toBe('done');
    expect(fields.f2).toMatchObject({
      status: 'error',
      message: 'Não foi possível revisar este campo.',
    });
  });

  it('sem créditos no meio: os campos que ainda esperavam não chamam a IA', async () => {
    const noCredit = new ApiRequestError(422, 'NO_CREDIT', 'Seus créditos de IA acabaram.');
    const { api, calls } = fakeApi({ f1: noCredit });
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1', 'f2', 'f3', 'f4'], answers));
    const fields = hook.current.state.fields;
    expect(fields.f1).toMatchObject({ status: 'error', code: 'NO_CREDIT' });
    // Os que sobraram na fila ficam sem créditos sem pedir ao backend.
    const skipped = Object.values(fields).filter(
      (f) => f.status === 'error' && f.code === 'NO_CREDIT',
    );
    expect(skipped.length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((path) => path.endsWith('/field')).length).toBeLessThan(4);
  });

  it('um campo só (revisar este campo) não pede contradições e mantém os demais', async () => {
    const { api, calls } = fakeApi();
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1', 'f2'], answers));
    await act(() => hook.current.run(['f2'], { ...answers, f2: 'novo' }));
    expect(hook.current.state.fields.f1!.status).toBe('done');
    expect(hook.current.state.fields.f2!.answerKey).toBe(JSON.stringify('novo'));
    expect(calls.filter((path) => path.endsWith('/cross'))).toHaveLength(1);
  });

  it('falha ao criar a revisão aparece no topo, sem resultado por campo', async () => {
    const api = vi.fn(async () => {
      throw new ApiRequestError(422, 'AI_KEY_REQUIRED', 'Informe a chave do Vibecode.');
    }) as never;
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1'], answers));
    expect(hook.current.state.error).toBe('Informe a chave do Vibecode.');
    expect(hook.current.state.fields).toEqual({});
  });

  it('aplicar uma sugestão não deixa o campo desatualizado e marca o item', async () => {
    const { api } = fakeApi();
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1'], answers));
    act(() => hook.current.applied('f1', 0, 'texto novo'));
    expect(hook.current.state.fields.f1).toMatchObject({
      answerKey: JSON.stringify('texto novo'),
      applied: [0],
    });
  });
});

describe('cobertura da base (3.2)', () => {
  const EXPECTATION = 'Clientes pedem segunda via de boleto e prazo de troca.';
  const GAPS = {
    gaps: [{ fieldId: 'f1', title: 't', why: 'w', item: {}, applicable: true }],
    covered: [],
  };

  /** API falsa que também responde à cobertura e guarda o corpo de cada chamada. */
  function gapsApi(gaps: 'ok' | ApiRequestError = 'ok') {
    const bodies: Record<string, unknown> = {};
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      bodies[path.split('/').pop()!] = body;
      if (path.endsWith('/function/review')) return { reviewId: 'r1', keySource: 'platform' };
      if (path.endsWith('/cross')) return { contradictions: [] };
      if (path.endsWith('/gaps')) {
        if (gaps !== 'ok') throw gaps;
        return GAPS;
      }
      return { fieldId: body.fieldId, summary: `resumo ${body.fieldId}`, items: [] };
    });
    return {
      api: api as never,
      bodies,
      calls: () => api.mock.calls.map((call) => call[0] as string),
    };
  }

  it('com expectativa: cria com withGaps e pede a cobertura depois das contradições', async () => {
    const { api, bodies, calls } = gapsApi();
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1', 'f2'], answers, `  ${EXPECTATION}  `));
    expect(bodies.review).toMatchObject({ withGaps: true });
    expect(calls().at(-1)).toMatch(/\/gaps$/);
    expect(bodies.gaps).toMatchObject({ expectation: EXPECTATION });
    expect((bodies.gaps as { summaries: unknown[] }).summaries).toHaveLength(2);
    expect(hook.current.state.gaps).toMatchObject({ status: 'done', added: [] });
  });

  it('sem expectativa ou com expectativa curta: nada de cobertura', async () => {
    for (const expectation of [undefined, 'atender bem']) {
      const { api, bodies, calls } = gapsApi();
      const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
      await act(() => hook.current.run(['f1', 'f2'], answers, expectation));
      expect(bodies.review).toEqual({ fieldIds: ['f1', 'f2'] });
      expect(calls().some((path) => path.endsWith('/gaps'))).toBe(false);
      expect(hook.current.state.gaps).toEqual({ status: 'idle' });
    }
  });

  it('falha só da cobertura: os campos mantêm o resultado', async () => {
    const { api } = gapsApi(new ApiRequestError(502, 'AI_BAD_OUTPUT', 'Não foi possível revisar.'));
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1', 'f2'], answers, EXPECTATION));
    expect(hook.current.state.gaps).toMatchObject({ status: 'error', code: 'AI_BAD_OUTPUT' });
    expect(hook.current.state.fields.f1!.status).toBe('done');
    expect(hook.current.state.fields.f2!.status).toBe('done');
  });

  it('sem créditos na cobertura: guarda o código para mostrar o caminho', async () => {
    const { api } = gapsApi(new ApiRequestError(422, 'NO_CREDIT', 'Créditos acabaram.'));
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1'], answers, EXPECTATION));
    expect(hook.current.state.gaps).toMatchObject({ status: 'error', code: 'NO_CREDIT' });
  });

  it('marca a lacuna como adicionada', async () => {
    const { api } = gapsApi();
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1', 'f2'], answers, EXPECTATION));
    act(() => hook.current.gapAdded(0));
    expect(hook.current.state.gaps).toMatchObject({ added: [0] });
  });

  it('revisar um campo de novo sem expectativa não apaga as lacunas', async () => {
    const { api } = gapsApi();
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE));
    await act(() => hook.current.run(['f1', 'f2'], answers, EXPECTATION));
    await act(() => hook.current.run(['f2'], answers));
    expect(hook.current.state.gaps.status).toBe('done');
  });
});

describe('"Muitas revisões agora" passa sozinho', () => {
  const busy = () => new ApiRequestError(429, 'AI_BUSY', 'Muitas revisões agora.');

  /** API em que o campo `f2` responde ocupado `times` vezes antes de dar certo. */
  function busyApi(times: number) {
    let left = times;
    const calls: string[] = [];
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push(path);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (path.endsWith('/function/review')) return { reviewId: 'r1', keySource: 'platform' };
      if (path.endsWith('/cross')) return { contradictions: [] };
      if (body.fieldId === 'f2' && left > 0) {
        left--;
        throw busy();
      }
      return { fieldId: body.fieldId, summary: `resumo ${body.fieldId}`, items: [] };
    });
    return { api: api as never, calls };
  }

  it('tenta de novo e o campo termina revisado, sem aparecer como falha', async () => {
    const { api, calls } = busyApi(2);
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE, { busyDelayMs: 0 }));
    await act(() => hook.current.run(['f1', 'f2'], answers));
    expect(hook.current.state.fields.f2!.status).toBe('done');
    // 1 do f1 + 3 do f2 (2 ocupadas e 1 certa).
    expect(calls.filter((path) => path.endsWith('/field'))).toHaveLength(4);
  });

  it('esgotadas as tentativas, o campo mostra a falha e os outros seguem', async () => {
    const { api } = busyApi(99);
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE, { busyDelayMs: 0 }));
    await act(() => hook.current.run(['f1', 'f2'], answers));
    expect(hook.current.state.fields.f1!.status).toBe('done');
    expect(hook.current.state.fields.f2).toMatchObject({ status: 'error', code: 'AI_BUSY' });
  });

  it('outros erros não são repetidos', async () => {
    const api = vi.fn(async (path: string) => {
      if (path.endsWith('/function/review')) return { reviewId: 'r1', keySource: 'platform' };
      throw new ApiRequestError(502, 'AI_BAD_OUTPUT', 'Não foi possível revisar.');
    }) as never;
    const { result: hook } = renderHook(() => useFunctionReview(api, BASE, { busyDelayMs: 0 }));
    await act(() => hook.current.run(['f1'], answers));
    expect(hook.current.state.fields.f1).toMatchObject({ status: 'error', code: 'AI_BAD_OUTPUT' });
    expect((api as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });
});
