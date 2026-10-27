'use client';

import {
  type AnswerIssue,
  compileAgent,
  FUNCTION_BEHAVIOR_MAX,
  type FunctionAnswers,
  type FunctionAnswerValue,
  type FunctionField,
  type FunctionMode,
  type FunctionTemplateContent,
  type KnowledgeItem,
  renderKnowledgeItem,
  selectedValues,
  TRAINING_TEXT_MAX,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { useMemo } from 'react';
import { CloseIcon, PlusIcon } from '@/components/icons';
import { buttonClass, Card } from '@/components/ui';
import { Field, inputClass } from './agent-fields';
import { PipelineStageFields, ResponsiblePicker } from './bitrix-pickers';

/**
 * Formulário da função do agente (spec agent-function-configuration), montado a partir da versão
 * do template: o cliente responde sobre o negócio; o texto do agente é nosso.
 */

type Props = {
  form: FunctionTemplateContent;
  answers: FunctionAnswers;
  onChange: (answers: FunctionAnswers) => void;
  issues?: AnswerIssue[];
  disabled?: boolean;
};

/** Problema de um campo (ou de um item dele: `campo[0]`, `campo[0].sub`). */
function issuesOf(issues: AnswerIssue[] | undefined, id: string): AnswerIssue[] {
  return (issues ?? []).filter((issue) => issue.field === id || issue.field.startsWith(`${id}[`));
}

function IssueText({ issues }: { issues: AnswerIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <span className="mt-1.5 block text-xs text-red-600">
      {[...new Set(issues.map((issue) => issue.message))].join('; ')}
    </span>
  );
}

function counter(text: string, max: number): string {
  return `${text.length}/${max}`;
}

export function FunctionForm({ form, answers, onChange, issues, disabled }: Props) {
  const set = (id: string, value: FunctionAnswerValue | undefined) => {
    const next = { ...answers };
    if (value === undefined) delete next[id];
    else next[id] = value;
    onChange(next);
  };
  const config = form.fields.filter((field) => field.kind !== 'KNOWLEDGE');
  const knowledge = form.fields.filter((field) => field.kind === 'KNOWLEDGE');

  return (
    <div className="space-y-6">
      <Card className="space-y-6 p-6">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">Como o agente atende</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Responda sobre o seu negócio. O texto que o agente segue é montado a partir das
            respostas.
          </p>
        </div>
        {config.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            answers={answers}
            set={set}
            issues={issues}
            disabled={disabled}
          />
        ))}
      </Card>
      {knowledge.length > 0 && (
        <Card className="space-y-6 p-6">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">Base de conhecimento</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Um assunto por item. Cada item vira um treinamento do agente.
            </p>
          </div>
          {knowledge.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              answers={answers}
              set={set}
              issues={issues}
              disabled={disabled}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

function FieldInput({
  field,
  answers,
  set,
  issues,
  disabled,
}: {
  field: FunctionField;
  answers: FunctionAnswers;
  set: (id: string, value: FunctionAnswerValue | undefined) => void;
  issues?: AnswerIssue[];
  disabled?: boolean;
}) {
  const value = answers[field.id];
  const own = issuesOf(issues, field.id);
  const label = field.required ? field.label : `${field.label} (opcional)`;

  switch (field.kind) {
    case 'TEXT': {
      const text = typeof value === 'string' ? value : '';
      const Input = field.multiline ? 'textarea' : 'input';
      return (
        <Field
          label={label}
          hint={[field.help, counter(text, field.maxLength)].filter(Boolean).join(' ')}
        >
          <Input
            className={inputClass}
            value={text}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            rows={field.multiline ? 3 : undefined}
            disabled={disabled}
            onChange={(e) => set(field.id, e.target.value)}
          />
          <IssueText issues={own} />
        </Field>
      );
    }
    case 'URL': {
      const text = typeof value === 'string' ? value : '';
      return (
        <Field label={label} hint={field.help}>
          <input
            type="url"
            className={inputClass}
            value={text}
            maxLength={field.maxLength}
            placeholder="https://"
            disabled={disabled}
            onChange={(e) => set(field.id, e.target.value)}
          />
          <IssueText issues={own} />
        </Field>
      );
    }
    case 'INTEGER':
      return (
        <Field label={label} hint={field.help ?? `De ${field.min} a ${field.max}.`}>
          <input
            type="number"
            min={field.min}
            max={field.max}
            className={`${inputClass} w-32`}
            value={typeof value === 'number' ? value : ''}
            disabled={disabled}
            onChange={(e) =>
              set(field.id, e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))
            }
          />
          <IssueText issues={own} />
        </Field>
      );
    case 'BITRIX_USER':
      return (
        <div>
          <ResponsiblePicker
            label={label}
            value={typeof value === 'number' ? value : 0}
            disabled={disabled}
            onChange={(id) => set(field.id, id > 0 ? id : undefined)}
          />
          <IssueText issues={own} />
        </div>
      );
    case 'BITRIX_STAGE': {
      const stage =
        value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : { categoryId: 0, stageId: '' };
      return (
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-800">{label}</p>
          <PipelineStageFields
            categoryId={stage.categoryId}
            stageId={stage.stageId}
            disabled={disabled}
            onChange={(next) => set(field.id, { ...stage, ...next })}
          />
          <IssueText issues={own} />
        </div>
      );
    }
    case 'TEXT_LIST':
      return <ListInput field={field} value={value} set={set} issues={own} disabled={disabled} />;
    case 'CHOICE':
    case 'MULTI_CHOICE':
      return (
        <ChoiceInput
          field={field}
          answers={answers}
          set={set}
          issues={issues}
          disabled={disabled}
        />
      );
    case 'KNOWLEDGE':
      return (
        <KnowledgeInput field={field} value={value} set={set} issues={own} disabled={disabled} />
      );
  }
}

function ListInput({
  field,
  value,
  set,
  issues,
  disabled,
}: {
  field: Extract<FunctionField, { kind: 'TEXT_LIST' }>;
  value: FunctionAnswerValue | undefined;
  set: (id: string, value: FunctionAnswerValue | undefined) => void;
  issues: AnswerIssue[];
  disabled?: boolean;
}) {
  const items = Array.isArray(value) ? (value as string[]) : [];
  const shown = items.length ? items : [''];
  const update = (next: string[]) => set(field.id, next);
  return (
    <div className="text-sm">
      <span className="font-medium text-zinc-800">
        {field.required ? field.label : `${field.label} (opcional)`}
      </span>
      {field.help && <span className="mt-1 block text-xs text-zinc-500">{field.help}</span>}
      <div className="mt-2 space-y-2">
        {shown.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              className={`${inputClass} mt-0`}
              value={item}
              maxLength={field.itemMaxLength}
              placeholder={index === 0 ? field.placeholder : undefined}
              disabled={disabled}
              aria-label={`${field.label} ${index + 1}`}
              onChange={(e) => {
                const next = [...shown];
                next[index] = e.target.value;
                update(next);
              }}
            />
            {shown.length > 1 && (
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                disabled={disabled}
                aria-label="Remover"
                onClick={() => update(shown.filter((_, i) => i !== index))}
              >
                <CloseIcon className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {shown.length < field.maxItems && (
        <button
          type="button"
          className={`${buttonClass('secondary', 'sm')} mt-2`}
          disabled={disabled}
          onClick={() => update([...shown, ''])}
        >
          <PlusIcon className="size-4" /> Adicionar
        </button>
      )}
      <span className="mt-1.5 block text-xs text-zinc-500">
        Até {field.maxItems} itens, {field.itemMaxLength} caracteres cada.
      </span>
      <IssueText issues={issues} />
    </div>
  );
}

function ChoiceInput({
  field,
  answers,
  set,
  issues,
  disabled,
}: {
  field: Extract<FunctionField, { kind: 'CHOICE' | 'MULTI_CHOICE' }>;
  answers: FunctionAnswers;
  set: (id: string, value: FunctionAnswerValue | undefined) => void;
  issues?: AnswerIssue[];
  disabled?: boolean;
}) {
  const chosen = selectedValues(answers[field.id]);
  const multi = field.kind === 'MULTI_CHOICE';
  const toggle = (option: string) => {
    if (!multi) return set(field.id, option);
    const next = chosen.includes(option)
      ? chosen.filter((value) => value !== option)
      : [...chosen, option];
    set(
      field.id,
      field.options.map((o) => o.value).filter((value) => next.includes(value)),
    );
  };
  return (
    <fieldset className="text-sm">
      <legend className="font-medium text-zinc-800">
        {field.required ? field.label : `${field.label} (opcional)`}
      </legend>
      {field.help && <span className="mt-1 block text-xs text-zinc-500">{field.help}</span>}
      <div className="mt-2 space-y-2">
        {field.options.map((option) => {
          const active = chosen.includes(option.value);
          return (
            <div
              key={option.value}
              className={`rounded-lg border p-3 ${active ? 'border-brand-500 bg-brand-50/40' : 'border-zinc-200'}`}
            >
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={field.id}
                  checked={active}
                  disabled={disabled}
                  onChange={() => toggle(option.value)}
                  className="size-4 accent-brand-600"
                />
                <span className="text-zinc-800">{option.label}</span>
              </label>
              {active && option.dependents?.length ? (
                <div className="mt-3 space-y-4 border-l-2 border-brand-100 pl-4">
                  {option.dependents.map((dependent) => (
                    <FieldInput
                      key={dependent.id}
                      field={dependent}
                      answers={answers}
                      set={set}
                      issues={issues}
                      disabled={disabled}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <IssueText issues={issuesOf(issues, field.id).filter((issue) => issue.field === field.id)} />
    </fieldset>
  );
}

function KnowledgeInput({
  field,
  value,
  set,
  issues,
  disabled,
}: {
  field: Extract<FunctionField, { kind: 'KNOWLEDGE' }>;
  value: FunctionAnswerValue | undefined;
  set: (id: string, value: FunctionAnswerValue | undefined) => void;
  issues: AnswerIssue[];
  disabled?: boolean;
}) {
  const items = (Array.isArray(value) ? value : []) as KnowledgeItem[];
  const update = (next: KnowledgeItem[]) => set(field.id, next);
  const blank = (): KnowledgeItem => ({
    itemKey: crypto.randomUUID(),
    values: Object.fromEntries(field.subfields.map((subfield) => [subfield.id, ''])),
  });
  return (
    <div className="text-sm">
      <span className="font-medium text-zinc-800">{field.label}</span>
      {field.help && <span className="mt-1 block text-xs text-zinc-500">{field.help}</span>}
      <div className="mt-2 space-y-3">
        {items.map((item, index) => {
          const length = renderKnowledgeItem(field, item).length;
          return (
            <div key={item.itemKey} className="rounded-lg border border-zinc-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500">Item {index + 1}</span>
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  disabled={disabled}
                  onClick={() => update(items.filter((other) => other.itemKey !== item.itemKey))}
                >
                  Remover
                </button>
              </div>
              <div className="space-y-3">
                {field.subfields.map((subfield) => {
                  const Input = subfield.multiline ? 'textarea' : 'input';
                  const text = item.values[subfield.id] ?? '';
                  return (
                    <Field
                      key={subfield.id}
                      label={subfield.required ? subfield.label : `${subfield.label} (opcional)`}
                      hint={counter(text, subfield.maxLength)}
                    >
                      <Input
                        className={inputClass}
                        value={text}
                        maxLength={subfield.maxLength}
                        rows={subfield.multiline ? 4 : undefined}
                        disabled={disabled}
                        onChange={(e) =>
                          update(
                            items.map((other) =>
                              other.itemKey === item.itemKey
                                ? {
                                    ...other,
                                    values: { ...other.values, [subfield.id]: e.target.value },
                                  }
                                : other,
                            ),
                          )
                        }
                      />
                    </Field>
                  );
                })}
              </div>
              <span
                className={`mt-2 block text-xs ${length > TRAINING_TEXT_MAX ? 'text-red-600' : 'text-zinc-500'}`}
              >
                Treinamento com {length} de {TRAINING_TEXT_MAX} caracteres.
              </span>
              <IssueText
                issues={issues.filter((issue) => issue.field.startsWith(`${field.id}[${index}]`))}
              />
            </div>
          );
        })}
      </div>
      {items.length < field.maxItems && (
        <button
          type="button"
          className={`${buttonClass('secondary', 'sm')} mt-3`}
          disabled={disabled}
          onClick={() => update([...items, blank()])}
        >
          <PlusIcon className="size-4" /> Adicionar item
        </button>
      )}
      <IssueText issues={issues.filter((issue) => issue.field === field.id)} />
    </div>
  );
}

/**
 * Tamanho do comportamento com as respostas atuais, pelo mesmo compilador do backend: o número
 * aqui é o que será publicado (design D1).
 */
export function BehaviorMeter({
  form,
  answers,
  agentName,
  mode = 'SIMPLE',
  additionalInstructions,
}: {
  form: FunctionTemplateContent;
  answers: FunctionAnswers;
  agentName: string;
  mode?: FunctionMode;
  additionalInstructions?: string | null;
}) {
  const length = useMemo(() => {
    const valid = validateFunctionAnswers(form, answers, { partial: true }).answers;
    return compileAgent({
      content: form,
      answers: valid,
      agentName: agentName || 'Agente',
      mode,
      additionalInstructions,
    }).behavior.length;
  }, [form, answers, agentName, mode, additionalInstructions]);
  const ratio = Math.min(1, length / FUNCTION_BEHAVIOR_MAX);
  const over = length > FUNCTION_BEHAVIOR_MAX;
  return (
    <div className="text-xs text-zinc-600">
      <div className="flex justify-between">
        <span>Texto do agente</span>
        <span className={over ? 'font-medium text-red-600' : ''}>
          {length} de {FUNCTION_BEHAVIOR_MAX} caracteres
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full ${over ? 'bg-red-500' : ratio > 0.9 ? 'bg-amber-500' : 'bg-brand-500'}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
