'use client';

import {
  availableMarkers,
  type FunctionField,
  type FunctionTemplateContent,
  flattenFields,
  intentionFieldTypeSchema,
} from '@gptmaker/contracts';
import { useState } from 'react';
import {
  BoltIcon,
  ChatIcon,
  ChevronDownIcon,
  PlusIcon,
  RefreshIcon,
  SparkIcon,
  UserIcon,
  UsersIcon,
  CheckSquareIcon,
  LayersIcon,
} from '@/components/icons';
import { Badge, buttonClass } from '@/components/ui';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { useFocusCard } from './focus';
import {
  AddPicker,
  Code,
  IconButton,
  Issues,
  ItemActions,
  Label,
  Segmented,
  TypeIcon,
} from './kit';
import { MarkerText } from './marker-text';
import { type DraftAction, type DraftIntention, moveItem, slug, uniqueId } from './model';

export const ACTION_TYPES: Record<string, string> = {
  TIMELINE_COMMENT: 'Comentário na timeline',
  CREATE_LEAD: 'Criar lead',
  UPSERT_DEAL: 'Criar ou atualizar negócio',
  CREATE_TASK: 'Criar tarefa',
  START_BIZPROC: 'Iniciar processo de negócio',
  CREATE_SPA_ITEM: 'Criar item de SPA',
  TRANSFER_TO_HUMAN: 'Transferir para atendente',
};

/** Ícone, cor e explicação de cada passo no seletor. */
const ACTION_STYLE: Record<string, { icon: typeof BoltIcon; tone: string; hint: string }> = {
  TIMELINE_COMMENT: {
    icon: ChatIcon,
    tone: 'bg-sky-50 text-sky-600',
    hint: 'Registra um comentário na timeline do CRM.',
  },
  CREATE_LEAD: {
    icon: SparkIcon,
    tone: 'bg-emerald-50 text-emerald-600',
    hint: 'Cria um lead com os campos que você mapear.',
  },
  UPSERT_DEAL: {
    icon: RefreshIcon,
    tone: 'bg-emerald-50 text-emerald-600',
    hint: 'Cria ou move um negócio no funil e etapa.',
  },
  CREATE_TASK: {
    icon: CheckSquareIcon,
    tone: 'bg-amber-50 text-amber-600',
    hint: 'Cria uma tarefa para um responsável.',
  },
  START_BIZPROC: {
    icon: BoltIcon,
    tone: 'bg-brand-50 text-brand-600',
    hint: 'Dispara um processo de negócio do Bitrix24.',
  },
  CREATE_SPA_ITEM: {
    icon: LayersIcon,
    tone: 'bg-violet-50 text-violet-600',
    hint: 'Cria um item num processo inteligente (SPA) que o cliente escolhe.',
  },
  TRANSFER_TO_HUMAN: {
    icon: UsersIcon,
    tone: 'bg-rose-50 text-rose-600',
    hint: 'Passa a conversa para um atendente.',
  },
};

const ACTION_ITEMS = Object.entries(ACTION_TYPES).map(([key, label]) => ({
  key,
  label,
  ...ACTION_STYLE[key]!,
}));

/** Campos comuns de lead e negócio no Bitrix24: sugestões do código, que continua livre. */
const CRM_FIELDS: Record<string, string> = {
  TITLE: 'Título',
  NAME: 'Nome (lead)',
  LAST_NAME: 'Sobrenome (lead)',
  COMPANY_TITLE: 'Empresa (lead)',
  COMMENTS: 'Comentário',
  SOURCE_ID: 'Origem',
  SOURCE_DESCRIPTION: 'Detalhes da origem',
  OPPORTUNITY: 'Valor',
  CURRENCY_ID: 'Moeda',
  ASSIGNED_BY_ID: 'Responsável',
};

const FIELD_TYPES: Record<string, string> = {
  STRING: 'Texto',
  NUMBER: 'Número',
  BOOLEAN: 'Sim ou não',
  DATE: 'Data',
  DATE_TIME: 'Data e hora',
  URL: 'Link',
};

