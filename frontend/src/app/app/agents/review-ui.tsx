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
  ReviewProblem,
} from '@gptmaker/contracts';
import { EXPECTATION_MAX, EXPECTATION_MIN, flattenFields } from '@gptmaker/contracts';
import Link from 'next/link';
import { createContext, useContext, useState } from 'react';
import { Alert, buttonClass, Card } from '@/components/ui';
import { useT } from '@/i18n';
import {
  answerKey,
  canAddGap,
  canApply,
  expectationValid,
  impactMessage,
  reviewableIds,
  reviewCost,
  reviewImpact,
  sortedWarnings,
  topLevelIds,
  visibleProblems,
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
  const t = useT('assist');
  const [all, setAll] = useState(false);
  if (warnings.length === 0) return null;
  const sorted = sortedWarnings(warnings);
  const shown = all ? sorted : sorted.slice(0, WARNINGS_PER_FIELD);
  const hidden = sorted.length - shown.length;
  return (
    <ul className="mt-2 space-y-1" aria-label={t('review.warningsLabel')}>
      {shown.map((warning, index) => (
        <li
          key={`${warning.code}:${warning.item ?? '-'}:${warning.subfield ?? '-'}:${index}`}
          className={`text-xs ${warning.severity === 'attention' ? 'text-amber-700' : 'text-zinc-500'}`}
        >
          {warning.severity === 'attention' ? '⚠ ' : '• '}
          {warning.item !== undefined && t('review.warningItem', { n: warning.item + 1 })}
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
            {t('review.showMore', { count: hidden })}
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
  const t = useT('assist');
  const suggestion = item.suggestion;
  if (!suggestion) return null;
  if (applied)
    return (
      <p className="mt-2 text-xs font-medium text-emerald-700">{t('review.suggestionApplied')}</p>
    );
  const apply = canApply(review.form, answers, field, item.index, suggestion);
  return (
    <div className="mt-2 rounded-lg bg-white p-2.5 ring-1 ring-zinc-200">
      <p className="text-xs font-medium text-zinc-700">{t('review.suggestedText')}</p>
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
          {t('review.apply')}
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
  const t = useT('assist');
  const state = review.ai?.fields[field.id];
  if (!review.ai || !state) return null;
  if (state.status === 'running') {
    return <p className="mt-2 text-xs text-zinc-500">{t('review.reviewing')}</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="mt-2 text-xs text-red-600" role="alert">
        {state.message}
        {state.code === 'NO_CREDIT' && (
          <>
            {' '}
            <Link href="/app/plan" className="font-medium underline">
              {t('review.addCredits')}
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
              {t('review.retry')}
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
        <p className="text-xs font-semibold text-brand-800">{t('review.aiReview')}</p>
        {outdated && (
          <span className="flex items-center gap-2 text-xs text-amber-700">
            {t('review.outdated')}
            <button
              type="button"
              className="font-medium underline disabled:opacity-50"
              disabled={review.ai.busy}
              onClick={() => review.ai!.onRerun(field.id)}
            >
              {t('review.reviewField')}
            </button>
          </span>
        )}
      </div>
      {state.result.items.every((item) => item.problems.length === 0 && !item.suggestion) ? (
        <p className="mt-1 text-xs text-zinc-600">{t('review.nothingToPoint')}</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {state.result.items.map((item) => (
            <li key={item.index} className="text-xs text-zinc-700">
              <span className="font-medium">{t('form.item', { n: item.index + 1 })}</span>
              {!state.applied?.includes(item.index) && <Problems problems={item.problems} />}
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

/** Problemas de um item: os que atrapalham primeiro; com muitos, as melhorias ficam recolhidas. */
function Problems({ problems }: { problems: ReviewProblem[] }) {
  const t = useT('assist');
  const [open, setOpen] = useState(false);
  const { shown, hidden } = visibleProblems(problems);
  const line = (problem: ReviewProblem, i: number) => (
    <p key={i} className="mt-0.5">
      • <span className="text-zinc-500">{t(`review.categories.${problem.category}`)}:</span>{' '}
      {problem.text}
    </p>
  );
  return (
    <>
      {shown.map(line)}
      {hidden.length > 0 &&
        (open ? (
          hidden.map(line)
        ) : (
          <button
            type="button"
            className="mt-0.5 font-medium underline"
            onClick={() => setOpen(true)}
          >
            {t('review.showMoreImprovements', { count: hidden.length })}
          </button>
        ))}
    </>
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
  const t = useT('assist');
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
      <p className="font-medium">{t('review.attentionPoints', { count: attention.length })}</p>
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
  const t = useT('assist');
  const ids = reviewableIds(form, answers);
  if (!aiKey) return null;
  const unavailable = !aiKey.configured && !aiKey.platformAvailable;
  // Com a expectativa válida, a cobertura entra na conta como mais um campo.
  const gapsOn = expectationValid(expectation);
  const cost = reviewCost(
    aiKey.creditsPerField,
    ids.length + (gapsOn ? 1 : 0),
    aiKey.configured,
    t,
  );
  const allFields = flattenFields(form.fields);
  const labels = new Map(allFields.map((field) => [field.id, field.label]));
  const fieldOf = new Map(allFields.map((field) => [field.id, field]));
  const tooShort = expectation.trim().length > 0 && !gapsOn;
  // Falhou e não foi cobrado: refazer só esses não paga de novo o que já deu certo.
  const failed = Object.entries(state.fields)
    .filter(([, entry]) => entry.status === 'error')
    .map(([id]) => id);
  const retryCost = reviewCost(aiKey.creditsPerField, failed.length, aiKey.configured, t);
  const impact = impactMessage(
    reviewImpact(
      Object.values(state.fields).flatMap((entry) =>
        entry.status === 'done' ? [entry.result] : [],
      ),
    ),
    t,
  );
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">{t('review.aiReview')}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{t('review.panelIntro')}</p>
        </div>
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={disabled || running || unavailable || ids.length === 0}
          onClick={() => onReview(ids)}
        >
          {running ? t('review.reviewingButton') : t('review.reviewButton', { cost: cost.label })}
        </button>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-zinc-800">
          {t('review.expectationLabel')}{' '}
          <span className="font-normal text-zinc-400">{t('review.optional')}</span>
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500">{t('review.expectationHelp')}</span>
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          value={expectation}
          maxLength={EXPECTATION_MAX}
          disabled={disabled || running}
          onChange={(e) => onExpectation(e.target.value)}
        />
        <span className="mt-1 flex justify-between text-xs">
          <span className={tooShort ? 'text-amber-700' : 'text-transparent'}>
            {t('review.expectationTooShort', { min: EXPECTATION_MIN })}
          </span>
          <span className="text-zinc-400 tabular-nums">
            {expectation.length}/{EXPECTATION_MAX}
          </span>
        </span>
      </label>
      {unavailable && (
        <p className="text-xs text-amber-700">
          {t('review.keyRequired')}{' '}
          {canConfigureKey ? (
            <Link href="/app/ai-key" className="font-medium underline">
              {t('review.configureKey')}
            </Link>
          ) : (
            t('review.askAdmin')
          )}
        </p>
      )}
      {!unavailable && ids.length === 0 && (
        <p className="text-xs text-zinc-500">{t('review.fillSomething')}</p>
      )}
      {impact && !running && <p className="text-sm text-zinc-700">{impact}.</p>}
      {failed.length > 0 && !running && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
          <span>{t('review.failedNotCharged', { count: failed.length })}</span>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            disabled={disabled}
            onClick={() => onRetryFailed(failed)}
          >
            {t('review.retryFailed', { count: failed.length, cost: retryCost.label })}
          </button>
        </div>
      )}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.cross === 'running' && (
        <p className="text-xs text-zinc-500">{t('review.crossRunning')}</p>
      )}
      {state.cross === 'error' && <p className="text-xs text-zinc-500">{t('review.crossError')}</p>}
      {state.cross === 'done' && state.contradictions.length === 0 && (
        <p className="text-xs text-zinc-500">{t('review.crossNone')}</p>
      )}
      {state.contradictions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-800">{t('review.contradictions')}</p>
          <ul className="mt-1 space-y-1">
            {state.contradictions.map((entry, index) => (
              <li key={index} className="text-xs text-zinc-700">
                • {entry.text}{' '}
                <span className="text-zinc-500">
                  ({entry.fields.map((id) => labels.get(id) ?? id).join(t('review.and'))})
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
  const t = useT('assist');
  const gaps = state.gaps;
  if (gaps.status === 'idle') return null;
  if (gaps.status === 'running') {
    return <p className="text-xs text-zinc-500">{t('review.gapsRunning')}</p>;
  }
  if (gaps.status === 'error') {
    return (
      <p className="text-xs text-red-600" role="alert">
        {gaps.code === 'NO_CREDIT' ? gaps.message : t('review.gapsError')}
        {gaps.code === 'NO_CREDIT' && (
          <>
            {' '}
            <Link href="/app/plan" className="font-medium underline">
              {t('review.addCredits')}
            </Link>
          </>
        )}
      </p>
    );
  }
  const { result, added } = gaps;
  return (
    <div className="space-y-2" aria-label={t('review.gapsLabel')}>
      <p className="text-xs font-semibold text-zinc-800">{t('review.gapsTitle')}</p>
      {result.gaps.length === 0 ? (
        <p className="text-xs text-zinc-600">{t('review.gapsNone')}</p>
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
                    {t('review.gapIn', { field: labels.get(gap.fieldId) ?? gap.fieldId })}
                  </span>
                </p>
                <p className="mt-0.5 text-zinc-600">{gap.why}</p>
                {Object.entries(gap.item).map(([key, text]) => (
                  <p key={key} className="mt-1 whitespace-pre-line text-zinc-700">
                    {text}
                  </p>
                ))}
                {done ? (
                  <p className="mt-2 font-medium text-emerald-700">{t('review.gapAdded')}</p>
                ) : addable ? (
                  <button
                    type="button"
                    className={`${buttonClass('secondary', 'sm')} mt-2`}
                    onClick={() => onAddGap(gap, index)}
                  >
                    {t('review.gapAdd')}
                  </button>
                ) : (
                  <p className="mt-2 text-amber-700">
                    {gap.reason ? t(`review.gapReasons.${gap.reason}`) : t('review.gapCannotAdd')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {result.gaps.some((gap) =>
        Object.values(gap.item).some((text) => /\[preencher:/i.test(text)),
      ) && <p className="text-xs text-zinc-500">{t('review.gapPlaceholders')}</p>}
      {result.covered.length > 0 && (
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer">{t('review.covered')}</summary>
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
