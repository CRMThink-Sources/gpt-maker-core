'use client';

import type {
  AiKeyView,
  FunctionAnswers,
  FunctionAnswerValue,
  FunctionField,
  FunctionReviewWarning,
  FunctionTemplateContent,
  ReviewFieldResult,
  ReviewGap,
} from '@gptmaker/contracts';
import { EXPECTATION_MAX, EXPECTATION_MIN, flattenFields } from '@gptmaker/contracts';
import Link from 'next/link';
import { createContext, useContext, useState } from 'react';
import { Alert, buttonClass, Card } from '@/components/ui';
import {
  answerKey,
  canAddGap,
  canApply,
  expectationValid,
  GAP_REASONS,
  reviewableIds,
  reviewCost,
  sortedWarnings,
  topLevelIds,
  WARNINGS_PER_FIELD,
  withSuggestion,
} from './review-logic';
import type { FieldReview, ReviewState } from './use-function-review';

/** O que o formulário precisa da revisão: avisos por regras fixas e o resultado da IA. */
export interface FormReview {
  warnings: FunctionReviewWarning[];
  form: FunctionTemplateContent;
  /** Revisão por IA; ausente onde o formulário só mostra os avisos (criação, backoffice). */
  ai?: {
    fields: Record<string, FieldReview>;
    onRerun: (fieldId: string) => void;
    /** Avisa que uma sugestão foi aplicada, para a revisão não marcar o campo como desatualizado. */
    onApplied: (fieldId: string, index: number, next: FunctionAnswerValue) => void;
    busy: boolean;
  };
}

export const FormReviewContext = createContext<FormReview | null>(null);

const anchor = (id: string) => `pergunta-${id}`;

/** Avisos de um campo: até 3, `attention` primeiro, e "ver mais N". */
function Warnings({ warnings }: { warnings: FunctionReviewWarning[] }) {
  const [all, setAll] = useState(false);
  if (warnings.length === 0) return null;
  const sorted = sortedWarnings(warnings);
  const shown = all ? sorted : sorted.slice(0, WARNINGS_PER_FIELD);
  const hidden = sorted.length - shown.length;
  return (
    <ul className="mt-2 space-y-1" aria-label="Avisos">
      {shown.map((warning, index) => (
        <li
          key={`${warning.code}:${warning.item ?? '-'}:${warning.subfield ?? '-'}:${index}`}
          className={`text-xs ${warning.severity === 'attention' ? 'text-amber-700' : 'text-zinc-500'}`}
        >
          {warning.severity === 'attention' ? '⚠ ' : '• '}
          {warning.item !== undefined && `Item ${warning.item + 1}: `}
          {warning.message}
        </li>
      ))}
      {hidden > 0 && (
        <li>
          <button
            type="button"
            className="text-xs font-medium text-brand-700 hover:underline"
            onClick={() => setAll(true)}
          >
            ver mais {hidden}
          </button>
        </li>
      )}
    </ul>
  );
}

function Suggestion({
  review,
  field,
  answers,
  item,
  applied,
  onApply,
}: {
  review: FormReview;
  applied: boolean;
  field: FunctionField;
  answers: FunctionAnswers;
  item: ReviewFieldResult['items'][number];
  onApply: (next: FunctionAnswerValue) => void;
}) {
  const suggestion = item.suggestion;
  if (!suggestion) return null;
  if (applied)
    return <p className="mt-2 text-xs font-medium text-emerald-700">Sugestão aplicada.</p>;
  const apply = canApply(review.form, answers, field, item.index, suggestion);
  return (
    <div className="mt-2 rounded-lg bg-white p-2.5 ring-1 ring-zinc-200">
      <p className="text-xs font-medium text-zinc-700">Texto sugerido</p>
      {Object.entries(suggestion.values).map(([key, text]) => (
        <p key={key} className="mt-1 text-xs whitespace-pre-line text-zinc-700">
          {text}
        </p>
      ))}
      {apply && (
        <button
          type="button"
          className={`${buttonClass('secondary', 'sm')} mt-2`}
          onClick={() => {
            const next = withSuggestion(field, answers[field.id], item.index, suggestion.values);
            if (next !== null) onApply(next);
          }}
        >
          Aplicar
        </button>
      )}
    </div>
  );
}