function newAction(type: string): DraftAction {
  switch (type) {
    case 'TIMELINE_COMMENT':
      return { type, config: { text: '' } };
    case 'CREATE_LEAD':
      return { type, config: { fields: { TITLE: 'Lead de {{contact.name}}' } } };
    case 'UPSERT_DEAL':
      return {
        type,
        config: { categoryId: 0, stageId: 'NEW', fields: { TITLE: '{{contact.name}}' } },
      };
    case 'CREATE_TASK':
      return {
        type,
        config: { title: 'Tarefa de {{contact.name}}', description: '', responsibleId: 1 },
      };
    case 'START_BIZPROC':
      return { type, config: { templateId: 1, documentType: 'DEAL' } };
    case 'CREATE_SPA_ITEM':
      return { type, config: { spa: '', title: 'Chamado de {{contact.name}}', values: {} } };
    default:
      return { type: 'TRANSFER_TO_HUMAN', config: { target: 'OPERATOR' } };
  }
}

type Content = Pick<FunctionTemplateContent, 'fields' | 'intentions'>;

/** Ações geradas pela função (intenções), com adicionar e reordenar. */
export function IntentionList({
  content,
  intentions,
  onChange,
  issues,
  published = [],
  disabled,
}: {
  /** Conteúdo com os blocos expandidos: os campos dos blocos também valem nas ações. */
  content: Content;
  intentions: DraftIntention[];
  onChange: (intentions: DraftIntention[]) => void;
  issues: (key: string, actionIndex?: number) => string[];
  /** Chaves já publicadas: travadas. */
  published?: string[];
  disabled?: boolean;
}) {
  // A ação recém-criada já abre: o próximo passo é dar o nome.
  const [added, setAdded] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {intentions.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-8 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <BoltIcon className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-zinc-800">Nenhuma ação própria</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            As ações dos blocos incluídos entram sozinhas.
          </p>
        </div>
      )}
      {intentions.map((intention, index) => (
        <IntentionCard
          key={index}
          content={content}
          intention={intention}
          issues={issues}
          isNew={index === added}
          published={published.includes(intention.key)}
          disabled={disabled}
          onChange={(next) => onChange(intentions.map((item, i) => (i === index ? next : item)))}
          onMove={(delta) => onChange(moveItem(intentions, index, delta))}
          onRemove={() => {
            setAdded(null);
            onChange(intentions.filter((_, i) => i !== index));
          }}
        />
      ))}
      {!disabled && (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700"
          onClick={() => {
            const key = uniqueId('nova_acao', new Set(intentions.map((item) => item.key)));
            setAdded(intentions.length);
            onChange([
              ...intentions,
              {
                key,
                name: 'Nova ação',
                whenToUse: 'Quando…',
                fields: [],
                actions: [newAction('TIMELINE_COMMENT')],
                responseMode: 'INSTRUCTIONS',
                instructions: null,
              },
            ]);
          }}
        >
          <PlusIcon className="size-4" /> Adicionar ação
        </button>
      )}
    </div>
  );
}

