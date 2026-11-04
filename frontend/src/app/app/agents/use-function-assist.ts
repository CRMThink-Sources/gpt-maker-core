'use client';

import type { AssistInput, AssistResult } from '@gptmaker/contracts';
import { useCallback, useState } from 'react';
import { type Api, BUSY_DELAY_MS, failure, retryWhenBusy } from './use-function-review';

/**
 * Ajuda da IA para preencher campos vazios (`POST /function/assist`). O resultado não é guardado
 * aqui: quem chama decide o que fazer com o rascunho. "Muitas chamadas agora" passa sozinho.
 */
export function useFunctionAssist(api: Api, base: string, options: { busyDelayMs?: number } = {}) {
  const busyDelay = options.busyDelayMs ?? BUSY_DELAY_MS;
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | undefined>(undefined);

  const run = useCallback(
    async (input: AssistInput): Promise<AssistResult> => {
      setState('loading');
      setError(undefined);
      try {
        const result = await retryWhenBusy(
          () =>
            api<AssistResult>(`${base}/function/assist`, {
              method: 'POST',
              body: JSON.stringify(input),
            }),
          busyDelay,
        );
        setState('done');
        return result;
      } catch (caught) {
        const { message, code } = failure(caught);
        setState('error');
        setError(code === null ? 'Não foi possível gerar agora. Tente de novo.' : message);
        throw caught;
      }
    },
    [api, base, busyDelay],
  );

  return { run, state, error };
}
