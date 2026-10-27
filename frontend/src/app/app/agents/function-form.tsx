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
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { BookIcon, CheckIcon, CloseIcon, PlusIcon, TextIcon, TrashIcon } from '@/components/icons';
import { buttonClass } from '@/components/ui';
import { inputClass } from './agent-fields';
import {
  AgentPicker,
  OpenLinePicker,
  PipelineStageFields,
  ResponsiblePicker,
  UsersPicker,
} from './bitrix-pickers';

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
  /** Agentes que um campo "Agente" pode escolher (sem o próprio e sem removidos). */
  agents?: Array<{ id: string; name: string }>;
};

/** Problema de um campo (ou de um item dele: `campo[0]`, `campo[0].sub`). */
function issuesOf(issues: AnswerIssue[] | undefined, id: string): AnswerIssue[] {
  return (issues ?? []).filter((issue) => issue.field === id || issue.field.startsWith(`${id}[`));
}

/** Campo e dependentes das opções escolhidas: um problema em qualquer um marca a pergunta. */
function issuesDeep(
  field: FunctionField,
  answers: FunctionAnswers,
  issues?: AnswerIssue[],
): AnswerIssue[] {
  const own = issuesOf(issues, field.id);
  if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') return own;
  const chosen = selectedValues(answers[field.id]);
  return [
    ...own,
    ...field.options
      .filter((option) => chosen.includes(option.value))
      .flatMap((option) => option.dependents ?? [])
      .flatMap((dependent) => issuesDeep(dependent, answers, issues)),
  ];
}

/** Resposta preenchida (vazio, lista em branco e escolha nenhuma contam como não respondida). */
export function isAnswered(field: FunctionField, answers: FunctionAnswers): boolean {
  const value = answers[field.id];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) {
    return value.some((item) =>
      typeof item === 'number'
        ? true
        : typeof item === 'string'
          ? item.trim().length > 0
          : Object.values((item as KnowledgeItem).values).some((text) => text.trim()),
    );
  }
  if (field.kind === 'BITRIX_STAGE') return Boolean((value as { stageId?: string }).stageId);
  return true;
}

/** Id do elemento de uma pergunta, para o índice rolar até ela. */
const anchor = (id: string) => `pergunta-${id}`;

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

/** Título de uma pergunta (dentro do `<label>`, para o campo ser encontrado pelo rótulo). */
function Title({ field, help }: { field: FunctionField; help?: ReactNode }) {
  return (
    <>
      <span className="text-sm font-semibold text-zinc-900">{field.label}</span>
      {!field.required && (
        <span className="ml-1.5 text-xs font-normal text-zinc-400">(opcional)</span>
      )}
      {(help ?? field.help) && (
        <span className="mt-0.5 block text-xs text-zinc-500">{help ?? field.help}</span>
      )}
    </>
  );
}

/** Rodapé de um campo de texto: contador à direita. */
function Counter({ text, max }: { text: string; max: number }) {
  const near = text.length > max * 0.9;
  return (
    <span
      className={`mt-1 block text-right text-xs tabular-nums ${near ? 'text-amber-600' : 'text-zinc-400'}`}
    >
      {counter(text, max)}
    </span>
  );
}

