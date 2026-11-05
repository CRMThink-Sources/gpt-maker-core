'use client';

import type { BitrixSpaValue, FunctionSpaValue } from '@gptmaker/contracts';
import { useId, useState } from 'react';
import { buttonClass } from '@/components/ui';
import { bx24SelectUsers, insideBitrix } from '@/lib/bx24';
import {
  type SpaField,
  suggestListLinks,
  useDealPipelines,
  useDealStages,
  useOpenLines,
  useSpaCategories,
  useSpaFields,
  useSpaStages,
  useSpaTypes,
} from '@/lib/crm-fields';
import { Field, inputClass } from './agent-fields';

/** Seletores do Bitrix24 usados nos gatilhos, nas intenções e no formulário da função. */

const STAGE_SUFFIX: Record<string, string> = { success: ' (ganho)', failure: ' (perdido)' };

/**
 * Funil e etapa do negócio novo, escolhidos nas listas do portal; trocar o funil limpa a etapa
 * (a de outro funil seria inválida). Sem as listas (fora do Bitrix, sem permissão), digitados.
 */
export function PipelineStageFields({
  categoryId,
  stageId,
  disabled,
  onChange,
}: {
  categoryId: number;
  stageId: string;
  disabled?: boolean;
  onChange: (next: { categoryId?: number; stageId?: string }) => void;
}) {
  const pipelines = useDealPipelines();
  const stages = useDealStages(pipelines.data ? categoryId : null);

  if (!pipelines.data && pipelines.failed) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Funil (CATEGORY_ID)" hint="0 é o funil geral. Vale só para negócio novo.">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={categoryId}
            disabled={disabled}
            onChange={(e) => onChange({ categoryId: Number(e.target.value) })}
          />
        </Field>
        <Field label="Etapa (STAGE_ID)" hint="Ex.: NEW, ou C3:NEW em outro funil.">
          <input
            className={`${inputClass} font-mono text-xs`}
            value={stageId}
            disabled={disabled}
            onChange={(e) => onChange({ stageId: e.target.value })}
          />
        </Field>
      </div>
    );
  }

  const stageMissing =
    stages.data && stageId !== '' && !stages.data.some((stage) => stage.id === stageId);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Funil" hint="Para negócio novo. Um negócio existente fica no funil dele.">
        <select
          className={inputClass}
          value={pipelines.data ? String(categoryId) : ''}
          disabled={disabled || !pipelines.data}
          onChange={(e) => onChange({ categoryId: Number(e.target.value), stageId: '' })}
        >
          {!pipelines.data && <option value="">Carregando funis…</option>}
          {pipelines.data?.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Etapa"
        hint={
          stageMissing
            ? `A etapa ${stageId} não existe neste funil; escolha outra.`
            : 'Negócio existente também vai para esta etapa.'
        }
      >
        {!pipelines.data || !stages.failed ? (
          <select
            className={inputClass}
            value={stages.data?.some((stage) => stage.id === stageId) ? stageId : ''}
            disabled={disabled || !stages.data}
            onChange={(e) => onChange({ stageId: e.target.value })}
          >
            <option value="">{stages.data ? 'Escolha a etapa…' : 'Carregando etapas…'}</option>
            {stages.data?.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
                {stage.semantics ? (STAGE_SUFFIX[stage.semantics] ?? '') : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={`${inputClass} font-mono text-xs`}
            value={stageId}
            disabled={disabled}
            onChange={(e) => onChange({ stageId: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

export function ResponsiblePicker({
  value,
  onChange,
  disabled,
  label = 'Responsável',
}: {
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const canPick = insideBitrix();
  return (
    <Field label={label} hint={canPick ? undefined : 'Informe o id do usuário no Bitrix24.'}>
      <div className="mt-1.5 flex items-center gap-2">
        {canPick ? (
          <>
            <span className="text-sm text-zinc-700">
              {value > 0 ? (name ?? `Usuário #${value}`) : 'Nenhum escolhido'}
            </span>
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={disabled}
              onClick={async () => {
                const [user] = await bx24SelectUsers();
                if (user) {
                  onChange(Number(user.id));
                  setName(user.name);
                }
              }}
            >
              Escolher
            </button>
          </>
        ) : (
          <input
            type="number"
            min={1}
            className={`${inputClass} mt-0 w-40`}
            value={value || ''}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        )}
      </div>
    </Field>
  );
}

/**
 * Vários usuários do Bitrix24 (design D15): as ações vão para um de cada vez, em rodízio. Fora do
 * Bitrix24, os ids separados por vírgula.
 */
export function UsersPicker({
  value,
  onChange,
  disabled,
  label = 'Usuários',
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [names, setNames] = useState<Record<number, string>>({});
  const [text, setText] = useState(value.join(', '));
  if (!insideBitrix()) {
    return (
      <Field
        label={label}
        hint="Ids dos usuários no Bitrix24, separados por vírgula. Recebem um de cada vez."
      >
        <input
          className={`${inputClass} mt-1.5`}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            const ids = e.target.value
              .split(/[\s,;]+/)
              .map(Number)
              .filter((id) => Number.isInteger(id) && id > 0);
            onChange([...new Set(ids)]);
          }}
        />
      </Field>
    );
  }
  return (
    <Field label={label} hint="Recebem um de cada vez, em rodízio.">
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {value.length === 0 && <span className="text-sm text-zinc-700">Nenhum escolhido</span>}
        {value.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2.5 text-xs text-zinc-700"
          >
            {names[id] ?? `Usuário #${id}`}
            {!disabled && (
              <button
                type="button"
                aria-label={`Tirar ${names[id] ?? id}`}
                className="rounded-full px-1 hover:bg-zinc-200"
                onClick={() => onChange(value.filter((item) => item !== id))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
          disabled={disabled}
          onClick={async () => {
            const users = await bx24SelectUsers();
            if (!users.length) return;
            setNames((current) => ({
              ...current,
              ...Object.fromEntries(users.map((user) => [Number(user.id), user.name])),
            }));
            onChange(
              [...new Set([...value, ...users.map((user) => Number(user.id))])].slice(0, 20),
            );
          }}
        >
          Adicionar
        </button>
      </div>
    </Field>
  );
}

/** Canal aberto do Bitrix24 que recebe a conversa (design D16). Sem a lista, o id digitado. */
export function OpenLinePicker({
  value,
  onChange,
  disabled,
  label = 'Canal aberto do Bitrix24',
}: {
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const lines = useOpenLines();
  if (!lines.data) {
    return (
      <Field
        label={label}
        hint={lines.failed ? 'Informe o id do canal aberto no Bitrix24.' : undefined}
      >
        <input
          type="number"
          min={1}
          className={`${inputClass} mt-1.5 w-40`}
          value={value || ''}
          disabled={disabled || !lines.failed}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </Field>
    );
  }
  return (
    <Field label={label}>
      <select
        className={`${inputClass} mt-1.5`}
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value="">Escolha um canal</option>
        {lines.data.map((line) => (
          <option key={line.id} value={line.id}>
            {line.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Outro agente do portal, destino de uma transferência entre agentes (design D17). */
export function AgentPicker({
  value,
  agents,
  onChange,
  disabled,
  label = 'Agente',
}: {
  value: string;
  agents: Array<{ id: string; name: string }>;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Field
      label={label}
      hint={agents.length === 0 ? 'Crie outro agente para poder transferir para ele.' : undefined}
    >
      <select
        className={`${inputClass} mt-1.5`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Escolha um agente</option>
        {/* Escolhido antes e removido depois: aparece até o cliente trocar (D17). */}
        {value && !agents.some((item) => item.id === value) && (
          <option value={value}>Agente removido: escolha outro</option>
        )}
        {agents.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Processo inteligente (SPA), funil, etapa e o campo do SPA de cada valor declarado no template
 * (change agent-function-spa-item). Num valor com opções ligado a um campo lista, cada opção é
 * ligada a um item, já sugerido pelo nome. Trocar o SPA limpa o resto. Sem as listas do portal,
 * ids e códigos digitados.
 */
export function SpaFields({
  values,
  value,
  onChange,
  disabled,
  issueOf,
}: {
  values: readonly FunctionSpaValue[];
  value: BitrixSpaValue | undefined;
  onChange: (next: BitrixSpaValue | undefined) => void;
  disabled?: boolean;
  /** Mensagem de problema de um valor (`campo.valor`). */
  issueOf?: (valueId: string) => string | undefined;
}) {
  const entityTypeId = value?.entityTypeId ?? null;
  const types = useSpaTypes();
  const categories = useSpaCategories(entityTypeId);
  const categoryId = value?.categoryId ?? categories.data?.[0]?.id ?? null;
  const stages = useSpaStages(entityTypeId, categoryId);
  const fields = useSpaFields(entityTypeId);
  const typed = types.failed && !types.data;

  const update = (patch: Partial<BitrixSpaValue>) =>
    entityTypeId && onChange({ ...value!, ...patch });
  const setField = (declared: FunctionSpaValue, code: string) => {
    const nextFields = { ...value!.fields };
    const nextLists = { ...value!.lists };
    delete nextLists[declared.id];
    if (code) {
      nextFields[declared.id] = code;
      const field = fields.data?.find((item) => item.code === code);
      if (declared.options && field?.options) {
        const links = suggestListLinks(declared.options, field.options);
        if (Object.keys(links).length) nextLists[declared.id] = links;
      }
    } else {
      delete nextFields[declared.id];
    }
    update({ fields: nextFields, lists: nextLists });
  };
  const setLink = (declared: FunctionSpaValue, option: string, itemId: number) => {
    const links = { ...value!.lists?.[declared.id] };
    if (itemId > 0) links[option] = itemId;
    else delete links[option];
    update({ lists: { ...value!.lists, [declared.id]: links } });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Processo inteligente">
          {typed ? (
            <input
              type="number"
              min={1}
              className={inputClass}
              value={entityTypeId ?? ''}
              disabled={disabled}
              onChange={(e) =>
                onChange(
                  Number(e.target.value) > 0
                    ? { entityTypeId: Number(e.target.value), fields: {} }
                    : undefined,
                )
              }
            />
          ) : (
            <SearchSelect
              options={
                types.data?.map((type) => ({
                  value: String(type.entityTypeId),
                  label: type.title,
                })) ?? null
              }
              value={entityTypeId ? String(entityTypeId) : ''}
              placeholder={types.data ? 'Digite para buscar o SPA…' : 'Carregando…'}
              disabled={disabled}
              onChange={(next) =>
                // O mesmo SPA de novo não limpa o mapeamento.
                Number(next) !== entityTypeId &&
                onChange({ entityTypeId: Number(next), fields: {} })
              }
            />
          )}
        </Field>
        <Field label="Funil">
          {typed || (categories.failed && !categories.data) ? (
            <input
              type="number"
              min={0}
              className={inputClass}
              value={value?.categoryId ?? ''}
              disabled={disabled || !entityTypeId}
              onChange={(e) => update({ categoryId: Number(e.target.value), stageId: undefined })}
            />
          ) : (
            <select
              className={inputClass}
              value={categoryId ?? ''}
              disabled={disabled || !categories.data}
              onChange={(e) => update({ categoryId: Number(e.target.value), stageId: undefined })}
            >
              {!categories.data && <option value="">{entityTypeId ? 'Carregando…' : '—'}</option>}
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Etapa inicial">
          {typed || (stages.failed && !stages.data) ? (
            <input
              className={`${inputClass} font-mono text-xs`}
              value={value?.stageId ?? ''}
              placeholder="DT1204_180:NEW"
              disabled={disabled || !entityTypeId}
              onChange={(e) => update({ stageId: e.target.value || undefined })}
            />
          ) : (
            <select
              className={inputClass}
              value={value?.stageId ?? ''}
              disabled={disabled || !stages.data}
              onChange={(e) =>
                update({
                  ...(categoryId !== null ? { categoryId } : {}),
                  stageId: e.target.value || undefined,
                })
              }
            >
              <option value="">{stages.data ? 'A primeira do funil' : '—'}</option>
              {stages.data?.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                  {stage.semantics ? (STAGE_SUFFIX[stage.semantics] ?? '') : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {entityTypeId && (
        <div className="rounded-lg border border-zinc-200">
          <p className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">
            Em qual campo do SPA vai cada informação
          </p>
          <ul className="divide-y divide-zinc-100">
            {values.map((declared) => {
              const code = value?.fields[declared.id] ?? '';
              const field = fields.data?.find((item) => item.code === code);
              const issue = issueOf?.(declared.id);
              return (
                <li key={declared.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-2">
                  <div className="text-sm">
                    <span className="font-medium text-zinc-800">{declared.label}</span>
                    {!declared.required && (
                      <span className="ml-1.5 text-xs text-zinc-400">(opcional)</span>
                    )}
                    {declared.help && (
                      <span className="mt-0.5 block text-xs text-zinc-500">{declared.help}</span>
                    )}
                  </div>
                  <div>
                    <SpaFieldSelect
                      label={declared.label}
                      fields={fields.data}
                      typed={typed || (fields.failed && !fields.data)}
                      code={code}
                      required={declared.required}
                      disabled={disabled}
                      onChange={(next) => setField(declared, next)}
                    />
                    {issue && <span className="mt-1 block text-xs text-red-600">{issue}</span>}
                    {declared.options && field?.options && (
                      <div className="mt-2 space-y-1.5">
                        {declared.options.map((option) => (
                          <label key={option} className="flex items-center gap-2 text-xs">
                            <span className="w-20 shrink-0 font-mono text-zinc-600">{option}</span>
                            <select
                              aria-label={`${declared.label}: ${option}`}
                              className={`${inputClass} mt-0 py-1 text-xs`}
                              value={value?.lists?.[declared.id]?.[option] ?? ''}
                              disabled={disabled}
                              onChange={(e) => setLink(declared, option, Number(e.target.value))}
                            >
                              <option value="">Pelo nome do item</option>
                              {field.options!.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function SpaFieldSelect({
  label,
  fields,
  typed,
  code,
  required,
  disabled,
  onChange,
}: {
  label: string;
  fields: SpaField[] | null;
  typed: boolean;
  code: string;
  required: boolean;
  disabled?: boolean;
  onChange: (code: string) => void;
}) {
  if (typed) {
    return (
      <input
        aria-label={label}
        className={`${inputClass} mt-0 font-mono text-xs`}
        value={code}
        placeholder="ufCrm136_1750943184955"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.trim())}
      />
    );
  }
  return (
    <select
      aria-label={label}
      className={`${inputClass} mt-0`}
      value={code}
      disabled={disabled || !fields}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {!fields ? 'Carregando campos…' : required ? 'Escolha o campo…' : 'Não gravar'}
      </option>
      {/* Escolhido antes e apagado no portal depois: aparece até o cliente trocar. */}
      {code && fields && !fields.some((field) => field.code === code) && (
        <option value={code}>Campo removido ({code}): escolha outro</option>
      )}
      {fields?.map((field) => (
        <option key={field.code} value={field.code}>
          {field.label}
          {field.options ? ' (lista)' : ''}
        </option>
      ))}
    </select>
  );
}

/** Sem acento e sem maiúsculas, para a busca. */
function searchable(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Lista com busca (combobox): mostra o escolhido; ao focar, digitar filtra pelo nome ou pelo valor.
 * Setas, Enter e Esc pelo teclado. Para listas longas do portal, como os processos inteligentes.
 */
export function SearchSelect({
  options,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  options: Array<{ value: string; label: string }> | null;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  // `null`: fechado, o campo mostra o escolhido.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const selected = options?.find((option) => option.value === value);
  const term = searchable(query ?? '').trim();
  const matches =
    query === null
      ? []
      : (options ?? []).filter(
          (option) => searchable(option.label).includes(term) || option.value === term,
        );
  const pick = (option: { value: string }) => {
    setQuery(null);
    onChange(option.value);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-expanded={query !== null}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          query !== null && matches[active] ? `${listId}-${active}` : undefined
        }
        className={inputClass}
        value={query ?? selected?.label ?? ''}
        placeholder={placeholder}
        disabled={disabled || !options}
        onFocus={() => {
          setQuery('');
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={() => setQuery(null)}
        onKeyDown={(e) => {
          if (query === null) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((index) => Math.min(index + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[active]) pick(matches[active]);
          } else if (e.key === 'Escape') {
            setQuery(null);
          }
        }}
      />
      {query !== null && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-80 min-w-full max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg"
        >
          {matches.length === 0 && <li className="px-3 py-2 text-zinc-500">Nenhum resultado</li>}
          {matches.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 ${
                index === active ? 'bg-brand-50 text-brand-700' : 'text-zinc-800'
              }`}
              // Antes do blur do campo, que fecharia a lista.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <span className="truncate">{option.label}</span>
              <span className="shrink-0 font-mono text-xs text-zinc-400">{option.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