function IntentionCard({
  content,
  intention,
  issues,
  isNew,
  published,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  content: Content;
  intention: DraftIntention;
  issues: (key: string, actionIndex?: number) => string[];
  isNew: boolean;
  published: boolean;
  disabled?: boolean;
  onChange: (intention: DraftIntention) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  // A chave liga a ação ao que já foi publicado: só acompanha o nome nas ações criadas agora.
  const [autoKey, setAutoKey] = useState(intention.key.startsWith('nova_acao'));
  const fields = flattenFields(content.fields);
  const choices = fields.filter((f) => f.kind === 'CHOICE' || f.kind === 'MULTI_CHOICE');
  const lists = fields.filter((f) => f.kind === 'TEXT_LIST');
  const withSelf = {
    ...content,
    intentions: [...content.intentions.filter((i) => i.key !== intention.key), intention],
  };
  const markers = availableMarkers(withSelf, { kind: 'intention', key: intention.key });
  const own = issues(intention.key);
  const actionIssues = intention.actions.some((_, index) => issues(intention.key, index).length);
  const { ref, open, setOpen } = useFocusCard({
    contains: (target) => target.intentionKey === intention.key,
    isSelf: (target) => target.intentionKey === intention.key,
    startOpen: isNew || own.length > 0 || actionIssues,
  });
  const set = (patch: Partial<DraftIntention>) => onChange({ ...intention, ...patch });
  const invalid = own.length > 0 || actionIssues;

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
          <TypeIcon icon={BoltIcon} tone="bg-brand-50 text-brand-600" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-zinc-900">{intention.name}</span>
              {intention.when && <Badge tone="brand">condicional</Badge>}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {intention.actions.map((action, index) => {
                const style = ACTION_STYLE[action.type];
                return (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600"
                  >
                    {style && <style.icon className="size-3" />}
                    {ACTION_TYPES[action.type] ?? action.type}
                  </span>
                );
              })}
            </span>
          </span>
          {invalid && <Badge tone="red">com problema</Badge>}
          {published && (
            <span
              className="hidden shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 sm:inline"
              title="Já saiu numa versão publicada: o identificador fica travado."
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
            removeLabel="Remover ação"
          />
        </div>
        <IconButton label={open ? 'Recolher' : 'Expandir'} onClick={() => setOpen(!open)}>
          <ChevronDownIcon className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </IconButton>
      </div>
      {own.length > 0 && (
        <div className="px-3 pb-3">
          <Issues messages={own} />
        </div>
      )}
      {open && (
        <div className="space-y-6 border-t border-zinc-100 px-4 py-4">
          <div className="space-y-4">
            <Label>Quando</Label>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
              <Field label="Nome (o agente cita pelo nome)">
                <input
                  className={inputClass}
                  value={intention.name}
                  disabled={disabled}
                  onChange={(e) => {
                    set({
                      name: e.target.value,
                      ...(autoKey && !published && e.target.value
                        ? { key: slug(e.target.value) }
                        : {}),
                    });
                  }}
                />
              </Field>
              <Field
                label="Identificador interno"
                hint={
                  published
                    ? 'Travado: liga esta ação à que os agentes já têm.'
                    : 'Nasce do nome. Depois de publicar, fica travado.'
                }
              >
                <input
                  className={`${inputClass} font-mono text-xs`}
                  value={intention.key}
                  disabled={disabled || published}
                  onChange={(e) => {
                    setAutoKey(false);
                    set({ key: slug(e.target.value) });
                  }}
                />
              </Field>
            </div>
            <Field
              label="Quando o agente usa"
              hint="Descreva a situação, ex.: quando o cliente pedir um orçamento."
            >
              <MarkerText
                value={intention.whenToUse}
                markers={markers}
                allowRuntime
                disabled={disabled}
                onChange={(whenToUse) => set({ whenToUse })}
              />
            </Field>
            <ConditionInput
              label="Só existe quando o cliente escolhe"
              value={intention.when}
              choices={choices}
              disabled={disabled}
              onChange={(when) => set({ when })}
            />
          </div>

          <div>
            <Label hint="Dados que o agente pede ao cliente antes de executar.">
              O que o agente coleta
            </Label>
            <div className="space-y-3">
              <Field
                label="Perguntas de uma lista do formulário"
                hint="Cada item vira um campo coletado; {{intencao.respostas}} lista pergunta e resposta."
              >
                <select
                  className={`${inputClass} w-72`}
                  value={intention.collectFrom ?? ''}
                  disabled={disabled}
                  onChange={(e) => set({ collectFrom: e.target.value || undefined })}
                >
                  <option value="">Nenhuma</option>
                  {lists.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              {intention.fields.length > 0 && (
                <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                  {intention.fields.map((field, index) => {
                    const setField = (patch: Partial<typeof field>) =>
                      set({
                        fields: intention.fields.map((f, i) =>
                          i === index ? { ...f, ...patch } : f,
                        ),
                      });
                    return (
                      <div
                        key={index}
                        className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)_8rem_auto_auto]"
                      >
                        <div className="min-w-0">
                          <input
                            className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-zinc-50"
                            value={field.name}
                            aria-label="Nome do campo"
                            disabled={disabled}
                            onChange={(e) => setField({ name: e.target.value })}
                          />
                          <span className="mt-0.5 block truncate">
                            <Code>{`{{fields.${slug(field.name)}}}`}</Code>
                          </span>
                        </div>
                        <input
                          className="min-w-0 rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-zinc-50"
                          value={field.description}
                          placeholder="Descrição para o agente"
                          aria-label="Descrição"
                          disabled={disabled}
                          onChange={(e) => setField({ description: e.target.value })}
                        />
                        <select
                          className="rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-zinc-50"
                          value={field.type}
                          aria-label="Tipo"
                          disabled={disabled}
                          onChange={(e) =>
                            setField({ type: intentionFieldTypeSchema.parse(e.target.value) })
                          }
                        >
                          {Object.entries(FIELD_TYPES).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                          <input
                            type="checkbox"
                            className="size-4 accent-brand-600"
                            checked={field.required}
                            disabled={disabled}
                            onChange={(e) => setField({ required: e.target.checked })}
                          />
                          Obrigatório
                        </label>
                        <ItemActions
                          disabled={disabled}
                          removeLabel="Remover campo"
                          onRemove={() =>
                            set({ fields: intention.fields.filter((_, i) => i !== index) })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              {!disabled && (
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() =>
                    set({
                      fields: [
                        ...intention.fields,
                        { name: 'Campo', description: '', type: 'STRING', required: false },
                      ],
                    })
                  }
                >
                  <PlusIcon className="size-4" /> Adicionar campo coletado
                </button>
              )}
            </div>
          </div>

          <div>
            <Label hint="Executados em ordem, de cima para baixo.">
              O que acontece no Bitrix24
            </Label>
            <ol className="relative space-y-3">
              {intention.actions.map((action, index) => (
                <li key={index} className="relative flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    {index < intention.actions.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-zinc-200" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <ActionCard
                      action={action}
                      fields={fields}
                      choices={choices}
                      markers={markers}
                      issues={issues(intention.key, index)}
                      disabled={disabled}
                      onChange={(next) =>
                        set({ actions: intention.actions.map((a, i) => (i === index ? next : a)) })
                      }
                      onMove={(delta) =>
                        set({ actions: moveItem(intention.actions, index, delta) })
                      }
                      onRemove={() =>
                        set({ actions: intention.actions.filter((_, i) => i !== index) })
                      }
                    />
                  </div>
                </li>
              ))}
            </ol>
            {intention.actions.length < 10 && (
              <div className="mt-3 pl-9">
                <AddPicker
                  label="Adicionar passo"
                  items={ACTION_ITEMS}
                  disabled={disabled}
                  onPick={(type) => set({ actions: [...intention.actions, newAction(type)] })}
                />
              </div>
            )}
          </div>

          <div>
            <Label>Depois da ação</Label>
            <div className="space-y-3">
              <Segmented
                label="Resposta do agente"
                disabled={disabled}
                value={intention.responseMode}
                options={[
                  { value: 'INSTRUCTIONS', label: 'Segue uma instrução' },
                  { value: 'API', label: 'Usa o resultado da ação' },
                ]}
                onChange={(responseMode) => set({ responseMode })}
              />
              {intention.responseMode === 'INSTRUCTIONS' && (
                <MarkerText
                  value={intention.instructions ?? ''}
                  markers={markers}
                  allowRuntime
                  disabled={disabled}
                  placeholder="O que o agente diz ou faz depois da ação…"
                  onChange={(instructions) => set({ instructions: instructions || null })}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ConditionInput({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: DraftIntention['when'];
  choices: FunctionField[];
  disabled?: boolean;
  onChange: (value: DraftIntention['when']) => void;
}) {
  const field = choices.find((f) => f.id === value?.field) as
    Extract<FunctionField, { kind: 'CHOICE' | 'MULTI_CHOICE' }> | undefined;
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-600">{label}</span>
        <select
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-zinc-50"
          aria-label={label}
          value={value?.field ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const next = choices.find((f) => f.id === e.target.value) as
              Extract<FunctionField, { kind: 'CHOICE' | 'MULTI_CHOICE' }> | undefined;
            onChange(next ? { field: next.id, in: [next.options[0]!.value] } : undefined);
          }}
        >
          <option value="">Sempre (sem condição)</option>
          {choices.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {field && value && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {field.options.map((option) => {
            const checked = value.in.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={checked}
                disabled={disabled}
                onClick={() => {
                  const next = checked
                    ? value.in.filter((v) => v !== option.value)
                    : [...value.in, option.value];
                  if (next.length) onChange({ ...value, in: next });
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ring-inset disabled:cursor-not-allowed ${
                  checked
                    ? 'bg-brand-600 text-white ring-brand-600'
                    : 'bg-white text-zinc-600 ring-zinc-200 hover:ring-zinc-300'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Valor numérico de uma ação: um campo do formulário do tipo certo ou um número fixo. */
function RefInput({
  label,
  value,
  fields,
  part,
  disabled,
  onChange,
}: {
  label: string;
  value: unknown;
  fields: FunctionField[];
  /** Parte do campo (`categoryId` do funil), quando é o caso. */
  part?: string;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}) {
  const marker =
    typeof value === 'string' ? /^\{\{\s*([^}\s]+)\s*\}\}$/.exec(value)?.[1] : undefined;
  const fieldId = marker && part ? marker.replace(new RegExp(`\\.${part}$`), '') : marker;
  return (
    <Field label={label}>
      <div className="mt-1.5 flex gap-2">
        <select
          className={`${inputClass} mt-0 w-56`}
          value={fieldId ?? ''}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.value ? `{{${e.target.value}${part ? `.${part}` : ''}}}` : 0)
          }
        >
          <option value="">Valor fixo</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              Do formulário: {f.label}
            </option>
          ))}
        </select>
        {!fieldId && (
          <input
            className={`${inputClass} mt-0 w-28`}
            value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
            disabled={disabled}
            onChange={(e) =>
              onChange(/^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)
            }
          />
        )}
      </div>
    </Field>
  );
}

function FieldMap({
  value,
  markers,
  disabled,
  onChange,
}: {
  value: Record<string, string>;
  markers: ReturnType<typeof availableMarkers>;
  disabled?: boolean;
  onChange: (value: Record<string, string>) => void;
}) {
  const rows = Object.entries(value);
  const setRow = (index: number, key: string, text: string) =>
    onChange(Object.fromEntries(rows.map(([k, v], i) => (i === index ? [key, text] : [k, v]))));
  return (
    <div>
      <p className="mb-1.5 text-xs text-zinc-500">
        Campos do CRM: escolha da lista ou digite o código (UF_CRM_… para os personalizados)
      </p>
      <datalist id="crm-fields">
        {Object.entries(CRM_FIELDS).map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </datalist>
      <div className="space-y-2">
        {rows.map(([key, text], index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <div>
              <input
                className={`${inputClass} mt-0 font-mono text-xs`}
                list="crm-fields"
                value={key}
                disabled={disabled}
                onChange={(e) => setRow(index, e.target.value.toUpperCase(), text)}
              />
              {CRM_FIELDS[key] && <p className="mt-0.5 text-xs text-zinc-500">{CRM_FIELDS[key]}</p>}
            </div>
            <MarkerText
              value={text}
              rows={1}
              markers={markers}
              allowRuntime
              disabled={disabled}
              onChange={(next) => setRow(index, key, next)}
            />
            <div className="pt-1">
              <ItemActions
                disabled={disabled}
                removeLabel="Remover campo do CRM"
                onRemove={() => onChange(Object.fromEntries(rows.filter((_, i) => i !== index)))}
              />
            </div>
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          type="button"
          className={`${buttonClass('ghost', 'sm')} mt-1`}
          onClick={() => {
            const free = Object.keys(CRM_FIELDS).find((code) => !(code in value));
            onChange({ ...value, [free ?? `UF_CRM_${rows.length + 1}`]: '' });
          }}
        >
          <PlusIcon className="size-4" /> Adicionar campo do CRM
        </button>
      )}
    </div>
  );
}

function ActionCard({
  action,
  fields,
  choices,
  markers,
  issues,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  action: DraftAction;
  fields: FunctionField[];
  choices: FunctionField[];
  markers: ReturnType<typeof availableMarkers>;
  issues: string[];
  disabled?: boolean;
  onChange: (action: DraftAction) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const config = action.config;
  const setConfig = (patch: Record<string, unknown>) =>
    onChange({ ...action, config: { ...config, ...patch } });
  const ofKind = (kind: FunctionField['kind']) => fields.filter((f) => f.kind === kind);
  const text = (key: string) => (typeof config[key] === 'string' ? (config[key] as string) : '');
  const map = (key: string) =>
    config[key] && typeof config[key] === 'object' ? (config[key] as Record<string, string>) : {};
  const style = ACTION_STYLE[action.type];

  return (
    <div
      className={`rounded-xl border bg-zinc-50/60 ${issues.length ? 'border-red-300' : 'border-zinc-200'}`}
    >
      <div className="flex items-center gap-2.5 border-b border-zinc-200/70 px-3 py-2">
        {style && <TypeIcon icon={style.icon} tone={style.tone} size="sm" />}
        <span className="flex-1 text-sm font-medium text-zinc-800">
          {ACTION_TYPES[action.type] ?? action.type}
        </span>
        <ItemActions
          disabled={disabled}
          onUp={() => onMove(-1)}
          onDown={() => onMove(1)}
          onRemove={onRemove}
          removeLabel="Remover passo"
        />
      </div>
      <div className="space-y-3 p-3">
        <ConditionInput
          label="Este passo só roda quando o cliente escolhe"
          value={action.when}
          choices={choices}
          disabled={disabled}
          onChange={(when) => onChange({ ...action, when })}
        />
        {action.type === 'TIMELINE_COMMENT' && (
          <Field label="Comentário">
            <MarkerText
              value={text('text')}
              markers={markers}
              allowRuntime
              disabled={disabled}
              onChange={(value) => setConfig({ text: value })}
            />
          </Field>
        )}
        {(action.type === 'CREATE_LEAD' || action.type === 'UPSERT_DEAL') && (
          <>
            {action.type === 'UPSERT_DEAL' && (
              <div className="flex flex-wrap gap-4">
                <RefInput
                  label="Funil"
                  value={config.categoryId}
                  part="categoryId"
                  fields={ofKind('BITRIX_STAGE')}
                  disabled={disabled}
                  onChange={(value) => setConfig({ categoryId: value })}
                />
                <RefInput
                  label="Etapa"
                  value={config.stageId}
                  part="stageId"
                  fields={ofKind('BITRIX_STAGE')}
                  disabled={disabled}
                  onChange={(value) => setConfig({ stageId: value })}
                />
              </div>
            )}
            <FieldMap
              value={map('fields')}
              markers={markers}
              disabled={disabled}
              onChange={(value) => setConfig({ fields: value })}
            />
          </>
        )}
        {action.type === 'CREATE_TASK' && (
          <>
            <Field label="Título">
              <MarkerText
                value={text('title')}
                rows={1}
                markers={markers}
                allowRuntime
                disabled={disabled}
                onChange={(value) => setConfig({ title: value })}
              />
            </Field>
            <Field label="Descrição">
              <MarkerText
                value={text('description')}
                markers={markers}
                allowRuntime
                disabled={disabled}
                onChange={(value) => setConfig({ description: value || undefined })}
              />
            </Field>
            <div className="flex flex-wrap gap-4">
              <RefInput
                label="Responsável"
                value={config.responsibleId}
                fields={ofKind('BITRIX_USER')}
                disabled={disabled}
                onChange={(value) => setConfig({ responsibleId: value })}
              />
              <RefInput
                label="Prazo (dias)"
                value={config.deadlineDays}
                fields={ofKind('INTEGER')}
                disabled={disabled}
                onChange={(value) => setConfig({ deadlineDays: value })}
              />
            </div>
          </>
        )}
        {action.type === 'START_BIZPROC' && (
          <div className="flex flex-wrap gap-4">
            <RefInput
              label="Número do modelo do processo"
              value={config.templateId}
              fields={ofKind('INTEGER')}
              disabled={disabled}
              onChange={(value) => setConfig({ templateId: value })}
            />
            <Field label="Onde roda">
              <select
                className={`${inputClass} w-40`}
                value={text('documentType') || 'DEAL'}
                disabled={disabled}
                onChange={(e) => setConfig({ documentType: e.target.value })}
              >
                <option value="LEAD">Lead</option>
                <option value="DEAL">Negócio</option>
                <option value="CONTACT">Contato</option>
                <option value="COMPANY">Empresa</option>
              </select>
            </Field>
          </div>
        )}
        {action.type === 'CREATE_SPA_ITEM' && (
          <SpaActionInput
            config={config}
            spaFields={ofKind('BITRIX_SPA')}
            markers={markers}
            disabled={disabled}
            onChange={setConfig}
          />
        )}
        {action.type === 'TRANSFER_TO_HUMAN' && (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-zinc-800">Para quem</p>
              <Segmented
                label="Para quem"
                disabled={disabled}
                value={
                  text('target') === 'USER'
                    ? 'USER'
                    : text('target') === 'LINE'
                      ? 'LINE'
                      : 'OPERATOR'
                }
                options={[
                  { value: 'OPERATOR', label: 'Atendente livre da Linha Aberta' },
                  { value: 'USER', label: 'Um usuário' },
                  { value: 'LINE', label: 'Canal aberto' },
                ]}
                onChange={(target) =>
                  setConfig(
                    target === 'USER'
                      ? { target: 'USER', userId: config.userId ?? 1, lineId: undefined }
                      : target === 'LINE'
                        ? { target: 'LINE', lineId: config.lineId ?? 1, userId: undefined }
                        : { target: 'OPERATOR', userId: undefined, lineId: undefined },
                  )
                }
              />
            </div>
            {config.target === 'USER' && (
              <RefInput
                label="Usuário (vários: rodízio)"
                value={config.userId}
                fields={ofKind('BITRIX_USER')}
                disabled={disabled}
                onChange={(value) => setConfig({ userId: value })}
              />
            )}
            {config.target === 'LINE' && (
              <RefInput
                label="Canal aberto"
                value={config.lineId}
                fields={ofKind('BITRIX_OPENLINE')}
                disabled={disabled}
                onChange={(value) => setConfig({ lineId: value })}
              />
            )}
          </div>
        )}
        {!ACTION_TYPES[action.type] && (
          <p className="text-xs text-zinc-500">Tipo sem formulário: edite pela seção JSON.</p>
        )}
        <Issues messages={issues} />
      </div>
    </div>
  );
}

/**
 * Passo "Criar item de SPA": o campo de SPA do formulário (o cliente escolhe o SPA e os campos), o
 * título e o conteúdo de cada valor declarado nele. Valor vazio fica sem uso e a checagem avisa.
 */
function SpaActionInput({
  config,
  spaFields,
  markers,
  disabled,
  onChange,
}: {
  config: Record<string, unknown>;
  spaFields: FunctionField[];
  markers: ReturnType<typeof availableMarkers>;
  disabled?: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const marker = typeof config.spa === 'string' ? config.spa : '';
  const chosen = spaFields.find((field) => `{{${field.id}}}` === marker.trim());
  const values =
    config.values && typeof config.values === 'object'
      ? (config.values as Record<string, string>)
      : {};
  return (
    <>
      <Field label="Campo de SPA do formulário">
        <select
          className={inputClass}
          value={chosen ? `{{${chosen.id}}}` : ''}
          disabled={disabled}
          onChange={(e) => onChange({ spa: e.target.value })}
        >
          <option value="">
            {spaFields.length
              ? 'Escolha o campo…'
              : 'Crie no formulário um campo "Processo inteligente"'}
          </option>
          {spaFields.map((field) => (
            <option key={field.id} value={`{{${field.id}}}`}>
              {field.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Título do item">
        <MarkerText
          value={typeof config.title === 'string' ? config.title : ''}
          rows={1}
          markers={markers}
          allowRuntime
          disabled={disabled}
          onChange={(value) => onChange({ title: value })}
        />
      </Field>
      {chosen?.kind === 'BITRIX_SPA' &&
        chosen.values.map((declared) => (
          <Field
            key={declared.id}
            label={`${declared.label}${declared.required ? '' : ' (opcional)'}`}
            hint={declared.options ? `Um destes: ${declared.options.join(', ')}` : undefined}
          >
            <MarkerText
              value={values[declared.id] ?? ''}
              rows={1}
              markers={markers}
              allowRuntime
              disabled={disabled}
              onChange={(value) => {
                const next = { ...values };
                if (value) next[declared.id] = value;
                else delete next[declared.id];
                onChange({ values: next });
              }}
            />
          </Field>
        ))}
    </>
  );
}

/** Ícone pequeno de um passo, na cor do tipo (para listas fora do editor). */
export function ActionTypeIcon({ type }: { type: string }) {
  const style = ACTION_STYLE[type];
  const Icon = style?.icon ?? UserIcon;
  return (
    <Icon
      className={`size-3.5 ${style?.tone.split(' ').find((c) => c.startsWith('text-')) ?? 'text-zinc-400'}`}
    />
  );
}