/** Seção do formulário: título, explicação e progresso. */
function Group({
  icon: Icon,
  title,
  description,
  fields,
  answers,
  children,
}: {
  icon: typeof TextIcon;
  title: string;
  description: string;
  fields: FunctionField[];
  answers: FunctionAnswers;
  children: ReactNode;
}) {
  const done = fields.filter((field) => isAnswered(field, answers)).length;
  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Icon className="size-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
            <p className="text-sm text-zinc-500">{description}</p>
          </div>
        </div>
        <span className="text-xs text-zinc-500 tabular-nums">
          {done} de {fields.length} respondidas
        </span>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Agentes que os campos "Agente" oferecem (D17), sem repassar por cada pergunta. */
const FormAgents = createContext<Array<{ id: string; name: string }>>([]);

export function FunctionForm({ form, answers, onChange, issues, disabled, agents }: Props) {
  const set = (id: string, value: FunctionAnswerValue | undefined) => {
    const next = { ...answers };
    if (value === undefined) delete next[id];
    else next[id] = value;
    onChange(next);
  };
  const config = form.fields.filter((field) => field.kind !== 'KNOWLEDGE');
  const knowledge = form.fields.filter((field) => field.kind === 'KNOWLEDGE');
  const card = (field: FunctionField, index: number) => (
    <QuestionCard
      key={field.id}
      field={field}
      index={index}
      answers={answers}
      set={set}
      issues={issues}
      disabled={disabled}
    />
  );

  return (
    <FormAgents.Provider value={agents ?? []}>
      <div className="space-y-8">
        <Group
          icon={TextIcon}
          title="Como o agente atende"
          description="Responda sobre o seu negócio. O texto que o agente segue é montado a partir das respostas."
          fields={config}
          answers={answers}
        >
          {config.map((field, index) => card(field, index))}
        </Group>
        {knowledge.length > 0 && (
          <Group
            icon={BookIcon}
            title="Base de conhecimento"
            description="Um assunto por item. Cada item vira um treinamento do agente."
            fields={knowledge}
            answers={answers}
          >
            {knowledge.map((field, index) => card(field, config.length + index))}
          </Group>
        )}
      </div>
    </FormAgents.Provider>
  );
}

/** Pergunta de primeiro nível num cartão numerado, com o estado (respondida, com problema). */
function QuestionCard({
  field,
  index,
  answers,
  set,
  issues,
  disabled,
}: {
  field: FunctionField;
  index: number;
  answers: FunctionAnswers;
  set: (id: string, value: FunctionAnswerValue | undefined) => void;
  issues?: AnswerIssue[];
  disabled?: boolean;
}) {
  const invalid = issuesDeep(field, answers, issues).length > 0;
  const answered = isAnswered(field, answers);
  return (
    <div
      id={anchor(field.id)}
      className={`flex scroll-mt-6 gap-3 rounded-2xl border bg-white p-4 shadow-xs transition-colors sm:gap-4 sm:p-5 ${
        invalid
          ? 'border-red-300 ring-1 ring-red-100'
          : 'border-zinc-200/80 focus-within:border-brand-200 focus-within:ring-1 focus-within:ring-brand-100'
      }`}
    >
      <span
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          invalid
            ? 'bg-red-500 text-white'
            : answered
              ? 'bg-emerald-500 text-white'
              : 'bg-zinc-100 text-zinc-500'
        }`}
        aria-hidden
      >
        {answered && !invalid ? <CheckIcon className="size-3.5" /> : index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <FieldInput field={field} answers={answers} set={set} issues={issues} disabled={disabled} />
      </div>
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
  const agents = useContext(FormAgents);

  switch (field.kind) {
    case 'TEXT': {
      const text = typeof value === 'string' ? value : '';
      const Input = field.multiline ? 'textarea' : 'input';
      return (
        <label className="block">
          <Title field={field} />
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
          <Counter text={text} max={field.maxLength} />
        </label>
      );
    }
    case 'URL': {
      const text = typeof value === 'string' ? value : '';
      return (
        <label className="block">
          <Title field={field} />
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
        </label>
      );
    }
    case 'INTEGER':
      return (
        <label className="block">
          <Title field={field} help={field.help ?? `De ${field.min} a ${field.max}.`} />
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
        </label>
      );
    case 'BITRIX_USER':
      if (field.multiple) {
        return (
          <div>
            <UsersPicker
              label={field.required ? field.label : `${field.label} (opcional)`}
              value={Array.isArray(value) ? (value as number[]) : []}
              disabled={disabled}
              onChange={(ids) => set(field.id, ids.length ? ids : undefined)}
            />
            <IssueText issues={own} />
          </div>
        );
      }
      return (
        <div>
          <ResponsiblePicker
            label={field.required ? field.label : `${field.label} (opcional)`}
            value={typeof value === 'number' ? value : 0}
            disabled={disabled}
            onChange={(id) => set(field.id, id > 0 ? id : undefined)}
          />
          <IssueText issues={own} />
        </div>
      );
    case 'BITRIX_OPENLINE':
      return (
        <div>
          <OpenLinePicker
            label={field.required ? field.label : `${field.label} (opcional)`}
            value={typeof value === 'number' ? value : 0}
            disabled={disabled}
            onChange={(id) => set(field.id, id > 0 ? id : undefined)}
          />
          <IssueText issues={own} />
        </div>
      );
    case 'AGENT':
      return (
        <div>
          <AgentPicker
            label={field.required ? field.label : `${field.label} (opcional)`}
            value={typeof value === 'string' ? value : ''}
            agents={agents ?? []}
            disabled={disabled}
            onChange={(id) => set(field.id, id || undefined)}
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
          <p className="mb-1">
            <Title field={field} />
          </p>
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
      <Title field={field} />
      <div className="mt-2 space-y-2">
        {shown.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-zinc-400 tabular-nums">
              {index + 1}.
            </span>
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
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
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
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-7">
        {shown.length < field.maxItems ? (
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            disabled={disabled}
            onClick={() => update([...shown, ''])}
          >
            <PlusIcon className="size-4" /> Adicionar
          </button>
        ) : (
          <span />
        )}
        <span className="text-xs text-zinc-400">
          Até {field.maxItems} itens, {field.itemMaxLength} caracteres cada.
        </span>
      </div>
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
  // Opções curtas cabem em duas colunas; as longas ficam uma por linha.
  const compact = field.options.every((option) => option.label.length <= 40);
  return (
    <fieldset className="text-sm">
      <legend className="w-full">
        <Title field={field} help={field.help ?? (multi ? 'Marque quantas quiser.' : undefined)} />
      </legend>
      <div className={`mt-3 grid gap-2 ${compact ? 'sm:grid-cols-2' : ''}`}>
        {field.options.map((option) => {
          const active = chosen.includes(option.value);
          return (
            <div
              key={option.value}
              className={`rounded-xl border transition-colors ${
                active
                  ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500'
                  : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
              } ${active && option.dependents?.length ? 'sm:col-span-2' : ''}`}
            >
              <label className="relative flex cursor-pointer items-center gap-3 px-3.5 py-3">
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={field.id}
                  checked={active}
                  disabled={disabled}
                  onChange={() => toggle(option.value)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className={`flex size-4.5 shrink-0 items-center justify-center border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-300 ${
                    multi ? 'rounded-md' : 'rounded-full'
                  } ${active ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-300 bg-white'}`}
                >
                  {active &&
                    (multi ? (
                      <CheckIcon className="size-3" strokeWidth={3} />
                    ) : (
                      <span className="size-1.5 rounded-full bg-white" />
                    ))}
                </span>
                <span className={active ? 'font-medium text-zinc-900' : 'text-zinc-700'}>
                  {option.label}
                </span>
              </label>
              {active && option.dependents?.length ? (
                <div className="space-y-4 border-t border-brand-100 px-3.5 py-4 sm:pl-11">
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
  const first = field.subfields[0];
  return (
    <div className="text-sm">
      <Title field={field} />
      <div className="mt-3 space-y-3">
        {items.map((item, index) => {
          const length = renderKnowledgeItem(field, item).length;
          const title = first ? item.values[first.id]?.trim() : '';
          return (
            <div key={item.itemKey} className="rounded-xl border border-zinc-200 bg-zinc-50/60">
              <div className="flex items-center gap-2 border-b border-zinc-200/70 px-3.5 py-2">
                <span className="flex size-5 items-center justify-center rounded-md bg-white text-[11px] font-semibold text-zinc-500 ring-1 ring-zinc-200">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-700">
                  {title || `Item ${index + 1}`}
                </span>
                <span
                  className={`text-xs tabular-nums ${length > TRAINING_TEXT_MAX ? 'text-red-600' : 'text-zinc-400'}`}
                  title={`Treinamento com ${length} de ${TRAINING_TEXT_MAX} caracteres`}
                >
                  {length}/{TRAINING_TEXT_MAX}
                </span>
                <button
                  type="button"
                  className="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                  disabled={disabled}
                  aria-label={`Remover item ${index + 1}`}
                  onClick={() => update(items.filter((other) => other.itemKey !== item.itemKey))}
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
              <div className="space-y-3 p-3.5">
                {field.subfields.map((subfield) => {
                  const Input = subfield.multiline ? 'textarea' : 'input';
                  const text = item.values[subfield.id] ?? '';
                  return (
                    <label key={subfield.id} className="block">
                      <span className="text-xs font-medium text-zinc-700">
                        {subfield.required ? subfield.label : `${subfield.label} (opcional)`}
                      </span>
                      <Input
                        className={`${inputClass} mt-1`}
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
                      <Counter text={text} max={subfield.maxLength} />
                    </label>
                  );
                })}
                <IssueText
                  issues={issues.filter((issue) => issue.field.startsWith(`${field.id}[${index}]`))}
                />
              </div>
            </div>
          );
        })}
      </div>
      {items.length < field.maxItems && (
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700 disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          onClick={() => update([...items, blank()])}
        >
          <PlusIcon className="size-4" /> Adicionar item
          <span className="font-normal text-zinc-400">
            ({items.length} de {field.maxItems})
          </span>
        </button>
      )}
      <IssueText issues={issues.filter((issue) => issue.field === field.id)} />
    </div>
  );
}

/**
 * Índice do formulário: progresso e uma linha por pergunta com o estado; o clique rola até ela.
 * Fica ao lado do formulário (assistente de criação, página da função).
 */
export function FunctionFormOutline({
  form,
  answers,
  issues,
}: {
  form: FunctionTemplateContent;
  answers: FunctionAnswers;
  issues?: AnswerIssue[];
}) {
  const required = form.fields.filter((field) => field.required);
  const done = required.filter((field) => isAnswered(field, answers)).length;
  const ratio = required.length ? done / required.length : 1;
  return (
    <nav aria-label="Perguntas do formulário" className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-zinc-700">Obrigatórias</span>
          <span className="text-zinc-500 tabular-nums">
            {done} de {required.length}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>
      <ol className="space-y-0.5">
        {form.fields.map((field, index) => {
          const invalid = issuesDeep(field, answers, issues).length > 0;
          const answered = isAnswered(field, answers);
          return (
            <li key={field.id}>
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById(anchor(field.id))
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-zinc-100"
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                    invalid
                      ? 'bg-red-500 text-white'
                      : answered
                        ? 'bg-emerald-500 text-white'
                        : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  {answered && !invalid ? <CheckIcon className="size-3" /> : index + 1}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${invalid ? 'text-red-700' : answered ? 'text-zinc-500' : 'text-zinc-800'}`}
                >
                  {field.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
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
    <div className="@container rounded-xl border border-zinc-200/80 bg-white px-4 py-3 text-xs text-zinc-600 shadow-xs">
      <div className="flex flex-col gap-0.5 @[16rem]:flex-row @[16rem]:justify-between @[16rem]:gap-3">
        <span className="font-medium text-zinc-700">Texto do agente</span>
        <span className={`tabular-nums ${over ? 'font-medium text-red-600' : ''}`}>
          {length} de {FUNCTION_BEHAVIOR_MAX} caracteres
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : ratio > 0.9 ? 'bg-amber-500' : 'bg-brand-500'}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