function AiResult({
  review,
  field,
  answers,
  onApply,
}: {
  review: FormReview;
  field: FunctionField;
  answers: FunctionAnswers;
  onApply: (next: FunctionAnswerValue, index: number) => void;
}) {
  const state = review.ai?.fields[field.id];
  if (!review.ai || !state) return null;
  if (state.status === 'running') {
    return <p className="mt-2 text-xs text-zinc-500">revisando…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="mt-2 text-xs text-red-600" role="alert">
        {state.message}
        {state.code === 'NO_CREDIT' && (
          <>
            {' '}
            <Link href="/app/plan" className="font-medium underline">
              Adicionar créditos
            </Link>
          </>
        )}
        {state.code !== 'NO_CREDIT' && (
          <>
            {' '}
            <button
              type="button"
              className="font-medium underline disabled:opacity-50"
              disabled={review.ai.busy}
              onClick={() => review.ai!.onRerun(field.id)}
            >
              tentar de novo
            </button>
          </>
        )}
      </p>
    );
  }
  const outdated = state.answerKey !== answerKey(answers[field.id]);
  return (
    <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-brand-800">Revisão por IA</p>
        {outdated && (
          <span className="flex items-center gap-2 text-xs text-amber-700">
            desatualizado
            <button
              type="button"
              className="font-medium underline disabled:opacity-50"
              disabled={review.ai.busy}
              onClick={() => review.ai!.onRerun(field.id)}
            >
              revisar este campo
            </button>
          </span>
        )}
      </div>
      {state.result.items.every((item) => item.problems.length === 0 && !item.suggestion) ? (
        <p className="mt-1 text-xs text-zinc-600">Nada a apontar neste campo.</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {state.result.items.map((item) => (
            <li key={item.index} className="text-xs text-zinc-700">
              <span className="font-medium">Item {item.index + 1}</span>
              {!state.applied?.includes(item.index) &&
                item.problems.map((problem, i) => (
                  <p key={i} className="mt-0.5">
                    • {problem.text}
                  </p>
                ))}
              <Suggestion
                applied={state.applied?.includes(item.index) ?? false}
                review={review}
                field={field}
                answers={answers}
                item={item}
                onApply={(next) => onApply(next, item.index)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Avisos e resultado da IA de um campo, logo abaixo dele. */
export function FieldNotes({
  field,
  answers,
  set,
}: {
  field: FunctionField;
  answers: FunctionAnswers;
  set: (id: string, value: FunctionAnswerValue | undefined) => void;
}) {
  const review = useContext(FormReviewContext);
  if (!review) return null;
  const own = review.warnings.filter((warning) => warning.field === field.id);
  return (
    <>
      <Warnings warnings={own} />
      <AiResult
        review={review}
        field={field}
        answers={answers}
        onApply={(next, index) => {
          set(field.id, next);
          review.ai?.onApplied(field.id, index, next);
        }}
      />
    </>
  );
}

/** Resumo no topo do formulário: "N pontos de atenção", com link para cada campo. */
export function ReviewSummary({ answers }: { answers: FunctionAnswers }) {
  const review = useContext(FormReviewContext);
  if (!review) return null;
  const attention = review.warnings.filter((warning) => warning.severity === 'attention');
  if (attention.length === 0) return null;
  const tops = topLevelIds(review.form.fields, answers);
  const labels = new Map(review.form.fields.map((field) => [field.id, field.label]));
  const perField = new Map<string, number>();
  for (const warning of attention) {
    const top = tops.get(warning.field) ?? warning.field;
    perField.set(top, (perField.get(top) ?? 0) + 1);
  }
  return (
    <Alert tone="warning">
      <p className="font-medium">
        {attention.length} {attention.length === 1 ? 'ponto de atenção' : 'pontos de atenção'}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {[...perField].map(([id, count]) => (
          <li key={id}>
            <a href={`#${anchor(id)}`} className="underline">
              {labels.get(id) ?? id} ({count})
            </a>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** Botão "Revisar com IA", com custo ou "sem uso de créditos", e as contradições. */
export function ReviewPanel({
  form,
  answers,
  aiKey,
  state,
  running,
  disabled,
  canConfigureKey,
  expectation,
  onExpectation,
  onAddGap,
  onReview,
  onRetryFailed,
}: {
  form: FunctionTemplateContent;
  answers: FunctionAnswers;
  aiKey: AiKeyView | null;
  state: ReviewState;
  running: boolean;
  disabled?: boolean;
  canConfigureKey: boolean;
  /** O que o cliente espera do agente (opcional); vive só na tela. */
  expectation: string;
  onExpectation: (value: string) => void;
  /** Insere o item sugerido da lacuna no formulário; `index` é a posição dela na lista. */
  onAddGap: (gap: ReviewGap, index: number) => void;
  onReview: (fieldIds: string[]) => void;
  /** Revisa só os campos que falharam (sem expectativa, sem cobrar de novo os que deram certo). */
  onRetryFailed: (fieldIds: string[]) => void;
}) {
  const ids = reviewableIds(form, answers);
  if (!aiKey) return null;
  const unavailable = !aiKey.configured && !aiKey.platformAvailable;
  // Com a expectativa válida, a cobertura entra na conta como mais um campo.
  const gapsOn = expectationValid(expectation);
  const cost = reviewCost(aiKey.creditsPerField, ids.length + (gapsOn ? 1 : 0), aiKey.configured);
  const allFields = flattenFields(form.fields);
  const labels = new Map(allFields.map((field) => [field.id, field.label]));
  const fieldOf = new Map(allFields.map((field) => [field.id, field]));
  const tooShort = expectation.trim().length > 0 && !gapsOn;
  // Falhou e não foi cobrado: refazer só esses não paga de novo o que já deu certo.
  const failed = Object.entries(state.fields)
    .filter(([, entry]) => entry.status === 'error')
    .map(([id]) => id);
  const retryCost = reviewCost(aiKey.creditsPerField, failed.length, aiKey.configured);
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">Revisão por IA</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            A IA lê o que você escreveu e aponta problemas, contradições e textos melhores. O texto
            da função e da base é enviado ao Vibecode do Bitrix24.
          </p>
        </div>
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={disabled || running || unavailable || ids.length === 0}
          onClick={() => onReview(ids)}
        >
          {running ? 'Revisando…' : `Revisar com IA · ${cost.label}`}
        </button>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-zinc-800">
          O que você espera do agente? <span className="font-normal text-zinc-400">(opcional)</span>
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500">
          Conte situações reais que o agente deve resolver. A IA confere se a base cobre e sugere os
          itens que faltam.
        </span>
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          value={expectation}
          maxLength={EXPECTATION_MAX}
          disabled={disabled || running}
          onChange={(e) => onExpectation(e.target.value)}
        />
        <span className="mt-1 flex justify-between text-xs">
          <span className={tooShort ? 'text-amber-700' : 'text-transparent'}>
            Descreva situações reais, com pelo menos {EXPECTATION_MIN} caracteres.
          </span>
          <span className="text-zinc-400 tabular-nums">
            {expectation.length}/{EXPECTATION_MAX}
          </span>
        </span>
      </label>
      {unavailable && (
        <p className="text-xs text-amber-700">
          A revisão por IA precisa de uma chave do Vibecode.{' '}
          {canConfigureKey ? (
            <Link href="/app/ai-key" className="font-medium underline">
              Configurar a chave
            </Link>
          ) : (
            'Peça a um administrador do portal para configurar a chave.'
          )}
        </p>
      )}
      {!unavailable && ids.length === 0 && (
        <p className="text-xs text-zinc-500">
          Preencha algum campo de texto ou da base para revisar.
        </p>
      )}
      {failed.length > 0 && !running && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
          <span>
            {failed.length === 1
              ? '1 campo não foi revisado'
              : `${failed.length} campos não foram revisados`}{' '}
            e não {failed.length === 1 ? 'foi cobrado' : 'foram cobrados'}.
          </span>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            disabled={disabled}
            onClick={() => onRetryFailed(failed)}
          >
            Revisar só {failed.length === 1 ? 'este' : 'esses'} · {retryCost.label}
          </button>
        </div>
      )}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.cross === 'running' && (
        <p className="text-xs text-zinc-500">conferindo contradições entre os campos…</p>
      )}
      {state.cross === 'error' && (
        <p className="text-xs text-zinc-500">Não foi possível conferir as contradições agora.</p>
      )}
      {state.cross === 'done' && state.contradictions.length === 0 && (
        <p className="text-xs text-zinc-500">Nenhuma contradição encontrada entre os campos.</p>
      )}
      {state.contradictions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-800">Contradições</p>
          <ul className="mt-1 space-y-1">
            {state.contradictions.map((entry, index) => (
              <li key={index} className="text-xs text-zinc-700">
                • {entry.text}{' '}
                <span className="text-zinc-500">
                  ({entry.fields.map((id) => labels.get(id) ?? id).join(' e ')})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <GapsSection
        state={state}
        form={form}
        answers={answers}
        labels={labels}
        fieldOf={fieldOf}
        onAddGap={onAddGap}
      />
    </Card>
  );
}

/** Lacunas da base: o que falta para cobrir a expectativa, com o item sugerido e "Adicionar". */
function GapsSection({
  state,
  form,
  answers,
  labels,
  fieldOf,
  onAddGap,
}: {
  state: ReviewState;
  form: FunctionTemplateContent;
  answers: FunctionAnswers;
  labels: Map<string, string>;
  fieldOf: Map<string, FunctionField>;
  onAddGap: (gap: ReviewGap, index: number) => void;
}) {
  const gaps = state.gaps;
  if (gaps.status === 'idle') return null;
  if (gaps.status === 'running') {
    return <p className="text-xs text-zinc-500">conferindo a cobertura da base…</p>;
  }
  if (gaps.status === 'error') {
    return (
      <p className="text-xs text-red-600" role="alert">
        {gaps.code === 'NO_CREDIT'
          ? gaps.message
          : 'A cobertura da base não pôde ser conferida agora.'}
        {gaps.code === 'NO_CREDIT' && (
          <>
            {' '}
            <Link href="/app/plan" className="font-medium underline">
              Adicionar créditos
            </Link>
          </>
        )}
      </p>
    );
  }
  const { result, added } = gaps;
  return (
    <div className="space-y-2" aria-label="Cobertura da base">
      <p className="text-xs font-semibold text-zinc-800">Lacunas da base</p>
      {result.gaps.length === 0 ? (
        <p className="text-xs text-zinc-600">Nenhuma lacuna encontrada.</p>
      ) : (
        <ul className="space-y-2">
          {result.gaps.map((gap, index) => {
            const done = added.includes(index);
            const field = fieldOf.get(gap.fieldId);
            const addable = !done && canAddGap(form, answers, field, gap);
            return (
              <li key={index} className="rounded-lg bg-white p-2.5 text-xs ring-1 ring-zinc-200">
                <p className="font-medium text-zinc-800">
                  {gap.title}{' '}
                  <span className="font-normal text-zinc-500">
                    em {labels.get(gap.fieldId) ?? gap.fieldId}
                  </span>
                </p>
                <p className="mt-0.5 text-zinc-600">{gap.why}</p>
                {Object.entries(gap.item).map(([key, text]) => (
                  <p key={key} className="mt-1 whitespace-pre-line text-zinc-700">
                    {text}
                  </p>
                ))}
                {done ? (
                  <p className="mt-2 font-medium text-emerald-700">Adicionado.</p>
                ) : addable ? (
                  <button
                    type="button"
                    className={`${buttonClass('secondary', 'sm')} mt-2`}
                    onClick={() => onAddGap(gap, index)}
                  >
                    Adicionar
                  </button>
                ) : (
                  <p className="mt-2 text-amber-700">
                    {gap.reason ? GAP_REASONS[gap.reason] : 'Este item não pode ser adicionado.'}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {result.gaps.some((gap) =>
        Object.values(gap.item).some((text) => /\[preencher:/i.test(text)),
      ) && (
        <p className="text-xs text-zinc-500">
          Os trechos [preencher: …] dependem de dados do seu negócio: complete antes de publicar.
          Confira cada item adicionado: a IA não conhece a sua empresa.
        </p>
      )}
      {result.covered.length > 0 && (
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer">O que a base já cobre</summary>
          <ul className="mt-1 list-disc pl-5">
            {result.covered.map((entry, index) => (
              <li key={index}>{entry.text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
