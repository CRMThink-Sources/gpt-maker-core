'use client';

import type {
  FunctionField,
  FunctionKnowledgeSubfield,
  FunctionOption,
  MarkerOption,
} from '@gptmaker/contracts';
import { useState, type ReactNode } from 'react';
import { Badge, buttonClass } from '@/components/ui';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { useFocusCard } from './focus';
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

function Issues({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-red-600">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

function ItemButtons({
  onUp,
  onDown,
  onRemove,
  disabled,
  removeLabel = 'Remover',
}: {
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  disabled?: boolean;
  removeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={buttonClass('ghost', 'sm')}
        disabled={disabled}
        onClick={onUp}
        aria-label="Subir"
      >
        ↑
      </button>
      <button
        type="button"
        className={buttonClass('ghost', 'sm')}
        disabled={disabled}
        onClick={onDown}
        aria-label="Descer"
      >
        ↓
      </button>
      <button
        type="button"
        className={buttonClass('ghost-danger', 'sm')}
        disabled={disabled}
        onClick={onRemove}
      >
        {removeLabel}
      </button>
    </div>
  );
}

/** Grupo recolhível que lembra se foi aberto (não fecha sozinho quando o conteúdo muda). */
function Disclosure({
  summary,
  initialOpen,
  className = '',
  children,
}: {
  summary: ReactNode;
  initialOpen: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="mb-2 cursor-pointer text-xs font-medium text-zinc-600 select-none">
        {summary}
      </summary>
      {children}
    </details>
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
  const [adding, setAdding] = useState<FieldKind | ''>('');
  // A pergunta recém-criada já abre: o próximo passo é dar o rótulo.
  const [added, setAdded] = useState<number | null>(null);

  function add(kind: FieldKind) {
    const label = 'Nova pergunta';
    const id = uniqueId(makeId(ctx.prefix, label), ctx.takenIds);
    onChange([...fields, newField(kind, id, label)]);
    setAdded(fields.length);
    setAdding('');
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 && empty}
      {fields.map((field, index) => (
        <FieldCard
          // Chave por posição: o id muda enquanto o rótulo é digitado.
          key={index}
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
      {!ctx.disabled && (
        <div className="flex items-center gap-2">
          <select
            className={`${inputClass} mt-0 w-56`}
            value={adding}
            onChange={(e) => {
              const kind = e.target.value as FieldKind | '';
              if (kind) add(kind);
            }}
          >
            <option value="">{addLabel}…</option>
            {Object.entries(KIND_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function FieldCard({
  field,
  ctx,
  isNew,
  onChange,
  onMove,
  onRemove,
}: {
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
      className={`scroll-mt-4 rounded-lg border ${issues.length || optionIssues ? 'border-red-300' : 'border-zinc-200'} bg-white`}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="text-xs text-zinc-400">{open ? '▾' : '▸'}</span>
          <span className="truncate text-sm font-medium text-zinc-900">{field.label}</span>
          <Badge tone="zinc">{KIND_LABELS[field.kind]}</Badge>
          {published && <Badge tone="amber">publicado</Badge>}
          {!field.required && <span className="text-xs text-zinc-500">opcional</span>}
          {(field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE') && !open && (
            <span className="truncate text-xs text-zinc-500">
              {field.options.map((option) => option.label).join(' · ')}
            </span>
          )}
        </button>
        <ItemButtons
          disabled={disabled}
          onUp={() => onMove(-1)}
          onDown={() => onMove(1)}
          onRemove={onRemove}
        />
      </div>
      {!open && (
        <div className="px-4 pb-2">
          <Issues messages={issues} />
        </div>
      )}
      {open && (
        <div className="space-y-4 border-t border-zinc-100 px-4 py-4">
          <Issues messages={issues} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pergunta (o cliente vê)">
              <input
                className={inputClass}
                value={field.label}
                disabled={disabled}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <Field
              label="Tipo"
              hint={
                published
                  ? `${KIND_HINTS[field.kind]} Publicado: não muda de tipo.`
                  : KIND_HINTS[field.kind]
              }
            >
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
          <Field label="Ajuda (opcional)" hint="Texto curto abaixo da pergunta.">
            <input
              className={inputClass}
              value={field.help ?? ''}
              disabled={disabled}
              onChange={(e) => set({ help: e.target.value || undefined })}
            />
          </Field>
          <div className="flex flex-wrap items-end gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={field.required}
                disabled={disabled}
                onChange={(e) => set({ required: e.target.checked })}
              />
              Obrigatório
            </label>
            <Field
              label="Identificador interno"
              hint={
                published
                  ? 'Travado: as respostas guardadas pelos agentes usam este identificador.'
                  : `Nasce da pergunta. No texto, entra como {{${field.id}}}.`
              }
            >
              <input
                className={`${inputClass} w-72 font-mono text-xs`}
                value={field.id}
                disabled={disabled || Boolean(published)}
                onChange={(e) => setId(e.target.value.trim())}
              />
            </Field>
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
        <div className="flex flex-wrap items-end gap-4">
          <NumberInput
            label="Máximo de caracteres"
            value={field.maxLength}
            min={1}
            disabled={disabled}
            onChange={(maxLength) => onChange({ ...field, maxLength })}
          />
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={field.multiline}
              disabled={disabled}
              onChange={(e) => onChange({ ...field, multiline: e.target.checked })}
            />
            Várias linhas
          </label>
          <Field label="Exemplo (placeholder)">
            <input
              className={`${inputClass} w-72`}
              value={field.placeholder ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ ...field, placeholder: e.target.value || undefined })}
            />
          </Field>
        </div>
      );
    case 'TEXT_LIST':
      return (
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
    case 'BITRIX_USER':
    case 'BITRIX_STAGE':
      return (
        <p className="text-xs text-zinc-500">
          O cliente escolhe no Bitrix24. Use nas ações (responsável, funil e etapa).
        </p>
      );
    case 'CHOICE':
    case 'MULTI_CHOICE':
      return <OptionsEditor field={field} ctx={ctx} onChange={onChange} />;
    case 'KNOWLEDGE':
      return <KnowledgeSettings field={field} ctx={ctx} onChange={onChange} />;
  }
}

const TONES = {
  '': 'Não muda o tom',
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
      {field.kind === 'MULTI_CHOICE' && (
        <Field label="Como juntar os trechos marcados">
          <select
            className={`${inputClass} w-72`}
            value={field.separator === ', ' ? ', ' : '\n\n'}
            disabled={disabled}
            onChange={(e) => onChange({ ...field, separator: e.target.value })}
          >
            <option value={'\n\n'}>Linha em branco (seções)</option>
            <option value=", ">Vírgula (itens de uma lista)</option>
          </select>
        </Field>
      )}
      <p className="text-sm font-medium text-zinc-800">Opções</p>
      {field.options.map((option, index) => {
        const optionIssues = ctx.issues(field.id, option.value);
        return (
          <div
            key={index}
            className={`rounded-lg border p-3 ${optionIssues.length ? 'border-red-300' : 'border-zinc-200'} bg-zinc-50/50`}
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Rótulo (o cliente vê)">
                <input
                  className={`${inputClass} w-72`}
                  value={option.label}
                  disabled={disabled}
                  onChange={(e) => setOptionLabel(index, e.target.value)}
                />
              </Field>
              <span
                className="pb-2 font-mono text-xs text-zinc-500"
                title="Identificador interno da opção: as condições das ações usam este valor."
              >
                {option.value}
                {publishedValues.includes(option.value) && ' · publicado'}
              </span>
              <span className="flex-1" />
              <ItemButtons
                disabled={disabled}
                onUp={() => setOptions(moveItem(field.options, index, -1))}
                onDown={() => setOptions(moveItem(field.options, index, 1))}
                onRemove={() => setOptions(field.options.filter((_, i) => i !== index))}
              />
            </div>
            <div className="mt-3">
              <p className="text-sm font-medium text-zinc-800">
                {field.kind === 'CHOICE'
                  ? 'Texto que entra no agente quando o cliente escolhe esta opção'
                  : 'Texto que entra no agente quando o cliente marca esta opção'}
              </p>
              <p className="text-xs text-zinc-500">
                Entra no lugar de {`{{${field.id}}}`}. Precisa fazer sentido sozinho.
              </p>
              <MarkerText
                value={option.snippet}
                markers={ctx.markers}
                disabled={disabled}
                onChange={(snippet) => setOption(index, { ...option, snippet })}
              />
            </div>
            <Disclosure
              className="mt-3"
              initialOpen={effectSummary(option).length > 0}
              summary={
                <>
                  Efeitos no agente (opcional)
                  {effectSummary(option).length > 0 && (
                    <span className="ml-1 font-normal text-zinc-500">
                      · {effectSummary(option).join(' · ')}
                    </span>
                  )}
                </>
              }
            >
              <div className="mt-2 flex flex-wrap items-end gap-3 text-sm">
                <Field label="Efeito no tom">
                  <select
                    className={`${inputClass} w-44`}
                    value={option.effects?.communicationType ?? ''}
                    disabled={disabled}
                    onChange={(e) => {
                      const communicationType = (e.target.value || undefined) as
                        'FORMAL' | 'NORMAL' | 'RELAXED' | undefined;
                      setOption(index, {
                        ...option,
                        effects: { ...option.effects, communicationType },
                      });
                    }}
                  >
                    {Object.entries(TONES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                {SWITCHES.map(([key, label]) => {
                  const current = option.effects?.settings?.[key];
                  return (
                    <Field key={key} label={label}>
                      <select
                        className={`${inputClass} w-36`}
                        value={current === undefined ? '' : String(current)}
                        disabled={disabled}
                        onChange={(e) => {
                          const settings = { ...option.effects?.settings };
                          if (e.target.value === '') delete settings[key];
                          else settings[key] = e.target.value === 'true';
                          setOption(index, { ...option, effects: { ...option.effects, settings } });
                        }}
                      >
                        <option value="">Não muda</option>
                        <option value="true">Liga</option>
                        <option value="false">Desliga</option>
                      </select>
                    </Field>
                  );
                })}
              </div>
            </Disclosure>
            <Disclosure
              className="mt-3 border-l-2 border-brand-100 pl-3"
              initialOpen={(option.dependents?.length ?? 0) > 0}
              summary={
                <>
                  Perguntas que só aparecem com esta opção
                  {option.dependents?.length ? ` (${option.dependents.length})` : ''}
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
            <Issues messages={optionIssues} />
          </div>
        );
      })}
      {!disabled && (
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
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
          Adicionar opção
        </button>
      )}
    </div>
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
    <div className="space-y-3">
      <NumberInput
        label="Máximo de itens"
        value={field.maxItems}
        min={1}
        disabled={disabled}
        onChange={(maxItems) => onChange({ ...field, maxItems })}
      />
      <p className="text-sm font-medium text-zinc-800">Campos de cada item</p>
      {field.subfields.map((sub, index) => (
        <div key={index} className="flex flex-wrap items-end gap-3">
          <Field label="Nome">
            <input
              className={`${inputClass} w-48`}
              value={sub.label}
              disabled={disabled}
              onChange={(e) => {
                const auto = sub.id === slug(sub.label);
                setSub(index, {
                  label: e.target.value,
                  ...(auto ? { id: slug(e.target.value) } : {}),
                });
              }}
            />
          </Field>
          <span className="pb-2 font-mono text-xs text-zinc-500">{`{{${sub.id}}}`}</span>
          <NumberInput
            label="Caracteres"
            value={sub.maxLength}
            min={1}
            disabled={disabled}
            onChange={(maxLength) => setSub(index, { maxLength })}
          />
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={sub.required}
              disabled={disabled}
              onChange={(e) => setSub(index, { required: e.target.checked })}
            />
            Obrigatório
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={sub.multiline}
              disabled={disabled}
              onChange={(e) => setSub(index, { multiline: e.target.checked })}
            />
            Várias linhas
          </label>
          {field.subfields.length > 1 && !disabled && (
            <button
              type="button"
              className={buttonClass('ghost-danger', 'sm')}
              onClick={() =>
                onChange({ ...field, subfields: field.subfields.filter((_, i) => i !== index) })
              }
            >
              Remover
            </button>
          )}
        </div>
      ))}
      {!disabled && field.subfields.length < 6 && (
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
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
          Adicionar campo do item
        </button>
      )}
      <div>
        <p className="text-sm font-medium text-zinc-800">Texto do treinamento de cada item</p>
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
