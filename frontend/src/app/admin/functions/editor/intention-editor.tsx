'use client';

import {
  availableMarkers,
  type FunctionField,
  type FunctionTemplateContent,
  flattenFields,
  intentionFieldTypeSchema,
} from '@gptmaker/contracts';
import { useState } from 'react';
import { Badge, buttonClass } from '@/components/ui';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { useFocusCard } from './focus';
import { MarkerText } from './marker-text';
import { type DraftAction, type DraftIntention, moveItem, slug, uniqueId } from './model';

export const ACTION_TYPES: Record<string, string> = {
  TIMELINE_COMMENT: 'Comentário na timeline',
  CREATE_LEAD: 'Criar lead',
  UPSERT_DEAL: 'Criar ou atualizar negócio',
  CREATE_TASK: 'Criar tarefa',
  START_BIZPROC: 'Iniciar processo de negócio',
  TRANSFER_TO_HUMAN: 'Transferir para atendente',
};

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
    <div className="space-y-3">
      {intentions.length === 0 && (
        <p className="text-sm text-zinc-500">
          Nenhuma ação própria. As dos blocos incluídos entram sozinhas.
        </p>
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
          className={buttonClass('secondary', 'sm')}
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
          Adicionar ação
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

  return (
    <div
      ref={ref}
      className={`scroll-mt-4 rounded-lg border ${own.length || actionIssues ? 'border-red-300' : 'border-zinc-200'} bg-white`}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="text-xs text-zinc-400">{open ? '▾' : '▸'}</span>
          <span className="truncate text-sm font-medium text-zinc-900">{intention.name}</span>
          {intention.when && <Badge tone="zinc">condicional</Badge>}
          {published && <Badge tone="amber">publicada</Badge>}
          {!open && (
            <span className="truncate text-xs text-zinc-500">
              {intention.actions
                .map((action) => ACTION_TYPES[action.type] ?? action.type)
                .join(' → ')}
            </span>
          )}
        </button>
        {!disabled && (
          <div className="flex gap-1">
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => onMove(-1)}
              aria-label="Subir"
            >
              ↑
            </button>
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => onMove(1)}
              aria-label="Descer"
            >
              ↓
            </button>
            <button type="button" className={buttonClass('ghost-danger', 'sm')} onClick={onRemove}>
              Remover
            </button>
          </div>
        )}
      </div>
      {own.length > 0 && (
        <ul className="px-4 pb-2 text-xs text-red-600">
          {own.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {open && (
        <div className="space-y-4 border-t border-zinc-100 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
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
          <div>
            <p className="text-sm font-medium text-zinc-800">O que o agente coleta</p>
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
            <div className="mt-3 space-y-2">
              {intention.fields.map((field, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <Field label="Campo">
                    <input
                      className={`${inputClass} w-44`}
                      value={field.name}
                      disabled={disabled}
                      onChange={(e) =>
                        set({
                          fields: intention.fields.map((f, i) =>
                            i === index ? { ...f, name: e.target.value } : f,
                          ),
                        })
                      }
                    />
                  </Field>
                  <span className="pb-2 font-mono text-xs text-zinc-500">{`{{fields.${slug(field.name)}}}`}</span>
                  <Field label="Descrição">
                    <input
                      className={`${inputClass} w-72`}
                      value={field.description}
                      disabled={disabled}
                      onChange={(e) =>
                        set({
                          fields: intention.fields.map((f, i) =>
                            i === index ? { ...f, description: e.target.value } : f,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label="Tipo">
                    <select
                      className={`${inputClass} w-32`}
                      value={field.type}
                      disabled={disabled}
                      onChange={(e) =>
                        set({
                          fields: intention.fields.map((f, i) =>
                            i === index
                              ? { ...f, type: intentionFieldTypeSchema.parse(e.target.value) }
                              : f,
                          ),
                        })
                      }
                    >
                      {Object.entries(FIELD_TYPES).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-600"
                      checked={field.required}
                      disabled={disabled}
                      onChange={(e) =>
                        set({
                          fields: intention.fields.map((f, i) =>
                            i === index ? { ...f, required: e.target.checked } : f,
                          ),
                        })
                      }
                    />
                    Obrigatório
                  </label>
                  {!disabled && (
                    <button
                      type="button"
                      className={buttonClass('ghost-danger', 'sm')}
                      onClick={() =>
                        set({ fields: intention.fields.filter((_, i) => i !== index) })
                      }
                    >
                      Remover
                    </button>
                  )}
                </div>
              ))}
              {!disabled && (
                <button
                  type="button"
                  className={buttonClass('secondary', 'sm')}
                  onClick={() =>
                    set({
                      fields: [
                        ...intention.fields,
                        { name: 'Campo', description: '', type: 'STRING', required: false },
                      ],
                    })
                  }
                >
                  Adicionar campo coletado
                </button>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-800">O que acontece no Bitrix24</p>
            <div className="mt-2 space-y-3">
              {intention.actions.map((action, index) => (
                <ActionCard
                  key={index}
                  action={action}
                  fields={fields}
                  choices={choices}
                  markers={markers}
                  issues={issues(intention.key, index)}
                  disabled={disabled}
                  onChange={(next) =>
                    set({ actions: intention.actions.map((a, i) => (i === index ? next : a)) })
                  }
                  onMove={(delta) => set({ actions: moveItem(intention.actions, index, delta) })}
                  onRemove={() => set({ actions: intention.actions.filter((_, i) => i !== index) })}
                />
              ))}
              {!disabled && intention.actions.length < 10 && (
                <select
                  className={`${inputClass} mt-0 w-72`}
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    set({ actions: [...intention.actions, newAction(e.target.value)] })
                  }
                >
                  <option value="">Adicionar passo…</option>
                  {Object.entries(ACTION_TYPES).map(([type, label]) => (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <Field label="Resposta do agente">
              <select
                className={inputClass}
                value={intention.responseMode}
                disabled={disabled}
                onChange={(e) =>
                  set({ responseMode: e.target.value as DraftIntention['responseMode'] })
                }
              >
                <option value="INSTRUCTIONS">Segue a instrução</option>
                <option value="API">Usa o resultado da ação</option>
              </select>
            </Field>
            {intention.responseMode === 'INSTRUCTIONS' && (
              <Field label="Instrução depois da ação">
                <MarkerText
                  value={intention.instructions ?? ''}
                  markers={markers}
                  allowRuntime
                  disabled={disabled}
                  onChange={(instructions) => set({ instructions: instructions || null })}
                />
              </Field>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionInput({
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
    <div className="flex flex-wrap items-end gap-3">
      <Field label={label}>
        <select
          className={`${inputClass} w-72`}
          value={value?.field ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const next = choices.find((f) => f.id === e.target.value) as
              Extract<FunctionField, { kind: 'CHOICE' | 'MULTI_CHOICE' }> | undefined;
            onChange(next ? { field: next.id, in: [next.options[0]!.value] } : undefined);
          }}
        >
          <option value="">Sempre</option>
          {choices.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      {field && value && (
        <div className="flex flex-wrap gap-3 pb-2 text-sm">
          {field.options.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={value.in.includes(option.value)}
                disabled={disabled}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...value.in, option.value]
                    : value.in.filter((v) => v !== option.value);
                  if (next.length) onChange({ ...value, in: next });
                }}
              />
              {option.label}
            </label>
          ))}
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
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-600">
        Campos do CRM: escolha da lista ou digite o código (UF_CRM_… para os personalizados)
      </p>
      <datalist id="crm-fields">
        {Object.entries(CRM_FIELDS).map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </datalist>
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
          {!disabled && (
            <button
              type="button"
              className={buttonClass('ghost-danger', 'sm')}
              onClick={() => onChange(Object.fromEntries(rows.filter((_, i) => i !== index)))}
            >
              Remover
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
          onClick={() => {
            const free = Object.keys(CRM_FIELDS).find((code) => !(code in value));
            onChange({ ...value, [free ?? `UF_CRM_${rows.length + 1}`]: '' });
          }}
        >
          Adicionar campo do CRM
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

  return (
    <div
      className={`rounded-lg border p-3 ${issues.length ? 'border-red-300' : 'border-zinc-200'} bg-zinc-50/50`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-800">
          {ACTION_TYPES[action.type] ?? action.type}
        </span>
        <span className="flex-1" />
        {!disabled && (
          <>
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => onMove(-1)}
              aria-label="Subir"
            >
              ↑
            </button>
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => onMove(1)}
              aria-label="Descer"
            >
              ↓
            </button>
            <button type="button" className={buttonClass('ghost-danger', 'sm')} onClick={onRemove}>
              Remover
            </button>
          </>
        )}
      </div>
      <div className="mt-3 space-y-3">
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
        {action.type === 'TRANSFER_TO_HUMAN' && (
          <div className="flex flex-wrap gap-4">
            <Field label="Para quem">
              <select
                className={`${inputClass} w-56`}
                value={text('target') || 'OPERATOR'}
                disabled={disabled}
                onChange={(e) =>
                  setConfig(
                    e.target.value === 'USER'
                      ? { target: 'USER', userId: config.userId ?? 1 }
                      : { target: 'OPERATOR', userId: undefined },
                  )
                }
              >
                <option value="OPERATOR">Atendente livre da Linha Aberta</option>
                <option value="USER">Um usuário</option>
              </select>
            </Field>
            {config.target === 'USER' && (
              <RefInput
                label="Usuário"
                value={config.userId}
                fields={ofKind('BITRIX_USER')}
                disabled={disabled}
                onChange={(value) => setConfig({ userId: value })}
              />
            )}
          </div>
        )}
        {!ACTION_TYPES[action.type] && (
          <p className="text-xs text-zinc-500">Tipo sem formulário: edite pela seção JSON.</p>
        )}
        {issues.length > 0 && (
          <ul className="text-xs text-red-600">
            {issues.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
