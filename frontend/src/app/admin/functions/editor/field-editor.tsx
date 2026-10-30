'use client';

import type {
  FunctionField,
  FunctionKnowledgeSubfield,
  FunctionSpaValue,
  FunctionOption,
  MarkerOption,
} from '@gptmaker/contracts';
import { useState, type ReactNode } from 'react';
import { ChevronDownIcon, PlusIcon } from '@/components/icons';
import { Badge, buttonClass } from '@/components/ui';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { useFocusCard } from './focus';
import {
  AddPicker,
  Code,
  Disclosure,
  IconButton,
  Issues,
  ItemActions,
  KIND_STYLE,
  Label,
  Segmented,
  TriState,
  TypeIcon,
} from './kit';
import { MarkerText } from './marker-text';
import {
  allIds,
  type FieldKind,
  KIND_HINTS,
  KIND_LABELS,
  makeId,
  moveItem,
  newField,
  newOption,
  type Published,
  slug,
  uniqueId,
} from './model';

/** Id ou valor de opção renomeado: o editor atualiza as referências no resto do conteúdo. */
export type Rename =
  | { kind: 'id'; from: string; to: string }
  | { kind: 'option'; fieldId: string; from: string; to: string };

export interface FieldContext {
  /** Prefixo dos ids novos (`suporte`). */
  prefix: string;
  published: Published;
  /** Ids em uso no conteúdo inteiro. */
  takenIds: Set<string>;
  /** Marcadores válidos nos trechos das opções. */
  markers: MarkerOption[];
  /** Problemas da checagem num campo (e opção). */
  issues: (fieldId: string, option?: string) => string[];
  disabled?: boolean;
}

/** Tipos de pergunta no seletor "Adicionar pergunta". */
const KIND_ITEMS = (Object.keys(KIND_LABELS) as FieldKind[]).map((kind) => ({
  key: kind,
  label: KIND_LABELS[kind],
  hint: KIND_HINTS[kind],
  ...KIND_STYLE[kind],
}));

function NumberInput({
  label,
  value,
  onChange,
  min,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        className={`${inputClass} w-28`}
        value={value}
        min={min}
        disabled={disabled}
        onChange={(e) => onChange(Math.trunc(Number(e.target.value)))}
      />
    </Field>
  );
}

/** Caixa de seleção com rótulo ao lado. */
function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-700">
      <input
        type="checkbox"
        className="size-4 rounded accent-brand-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** Lista de campos (do formulário ou dependentes de uma opção), com adicionar e reordenar. */
export function FieldList({
  fields,
  onChange,
  ctx,
  addLabel = 'Adicionar pergunta',
  empty,
}: {
  fields: FunctionField[];
  onChange: (fields: FunctionField[], rename?: Rename) => void;
  ctx: FieldContext;
  addLabel?: string;
  empty?: ReactNode;
}) {
  // A pergunta recém-criada já abre: o próximo passo é dar o rótulo.
  const [added, setAdded] = useState<number | null>(null);

  function add(kind: FieldKind) {
    const label = 'Nova pergunta';
    const id = uniqueId(makeId(ctx.prefix, label), ctx.takenIds);
    onChange([...fields, newField(kind, id, label)]);
    setAdded(fields.length);
  }

  return (
    <div className="space-y-2">
      {fields.length === 0 && empty}
      {fields.map((field, index) => (
        <FieldCard
          // Chave por posição: o id muda enquanto o rótulo é digitado.
          key={index}
          index={index}
          field={field}
          ctx={ctx}
          isNew={index === added}
          onChange={(next, rename) =>
            onChange(
              fields.map((f, i) => (i === index ? next : f)),
              rename,
            )
          }
          onMove={(delta) => onChange(moveItem(fields, index, delta))}
          onRemove={() => {
            setAdded(null);
            onChange(fields.filter((_, i) => i !== index));
          }}
        />
      ))}
      <AddPicker label={addLabel} items={KIND_ITEMS} onPick={add} disabled={ctx.disabled} />
    </div>
  );
}

