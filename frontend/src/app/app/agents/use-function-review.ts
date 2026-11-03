'use client';

import type {
  AiKeyView,
  CreateReviewResult,
  FunctionAnswers,
  FunctionAnswerValue,
  ReviewCrossResult,
  ReviewGapsResult,
  ReviewFieldResult,
} from '@gptmaker/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/platform-session';
import { answerKey, expectationValid } from './review-logic';

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Resultado de um campo: andamento, sucesso ou a falha em pt-BR. */
export type FieldReview =
  | { status: 'running'; answerKey: string }
  | { status: 'done'; answerKey: string; result: ReviewFieldResult; applied?: number[] }
  | { status: 'error'; answerKey: string; message: string; code: string | null };

/** Cobertura da base: lacunas e o que já foi adicionado ao formulário (posição na lista). */
export type GapsReview =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: ReviewGapsResult; added: number[] }
  | { status: 'error'; message: string; code: string | null };

export interface ReviewState {
  fields: Record<string, FieldReview>;
  gaps: GapsReview;
  contradictions: ReviewCrossResult['contradictions'];
  cross: 'idle' | 'running' | 'done' | 'error';
  /** Falha da revisão toda (criar a revisão), fora de um campo. */
  error: string | null;
}

const EMPTY: ReviewState = {
  fields: {},
  gaps: { status: 'idle' },
  contradictions: [],
  cross: 'idle',
  error: null,
};

/** Campos revisados ao mesmo tempo (design D3). */
export const REVIEW_CONCURRENCY = 2;

function failure(error: unknown): { message: string; code: string | null } {
  if (error instanceof ApiRequestError) return { message: error.message, code: error.code };
  return { message: 'Não foi possível revisar agora. Tente de novo.', code: null };
}

/** Estado da chave de IA do cliente (`GET /app/ai-key`); `null` enquanto carrega ou se falhar. */
export function useAiKey(api: Api): AiKeyView | null {
  const [view, setView] = useState<AiKeyView | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<AiKeyView>('/app/ai-key')
      .then((value) => !cancelled && setView(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);
  return view;
}

/**
 * Revisão por IA da função (spec agent-knowledge-review): cria a revisão, revisa os campos com até
 * 2 requisições ao mesmo tempo e, por fim, pede as contradições entre campos. O resultado vive só
 * aqui; cada campo guarda a resposta que leu, para marcar "desatualizado" quando ela mudar.
 */
export function useFunctionReview(api: Api, base: string) {
  const [state, setState] = useState<ReviewState>(EMPTY);
  const [running, setRunning] = useState(false);
  const runs = useRef(0);

  const patch = useCallback((fieldId: string, value: FieldReview) => {
    setState((prev) => ({ ...prev, fields: { ...prev.fields, [fieldId]: value } }));
  }, []);

  /** Revisa os campos dados; `answers` é o que está na tela agora (salvo ou não). */
  const run = useCallback(
    async (fieldIds: string[], answers: FunctionAnswers, expectation?: string) => {
      if (fieldIds.length === 0) return;
      // Cobertura só com a expectativa válida (spec agent-knowledge-gaps).
      const withGaps = expectation !== undefined && expectationValid(expectation);
      const token = ++runs.current;
      setRunning(true);
      const keys = Object.fromEntries(fieldIds.map((id) => [id, answerKey(answers[id])]));
      setState((prev) => ({
        ...prev,
        error: null,
        cross: 'idle',
        gaps: withGaps ? { status: 'running' } : prev.gaps,
        fields: {
          ...prev.fields,
          ...Object.fromEntries(
            fieldIds.map((id) => [id, { status: 'running', answerKey: keys[id]! } as FieldReview]),
          ),
        },
      }));
      try {
        const review = await api<CreateReviewResult>(`${base}/function/review`, {
          method: 'POST',
          body: JSON.stringify({ fieldIds, ...(withGaps ? { withGaps: true } : {}) }),
        });
        const summaries: Array<{ fieldId: string; summary: string }> = [];
        const queue = [...fieldIds];
        let noCredit: string | null = null;

        const worker = async () => {
          for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            if (noCredit) {
              patch(id, {
                status: 'error',
                answerKey: keys[id]!,
                message: noCredit,
                code: 'NO_CREDIT',
              });
              continue;
            }
            try {
              const result = await api<ReviewFieldResult>(
                `${base}/function/review/${review.reviewId}/field`,
                { method: 'POST', body: JSON.stringify({ fieldId: id, answers }) },
              );
              if (result.summary) summaries.push({ fieldId: id, summary: result.summary });
              patch(id, { status: 'done', answerKey: keys[id]!, result });
            } catch (error) {
              const { message, code } = failure(error);
              if (code === 'NO_CREDIT') noCredit = message;
              patch(id, { status: 'error', answerKey: keys[id]!, message, code });
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(REVIEW_CONCURRENCY, fieldIds.length) }, worker),
        );

        // Contradições só valem com ao menos dois campos lidos nesta revisão; sem custo.
        if (summaries.length >= 2) {
          setState((prev) => ({ ...prev, cross: 'running' }));
          try {
            const { contradictions } = await api<ReviewCrossResult>(
              `${base}/function/review/${review.reviewId}/cross`,
              { method: 'POST', body: JSON.stringify({ summaries }) },
            );
            setState((prev) => ({ ...prev, cross: 'done', contradictions }));
          } catch {
            setState((prev) => ({ ...prev, cross: 'error' }));
          }
        }
        // Cobertura da base: uma chamada, cobrada como um campo; falha não afeta o resto.
        if (withGaps) {
          try {
            const result = await api<ReviewGapsResult>(
              `${base}/function/review/${review.reviewId}/gaps`,
              {
                method: 'POST',
                body: JSON.stringify({ expectation: expectation!.trim(), answers, summaries }),
              },
            );
            setState((prev) => ({ ...prev, gaps: { status: 'done', result, added: [] } }));
          } catch (error) {
            const { message, code } = failure(error);
            setState((prev) => ({ ...prev, gaps: { status: 'error', message, code } }));
          }
        }
      } catch (error) {
        const { message } = failure(error);
        setState((prev) => ({
          ...prev,
          gaps: withGaps ? { status: 'idle' } : prev.gaps,
          error: message,
          fields: Object.fromEntries(
            Object.entries(prev.fields).filter(([id]) => !fieldIds.includes(id)),
          ),
        }));
      } finally {
        if (runs.current === token) setRunning(false);
      }
    },
    [api, base, patch],
  );

  /**
   * Sugestão aplicada: o campo passa a valer com o texto novo (não fica "desatualizado" por causa
   * do próprio "Aplicar") e o item é marcado como aplicado.
   */
  const applied = useCallback((fieldId: string, index: number, next: FunctionAnswerValue) => {
    setState((prev) => {
      const current = prev.fields[fieldId];
      if (current?.status !== 'done') return prev;
      const done = [...(current.applied ?? []), index];
      return {
        ...prev,
        fields: {
          ...prev.fields,
          [fieldId]: { ...current, answerKey: answerKey(next), applied: done },
        },
      };
    });
  }, []);

  /** Lacuna adicionada ao formulário: marca para mostrar "Adicionado". */
  const gapAdded = useCallback((index: number) => {
    setState((prev) =>
      prev.gaps.status === 'done'
        ? { ...prev, gaps: { ...prev.gaps, added: [...prev.gaps.added, index] } }
        : prev,
    );
  }, []);

  return { state, running, run, applied, gapAdded };
}