function FieldCard({
  index,
  field,
  ctx,
  isNew,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  field: FunctionField;
  ctx: FieldContext;
  isNew: boolean;
  onChange: (field: FunctionField, rename?: Rename) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const published = ctx.published[field.id];
  const disabled = ctx.disabled;
  const issues = ctx.issues(field.id);
  const optionIssues =
    field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE'
      ? field.options.some((option) => ctx.issues(field.id, option.value).length > 0)
      : false;
  const { ref, open, setOpen } = useFocusCard({
    contains: (target) => target.fieldId !== undefined && allIds([field]).has(target.fieldId),
    isSelf: (target) => target.fieldId === field.id,
    startOpen: isNew || issues.length > 0 || optionIssues,
  });
  const set = (patch: Partial<FunctionField>) => onChange({ ...field, ...patch } as FunctionField);
  const style = KIND_STYLE[field.kind];
  const invalid = issues.length > 0 || optionIssues;

  /** Rótulo novo: enquanto não publicado e com id automático, o id acompanha o rótulo. */
  function setLabel(label: string) {
    const auto = !published && field.id === makeId(ctx.prefix, field.label);
    if (!auto) return set({ label });
    const taken = new Set(ctx.takenIds);
    taken.delete(field.id);
    const id = uniqueId(makeId(ctx.prefix, label), taken);
    onChange(
      { ...field, label, id },
      id !== field.id ? { kind: 'id', from: field.id, to: id } : undefined,
    );
  }

  function setId(id: string) {
    if (published || id === field.id) return;
    onChange({ ...field, id }, { kind: 'id', from: field.id, to: id });
  }

  function setKind(kind: FieldKind) {
    const next = newField(kind, field.id, field.label);
    onChange({
      ...next,
      required: field.required,
      ...(field.help ? { help: field.help } : {}),
    } as FunctionField);
  }

  return (
    <div
      ref={ref}
      className={`group scroll-mt-24 rounded-xl border bg-white transition-shadow ${
        invalid
          ? 'border-red-300 ring-1 ring-red-100'
          : open
            ? 'border-brand-200 shadow-md ring-1 ring-brand-100'
            : 'border-zinc-200 hover:border-zinc-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <TypeIcon icon={style.icon} tone={style.tone} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 tabular-nums">{index + 1}.</span>
              <span className="truncate text-sm font-medium text-zinc-900">{field.label}</span>
              {!field.required && <span className="shrink-0 text-xs text-zinc-400">opcional</span>}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-zinc-500">
              {KIND_LABELS[field.kind]}
              {(field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE') && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">
                    {field.options.map((option) => option.label).join(', ')}
                  </span>
                </>
              )}
            </span>
          </span>
          {invalid && (
            <Badge tone="red">
              {issues.length === 0
                ? 'problema nas opções'
                : issues.length === 1
                  ? '1 problema'
                  : `${issues.length} problemas`}
            </Badge>
          )}
          {published && (
            <span
              className="hidden shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 sm:inline"
              title="Já saiu numa versão publicada: o identificador e o tipo ficam travados."
            >
              publicada
            </span>
          )}
        </button>
        <div className="opacity-60 transition-opacity group-hover:opacity-100">
          <ItemActions
            disabled={disabled}
            onUp={() => onMove(-1)}
            onDown={() => onMove(1)}
            onRemove={onRemove}
            removeLabel="Remover pergunta"
          />
        </div>
        <IconButton label={open ? 'Recolher' : 'Expandir'} onClick={() => setOpen(!open)}>
          <ChevronDownIcon className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </IconButton>
      </div>
      {!open && issues.length > 0 && (
        <div className="px-3 pb-3">
          <Issues messages={issues} />
        </div>
      )}
      {open && (
        <div className="space-y-5 border-t border-zinc-100 px-4 py-4">
          <Issues messages={issues} />
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Field label="Pergunta (o cliente vê)">
              <input
                className={inputClass}
                value={field.label}
                disabled={disabled}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <Field label="Tipo">
              <select
                className={inputClass}
                value={field.kind}
                disabled={disabled || Boolean(published)}
                onChange={(e) => setKind(e.target.value as FieldKind)}
              >
                {Object.entries(KIND_LABELS).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="-mt-3 text-xs text-zinc-500">
            {KIND_HINTS[field.kind]}
            {published && ' Publicada: não muda de tipo.'}
          </p>
          <Field label="Ajuda (opcional)" hint="Texto curto abaixo da pergunta.">
            <input
              className={inputClass}
              value={field.help ?? ''}
              disabled={disabled}
              onChange={(e) => set({ help: e.target.value || undefined })}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg bg-zinc-50 px-3 py-2.5">
            <Check
              label="Obrigatória"
              checked={field.required}
              disabled={disabled}
              onChange={(required) => set({ required })}
            />
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-zinc-500">
              <span className="shrink-0">Identificador</span>
              <input
                className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 font-mono text-xs text-zinc-700 focus:border-brand-500 focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-500"
                value={field.id}
                aria-label="Identificador interno"
                title={
                  published
                    ? 'Travado: as respostas guardadas pelos agentes usam este identificador.'
                    : 'Nasce da pergunta.'
                }
                disabled={disabled || Boolean(published)}
                onChange={(e) => setId(e.target.value.trim())}
              />
              <span className="hidden shrink-0 lg:inline">
                {field.kind === 'BITRIX_SPA' ? 'na ação:' : 'no texto:'}{' '}
                <Code>{`{{${field.id}}}`}</Code>
              </span>
            </div>
          </div>
          <KindSettings field={field} ctx={ctx} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function KindSettings({
  field,
  ctx,
  onChange,
}: {
  field: FunctionField;
  ctx: FieldContext;
  onChange: (field: FunctionField, rename?: Rename) => void;
}) {
  const disabled = ctx.disabled;
  switch (field.kind) {
    case 'TEXT':
      return (
        <div>
          <Label>Resposta</Label>
          <div className="flex flex-wrap items-end gap-4">
            <NumberInput
              label="Máximo de caracteres"
              value={field.maxLength}
              min={1}
              disabled={disabled}
              onChange={(maxLength) => onChange({ ...field, maxLength })}
            />
            <Field label="Exemplo (placeholder)">
              <input
                className={`${inputClass} w-72`}
                value={field.placeholder ?? ''}
                disabled={disabled}
                onChange={(e) => onChange({ ...field, placeholder: e.target.value || undefined })}
              />
            </Field>
            <div className="pb-2.5">
              <Check
                label="Várias linhas"
                checked={field.multiline}
                disabled={disabled}
                onChange={(multiline) => onChange({ ...field, multiline })}
              />
            </div>
          </div>
        </div>
      );
    case 'TEXT_LIST':
      return (
        <div>
          <Label>Itens</Label>
          <div className="flex flex-wrap items-end gap-4">
            <NumberInput
              label="Mínimo de itens"
              value={field.minItems}
              min={0}
              disabled={disabled}
              onChange={(minItems) => onChange({ ...field, minItems })}
            />
            <NumberInput
              label="Máximo de itens"
              value={field.maxItems}
              min={1}
              disabled={disabled}
              onChange={(maxItems) => onChange({ ...field, maxItems })}
            />
            <NumberInput
              label="Caracteres por item"
              value={field.itemMaxLength}
              min={1}
              disabled={disabled}
              onChange={(itemMaxLength) => onChange({ ...field, itemMaxLength })}
            />
            <Field label="Exemplo (placeholder)">
              <input
                className={`${inputClass} w-64`}
                value={field.placeholder ?? ''}
                disabled={disabled}
                onChange={(e) => onChange({ ...field, placeholder: e.target.value || undefined })}
              />
            </Field>
          </div>
        </div>
      );
    case 'URL':
      return (
        <NumberInput
          label="Máximo de caracteres"
          value={field.maxLength}
          min={10}
          disabled={disabled}
          onChange={(maxLength) => onChange({ ...field, maxLength })}
        />
      );
    case 'INTEGER':
      return (
        <div className="flex gap-4">
          <NumberInput
            label="Mínimo"
            value={field.min}
            disabled={disabled}
            onChange={(min) => onChange({ ...field, min })}
          />
          <NumberInput
            label="Máximo"
            value={field.max}
            disabled={disabled}
            onChange={(max) => onChange({ ...field, max })}
          />
        </div>
      );
    case 'BITRIX_USER': {
      // Número ou lista nas respostas guardadas: travado depois de publicado (D15).
      const locked = ctx.published[field.id] !== undefined;
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={field.multiple}
              disabled={disabled || locked}
              onChange={(e) => onChange({ ...field, multiple: e.target.checked })}
            />
            Permitir vários usuários (as ações usam um de cada vez, em rodízio)
            {locked && <span className="text-xs text-zinc-500">· publicado: não muda</span>}
          </label>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            O cliente escolhe no Bitrix24. Use nas ações (responsável, atendente).
          </p>
        </div>
      );
    }
    case 'BITRIX_STAGE':
      return (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          O cliente escolhe no Bitrix24. Use nas ações de negócio (funil e etapa).
        </p>
      );
    case 'BITRIX_OPENLINE':
      return (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          O cliente escolhe um canal aberto do portal. Use em “Transferir para atendente”, destino
          Canal aberto.
        </p>
      );
    case 'AGENT':
      return (
        <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
          O cliente escolhe outro agente do portal. Use numa transferência entre agentes (aba
          Ações).
        </p>
      );
    case 'BITRIX_SPA':
      return <SpaSettings field={field} ctx={ctx} onChange={onChange} />;
    case 'CHOICE':
    case 'MULTI_CHOICE':
      return <OptionsEditor field={field} ctx={ctx} onChange={onChange} />;
    case 'KNOWLEDGE':
      return <KnowledgeSettings field={field} ctx={ctx} onChange={onChange} />;
  }
}

const TONES = {
  '': 'Não muda',
  FORMAL: 'Formal',
  NORMAL: 'Cordial',
  RELAXED: 'Descontraído',
};
const SWITCHES = [
  ['enabledEmoji', 'Emojis'],
  ['enabledHumanTransfer', 'Transferência para atendente'],
  ['limitSubjects', 'Só assuntos do negócio'],
] as const;

/** Efeitos ligados numa opção, em palavras (resumo do grupo recolhido). */
function effectSummary(option: FunctionOption): string[] {
  const parts: string[] = [];
  const tone = option.effects?.communicationType;
  if (tone) parts.push(`tom ${TONES[tone].toLowerCase()}`);
  for (const [key, label] of SWITCHES) {
    const value = option.effects?.settings?.[key];
    if (value !== undefined) parts.push(`${value ? 'liga' : 'desliga'} ${label.toLowerCase()}`);
  }
  return parts;
}

function OptionsEditor({
  field,
  ctx,
  onChange,
}: {
  field: Extract<FunctionField, { kind: 'CHOICE' | 'MULTI_CHOICE' }>;
  ctx: FieldContext;
  onChange: (field: FunctionField, rename?: Rename) => void;
}) {
  const disabled = ctx.disabled;
  const publishedValues = ctx.published[field.id]?.options ?? [];
  const setOptions = (options: FunctionOption[], rename?: Rename) =>
    onChange({ ...field, options }, rename);

  function setOption(index: number, option: FunctionOption, rename?: Rename) {
    setOptions(
      field.options.map((o, i) => (i === index ? option : o)),
      rename,
    );
  }

  /** Rótulo novo: valor automático (não publicado) acompanha o rótulo. */
  function setOptionLabel(index: number, label: string) {
    const option = field.options[index]!;
    const auto = !publishedValues.includes(option.value) && option.value === slug(option.label);
    if (!auto) return setOption(index, { ...option, label });
    const others = field.options.filter((_, i) => i !== index).map((o) => o.value);
    const value = uniqueId(slug(label), new Set(others));
    setOption(
      index,
      { ...option, label, value },
      value !== option.value
        ? { kind: 'option', fieldId: field.id, from: option.value, to: value }
        : undefined,
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Label
          hint={`O texto da opção ${field.kind === 'CHOICE' ? 'escolhida' : 'marcada'} entra no lugar de {{${field.id}}} e precisa fazer sentido sozinho.`}
        >
          Opções ({field.options.length})
        </Label>
        {field.kind === 'MULTI_CHOICE' && (
          <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-500">
            Juntar marcadas com
            <Segmented
              label="Como juntar os trechos marcados"
              disabled={disabled}
              value={field.separator === ', ' ? 'comma' : 'blank'}
              options={[
                { value: 'blank', label: 'Linha em branco' },
                { value: 'comma', label: 'Vírgula' },
              ]}
              onChange={(value) =>
                onChange({ ...field, separator: value === 'comma' ? ', ' : '\n\n' })
              }
            />
          </div>
        )}
      </div>
      {field.options.map((option, index) => {
        const optionIssues = ctx.issues(field.id, option.value);
        const effects = effectSummary(option);
        return (
          <div
            key={index}
            className={`rounded-xl border bg-zinc-50/70 p-3 ${optionIssues.length ? 'border-red-300' : 'border-zinc-200'}`}
          >
            <div className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-zinc-500 ring-1 ring-zinc-200">
                {String.fromCharCode(65 + (index % 26))}
              </span>
              <input
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 focus:border-brand-500 focus:ring-3 focus:ring-brand-100 focus:outline-none disabled:bg-zinc-50"
                value={option.label}
                aria-label="Rótulo da opção (o cliente vê)"
                placeholder="Rótulo da opção"
                disabled={disabled}
                onChange={(e) => setOptionLabel(index, e.target.value)}
              />
              <span
                className="hidden sm:inline"
                title="Identificador interno da opção: as condições das ações usam este valor."
              >
                <Code>
                  {option.value}
                  {publishedValues.includes(option.value) && ' · publicada'}
                </Code>
              </span>
              <ItemActions
                disabled={disabled}
                onUp={() => setOptions(moveItem(field.options, index, -1))}
                onDown={() => setOptions(moveItem(field.options, index, 1))}
                onRemove={() => setOptions(field.options.filter((_, i) => i !== index))}
                removeLabel="Remover opção"
              />
            </div>
            <div className="mt-3 pl-8">
              <MarkerText
                value={option.snippet}
                markers={ctx.markers}
                disabled={disabled}
                placeholder="Texto que entra no agente com esta opção…"
                onChange={(snippet) => setOption(index, { ...option, snippet })}
              />
              <div className="mt-2 space-y-2">
                <Disclosure
                  initialOpen={effects.length > 0}
                  summary={
                    <>
                      Efeitos no agente
                      <span className="ml-1 font-normal text-zinc-500">
                        {effects.length > 0 ? `· ${effects.join(' · ')}` : '(opcional)'}
                      </span>
                    </>
                  }
                >
                  <div className="divide-y divide-zinc-100">
                    <div className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0">
                      <span className="text-sm text-zinc-700">Tom</span>
                      <Segmented
                        label="Efeito no tom"
                        disabled={disabled}
                        value={option.effects?.communicationType ?? ''}
                        options={Object.entries(TONES).map(([value, label]) => ({
                          value: value as keyof typeof TONES,
                          label,
                        }))}
                        onChange={(value) =>
                          setOption(index, {
                            ...option,
                            effects: {
                              ...option.effects,
                              communicationType: (value || undefined) as
                                'FORMAL' | 'NORMAL' | 'RELAXED' | undefined,
                            },
                          })
                        }
                      />
                    </div>
                    {SWITCHES.map(([key, label]) => (
                      <div
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 last:pb-0"
                      >
                        <span className="text-sm text-zinc-700">{label}</span>
                        <TriState
                          label={label}
                          disabled={disabled}
                          unset="Não muda"
                          on="Liga"
                          off="Desliga"
                          value={option.effects?.settings?.[key]}
                          onChange={(value) => {
                            const settings = { ...option.effects?.settings };
                            if (value === undefined) delete settings[key];
                            else settings[key] = value;
                            setOption(index, {
                              ...option,
                              effects: { ...option.effects, settings },
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </Disclosure>
                <Disclosure
                  initialOpen={(option.dependents?.length ?? 0) > 0}
                  summary={
                    <>
                      Perguntas que só aparecem com esta opção
                      <span className="ml-1 font-normal text-zinc-500">
                        {option.dependents?.length ? `(${option.dependents.length})` : '(opcional)'}
                      </span>
                    </>
                  }
                >
                  <FieldList
                    fields={option.dependents ?? []}
                    ctx={ctx}
                    addLabel="Adicionar pergunta dependente"
                    onChange={(dependents, rename) =>
                      setOption(
                        index,
                        { ...option, dependents: dependents.length ? dependents : undefined },
                        rename,
                      )
                    }
                  />
                </Disclosure>
              </div>
              {optionIssues.length > 0 && (
                <div className="mt-2">
                  <Issues messages={optionIssues} />
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!disabled && (
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          onClick={() =>
            setOptions([
              ...field.options,
              newOption(
                `Opção ${field.options.length + 1}`,
                field.options.map((o) => o.value),
              ),
            ])
          }
        >
          <PlusIcon className="size-4" /> Adicionar opção
        </button>
      )}
    </div>
  );
}

/**
 * Valores que a ação "Criar item de SPA" grava. O cliente liga cada um a um campo do SPA; com
 * opções (ex.: LOW, HIGH), também liga cada opção a um item quando o campo é lista.
 */
function SpaSettings({
  field,
  ctx,
  onChange,
}: {
  field: Extract<FunctionField, { kind: 'BITRIX_SPA' }>;
  ctx: FieldContext;
  onChange: (field: FunctionField) => void;
}) {
  const disabled = ctx.disabled;
  const setValue = (index: number, patch: Partial<FunctionSpaValue>) =>
    onChange({
      ...field,
      values: field.values.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    });
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
        O cliente escolhe o SPA, o funil, a etapa e em qual campo vai cada valor. Preencha os
        valores na ação “Criar item de SPA” (aba Ações).
      </p>
      <div>
        <Label>Valores gravados no item</Label>
        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {field.values.map((value, index) => (
            <div key={index} className="space-y-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="w-48 rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-zinc-50"
                  value={value.label}
                  aria-label="Nome do valor"
                  disabled={disabled}
                  onChange={(e) => {
                    const auto = value.id === slug(value.label);
                    setValue(index, {
                      label: e.target.value,
                      ...(auto ? { id: slug(e.target.value) } : {}),
                    });
                  }}
                />
                <Code>{value.id}</Code>
                <span className="flex-1" />
                <Check
                  label="Obrigatório"
                  checked={value.required}
                  disabled={disabled}
                  onChange={(required) => setValue(index, { required })}
                />
                {field.values.length > 1 && (
                  <ItemActions
                    disabled={disabled}
                    removeLabel="Remover valor"
                    onRemove={() =>
                      onChange({ ...field, values: field.values.filter((_, i) => i !== index) })
                    }
                  />
                )}
              </div>
              <SpaOptionsInput
                label={value.label}
                options={value.options}
                disabled={disabled}
                onChange={(options) => setValue(index, { options })}
              />
            </div>
          ))}
        </div>
        {!disabled && field.values.length < 20 && (
          <button
            type="button"
            className={`${buttonClass('ghost', 'sm')} mt-1`}
            onClick={() =>
              onChange({
                ...field,
                values: [
                  ...field.values,
                  {
                    id: uniqueId('valor', new Set(field.values.map((v) => v.id))),
                    label: 'Valor',
                    required: false,
                  },
                ],
              })
            }
          >
            <PlusIcon className="size-4" /> Adicionar valor
          </button>
        )}
      </div>
    </div>
  );
}

/** Opções de um valor do SPA, digitadas com vírgula; a lista só é montada ao sair do campo. */
function SpaOptionsInput({
  label,
  options,
  disabled,
  onChange,
}: {
  label: string;
  options: string[] | undefined;
  disabled?: boolean;
  onChange: (options: string[] | undefined) => void;
}) {
  const joined = (options ?? []).join(', ');
  const [text, setText] = useState(joined);
  const [synced, setSynced] = useState(joined);
  // Mudou por fora (desfazer, JSON): mostra o novo valor.
  if (joined !== synced) {
    setSynced(joined);
    setText(joined);
  }
  return (
    <input
      className="w-full rounded-md border border-zinc-200 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none disabled:bg-zinc-50"
      value={text}
      aria-label={`Opções de ${label}`}
      placeholder="Opções, separadas por vírgula (ex.: LOW, NORMAL, HIGH, URGENT). Vazio: texto livre."
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const list = [
          ...new Set(
            text
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ];
        onChange(list.length ? list : undefined);
        setText(list.join(', '));
      }}
    />
  );
}

function KnowledgeSettings({
  field,
  ctx,
  onChange,
}: {
  field: Extract<FunctionField, { kind: 'KNOWLEDGE' }>;
  ctx: FieldContext;
  onChange: (field: FunctionField) => void;
}) {
  const disabled = ctx.disabled;
  const setSub = (index: number, patch: Partial<FunctionKnowledgeSubfield>) =>
    onChange({
      ...field,
      subfields: field.subfields.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  const length =
    field.format.replace(/\{\{\s*[a-z0-9_]+\s*\}\}/g, '').length +
    field.subfields.reduce((sum, sub) => sum + sub.maxLength, 0);
  return (
    <div className="space-y-4">
      <NumberInput
        label="Máximo de itens"
        value={field.maxItems}
        min={1}
        disabled={disabled}
        onChange={(maxItems) => onChange({ ...field, maxItems })}
      />
      <div>
        <Label>Campos de cada item</Label>
        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {field.subfields.map((sub, index) => (
            <div key={index} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <input
                className="w-44 rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-zinc-50"
                value={sub.label}
                aria-label="Nome do campo"
                disabled={disabled}
                onChange={(e) => {
                  const auto = sub.id === slug(sub.label);
                  setSub(index, {
                    label: e.target.value,
                    ...(auto ? { id: slug(e.target.value) } : {}),
                  });
                }}
              />
              <Code>{`{{${sub.id}}}`}</Code>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                até
                <input
                  type="number"
                  className="w-20 rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-zinc-50"
                  value={sub.maxLength}
                  min={1}
                  disabled={disabled}
                  onChange={(e) => setSub(index, { maxLength: Math.trunc(Number(e.target.value)) })}
                />
                caracteres
              </label>
              <span className="flex-1" />
              <Check
                label="Obrigatório"
                checked={sub.required}
                disabled={disabled}
                onChange={(required) => setSub(index, { required })}
              />
              <Check
                label="Várias linhas"
                checked={sub.multiline}
                disabled={disabled}
                onChange={(multiline) => setSub(index, { multiline })}
              />
              {field.subfields.length > 1 && (
                <ItemActions
                  disabled={disabled}
                  removeLabel="Remover campo"
                  onRemove={() =>
                    onChange({ ...field, subfields: field.subfields.filter((_, i) => i !== index) })
                  }
                />
              )}
            </div>
          ))}
        </div>
        {!disabled && field.subfields.length < 6 && (
          <button
            type="button"
            className={`${buttonClass('ghost', 'sm')} mt-1`}
            onClick={() =>
              onChange({
                ...field,
                subfields: [
                  ...field.subfields,
                  {
                    id: uniqueId('campo', new Set(field.subfields.map((s) => s.id))),
                    label: 'Campo',
                    required: false,
                    maxLength: 100,
                    multiline: false,
                  },
                ],
              })
            }
          >
            <PlusIcon className="size-4" /> Adicionar campo do item
          </button>
        )}
      </div>
      <div>
        <Label>Texto do treinamento de cada item</Label>
        <MarkerText
          value={field.format}
          rows={3}
          disabled={disabled}
          markers={field.subfields.map((sub) => ({ marker: sub.id, label: sub.label }))}
          onChange={(format) => onChange({ ...field, format })}
        />
        <p className={`mt-1 text-xs ${length > 1028 ? 'text-red-600' : 'text-zinc-500'}`}>
          Item no limite: até {length} de 1028 caracteres.
        </p>
      </div>
    </div>
  );
}
