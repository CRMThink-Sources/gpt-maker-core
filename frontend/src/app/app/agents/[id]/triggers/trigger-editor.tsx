'use client';

import {
  type AgentEventName,
  agentEventSchema,
  createTriggerSchema,
  renderTemplate,
  TEMPLATE_VARIABLES,
  templateErrors,
  TRIGGER_MAX_ACTIONS,
  type TriggerActionInput,
  type TriggerActionType,
  triggerActionTypeSchema,
  type TriggerView,
  type TriggerWriteResult,
} from '@gptmaker/contracts';
import { useId, useRef, useState } from 'react';
import { CloseIcon, PlusIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, buttonClass, Card } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { bx24SelectUsers, insideBitrix } from '@/lib/bx24';
import {
  type CrmEntity,
  type CrmFieldOption,
  useCrmFields,
  useDealPipelines,
  useDealStages,
} from '@/lib/crm-fields';
import { ACTION_TYPES, AGENT_EVENTS, newAction, SAMPLE_CONTEXT } from '@/lib/triggers';
import { useAppSession } from '../../../session-provider';
import { Field, inputClass } from '../../agent-fields';

type Action = TriggerActionInput;
type FieldMap = Record<string, string>;

/** Campo de texto com variáveis: inserir `{{...}}`, erros do template e prévia com dados de exemplo. */
function TemplateInput({
  label,
  hint,
  value,
  onChange,
  multiline = false,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const errors = value.trim() ? templateErrors(value) : [];
  const preview =
    value.includes('{{') && !errors.length ? renderTemplate(value, SAMPLE_CONTEXT) : null;

  function insert(path: string) {
    const placeholder = `{{${path}}}`;
    const element = ref.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + placeholder + value.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  const Input = multiline ? 'textarea' : 'input';
  return (
    <div className="text-sm">
      <div className="flex items-end justify-between gap-2">
        <span className="font-medium text-zinc-800">{label}</span>
        <select
          className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs text-zinc-600"
          value=""
          disabled={disabled}
          onChange={(e) => e.target.value && insert(e.target.value)}
          aria-label={`Inserir variável em ${label}`}
        >
          <option value="">+ variável</option>
          {TEMPLATE_VARIABLES.map((variable) => (
            <option key={variable.path} value={variable.path}>
              {variable.description}
            </option>
          ))}
        </select>
      </div>
      <Input
        ref={ref}
        className={`${inputClass} ${multiline ? 'min-h-20' : ''}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && !errors.length && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      {errors.map((error) => (
        <p key={error} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ))}
      {preview !== null && (
        <p className="mt-1 truncate text-xs text-zinc-500" title={preview}>
          Exemplo: <span className="text-zinc-700">{preview || '(vazio)'}</span>
        </p>
      )}
    </div>
  );
}

/** Legenda dos valores aceitos por um campo de lista; clicar preenche o valor com o código. */
function OptionsLegend({
  options,
  onPick,
  disabled,
}: {
  options: CrmFieldOption[];
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-1.5 text-xs text-zinc-500">
      <span>Valores possíveis (use o código):</span>
      <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(option.id)}
            className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-zinc-700 hover:border-brand-300 hover:bg-brand-50"
            title={`Preencher com ${option.id}`}
          >
            <span className="font-mono">{option.id}</span> · {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Campos do CRM (campo ⇒ valor com variáveis). Com `entity`, os campos do portal aparecem como
 * sugestões pelo nome enquanto se digita (o negócio pode ter centenas), e os de lista mostram os
 * valores aceitos. Qualquer código pode ser digitado, inclusive fora da lista.
 */
function FieldMapEditor({
  fields,
  onChange,
  entity,
  locked = [],
  disabled,
}: {
  fields: FieldMap;
  onChange: (fields: FieldMap) => void;
  entity?: CrmEntity;
  /** Campos obrigatórios: sem remover nem trocar. */
  locked?: string[];
  disabled?: boolean;
}) {
  const crm = useCrmFields(entity);
  const listId = useId();
  const byCode = new Map(crm.fields?.map((field) => [field.code, field]));
  const entries = Object.entries(fields);
  const rename = (from: string, to: string) =>
    onChange(Object.fromEntries(entries.map(([key, value]) => [key === from ? to : key, value])));
  const setValue = (key: string, value: string) => onChange({ ...fields, [key]: value });

  return (
    <div className="space-y-3">
      {crm.fields && (
        <datalist id={listId}>
          {crm.fields
            .filter((field) => !(field.code in fields))
            .map((field) => (
              <option key={field.code} value={field.code}>
                {field.label}
                {field.required ? ' (obrigatório)' : ''}
              </option>
            ))}
        </datalist>
      )}
      {entries.map(([key, value], index) => {
        const field = byCode.get(key);
        const lockedRow = locked.includes(key);
        return (
          <div key={index} className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                className={`${inputClass} mt-0 font-mono text-xs`}
                list={crm.fields ? listId : undefined}
                value={key}
                disabled={disabled || lockedRow}
                onChange={(e) => rename(key, e.target.value.trim())}
                aria-label="Campo do CRM"
                placeholder={crm.fields ? 'Digite o nome ou o código do campo' : 'CÓDIGO DO CAMPO'}
              />
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                disabled={disabled || lockedRow}
                onClick={() =>
                  onChange(Object.fromEntries(entries.filter(([other]) => other !== key)))
                }
                aria-label={`Remover o campo ${field?.label ?? key}`}
              >
                <CloseIcon className="size-4" />
              </button>
            </div>
            {crm.fields && key !== '' && !field && (
              <p className="mb-2 text-xs text-amber-800">
                Campo não encontrado no CRM deste portal. Confira o código.
              </p>
            )}
            <TemplateInput
              label={field ? `${field.label} (${key})` : key || 'Valor'}
              value={value}
              disabled={disabled || key === ''}
              onChange={(next) => setValue(key, next)}
            />
            {field?.options && field.options.length > 0 && (
              <OptionsLegend
                options={field.options}
                disabled={disabled}
                onPick={(id) => setValue(key, id)}
              />
            )}
          </div>
        );
      })}
      <button
        type="button"
        className={buttonClass('secondary', 'sm')}
        disabled={disabled || '' in fields}
        onClick={() => onChange({ ...fields, '': '' })}
      >
        <PlusIcon className="size-3.5" />
        Campo
      </button>
      {entity && !crm.fields && !crm.failed && (
        <p className="text-xs text-zinc-500">Carregando os campos do CRM…</p>
      )}
      {(!entity || crm.failed) && (
        <p className="text-xs text-zinc-500">
          {entity
            ? 'Não foi possível ler os campos do CRM; informe os códigos (ex.: TITLE, NAME, PHONE, UF_CRM_...).'
            : 'Informe os nomes dos parâmetros como estão no modelo do processo.'}
        </p>
      )}
    </div>
  );
}

const STAGE_SUFFIX: Record<string, string> = { success: ' (ganho)', failure: ' (perdido)' };

/**
 * Funil e etapa do negócio novo, escolhidos nas listas do portal; trocar o funil limpa a etapa
 * (a de outro funil seria inválida). Sem as listas (fora do Bitrix, sem permissão), digitados.
 */
function PipelineStageFields({
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

function ResponsiblePicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
}) {
  const [name, setName] = useState<string | null>(null);
  const canPick = insideBitrix();
  return (
    <Field label="Responsável" hint={canPick ? undefined : 'Informe o id do usuário no Bitrix24.'}>
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

function ActionConfig({
  action,
  onChange,
  disabled,
}: {
  action: Action;
  onChange: (action: Action) => void;
  disabled?: boolean;
}) {
  switch (action.type) {
    case 'CREATE_LEAD':
      return (
        <FieldMapEditor
          entity="lead"
          fields={action.config.fields}
          locked={['TITLE']}
          disabled={disabled}
          onChange={(fields) => onChange({ ...action, config: { fields } })}
        />
      );
    case 'UPSERT_DEAL':
      return (
        <div className="space-y-4">
          <PipelineStageFields
            categoryId={action.config.categoryId}
            stageId={action.config.stageId}
            disabled={disabled}
            onChange={(next) => onChange({ ...action, config: { ...action.config, ...next } })}
          />
          <FieldMapEditor
            entity="deal"
            fields={action.config.fields}
            disabled={disabled}
            onChange={(fields) => onChange({ ...action, config: { ...action.config, fields } })}
          />
        </div>
      );
    case 'TIMELINE_COMMENT':
      return (
        <TemplateInput
          label="Comentário"
          multiline
          value={action.config.text}
          disabled={disabled}
          onChange={(text) => onChange({ ...action, config: { text } })}
          hint="Vai para o negócio, lead, contato ou empresa vinculado ao diálogo."
        />
      );
    case 'CREATE_TASK':
      return (
        <div className="space-y-4">
          <TemplateInput
            label="Título"
            value={action.config.title}
            disabled={disabled}
            onChange={(title) => onChange({ ...action, config: { ...action.config, title } })}
          />
          <TemplateInput
            label="Descrição"
            multiline
            value={action.config.description ?? ''}
            disabled={disabled}
            onChange={(description) =>
              onChange({
                ...action,
                config: { ...action.config, description: description || undefined },
              })
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <ResponsiblePicker
              value={action.config.responsibleId}
              disabled={disabled}
              onChange={(responsibleId) =>
                onChange({ ...action, config: { ...action.config, responsibleId } })
              }
            />
            <Field label="Prazo (dias)" hint="Em branco: sem prazo.">
              <input
                type="number"
                min={0}
                max={365}
                className={inputClass}
                value={action.config.deadlineDays ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...action,
                    config: {
                      ...action.config,
                      deadlineDays: e.target.value === '' ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
        </div>
      );
    case 'START_BIZPROC':
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Modelo do processo (id)">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={action.config.templateId || ''}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...action,
                    config: { ...action.config, templateId: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Rodar em">
              <select
                className={inputClass}
                value={action.config.documentType}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...action,
                    config: {
                      ...action.config,
                      documentType: e.target.value as typeof action.config.documentType,
                    },
                  })
                }
              >
                <option value="DEAL">Negócio do diálogo</option>
                <option value="LEAD">Lead do diálogo</option>
                <option value="CONTACT">Contato do diálogo</option>
                <option value="COMPANY">Empresa do diálogo</option>
              </select>
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-800">Parâmetros (opcional)</p>
            <FieldMapEditor
              fields={action.config.parameters ?? {}}
              disabled={disabled}
              onChange={(parameters) =>
                onChange({
                  ...action,
                  config: {
                    ...action.config,
                    parameters: Object.keys(parameters).length ? parameters : undefined,
                  },
                })
              }
            />
          </div>
        </div>
      );
    case 'OUTBOUND_WEBHOOK':
      return (
        <Field
          label="URL"
          hint="Recebe um POST JSON com o evento, assinado no cabeçalho X-GPTMaker-Signature."
        >
          <input
            type="url"
            className={inputClass}
            placeholder="https://"
            value={action.config.url}
            disabled={disabled}
            onChange={(e) => onChange({ ...action, config: { url: e.target.value } })}
          />
        </Field>
      );
  }
}

/** Texto do primeiro problema de validação, com o lugar onde está. */
function firstIssue(input: unknown, actionCount: number): string | null {
  const result = createTriggerSchema.safeParse(input);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  const [root, index] = issue.path;
  const where =
    root === 'name'
      ? 'Nome'
      : root === 'actions' && typeof index === 'number' && index < actionCount
        ? `Ação ${index + 1}`
        : root === 'actions'
          ? 'Ações'
          : 'Gatilho';
  // As mensagens do contrato são em pt-BR; as genéricas do zod (em inglês) viram um aviso simples.
  const generic = /^(Too |Invalid|Expected|Unrecognized)/.test(issue.message);
  return `${where}: ${generic ? 'revise este campo' : issue.message}`;
}

/** Criar ou editar um gatilho: evento e ações na ordem. */
export function TriggerEditor({
  agentId,
  trigger,
  onClose,
  onSaved,
}: {
  agentId: string;
  trigger: TriggerView | null;
  onClose: () => void;
  onSaved: (result: TriggerWriteResult) => void;
}) {
  const { api } = useAppSession();
  const [name, setName] = useState(trigger?.name ?? '');
  const [event, setEvent] = useState<AgentEventName>(trigger?.event ?? 'onFinishInteraction');
  const [active, setActive] = useState(trigger?.active ?? true);
  const [actions, setActions] = useState<Action[]>(
    trigger?.actions.map(
      (action) => ({ id: action.id, type: action.type, config: action.config }) as Action,
    ) ?? [newAction('TIMELINE_COMMENT')],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, action: Action) =>
    setActions((list) => list.map((current, i) => (i === index ? action : current)));
  const move = (index: number, delta: number) =>
    setActions((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });

  async function save() {
    const body = { name, event, active, actions };
    const problem = firstIssue(body, actions.length);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const base = `/app/agents/${agentId}/triggers`;
      const result = await api<TriggerWriteResult>(trigger ? `${base}/${trigger.id}` : base, {
        method: trigger ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved(result);
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível salvar o gatilho. Tente de novo.'));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={trigger ? 'Editar gatilho' : 'Novo gatilho'}
      description="Quando o evento acontecer, as ações rodam no Bitrix24 nesta ordem."
      onRequestClose={() => !saving && onClose()}
      footer={
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={active}
              disabled={saving}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 rounded border-zinc-300 text-brand-600"
            />
            Ativo
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={buttonClass('secondary')}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={buttonClass('primary')}
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <input
            className={inputClass}
            value={name}
            maxLength={120}
            autoFocus
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Lead ao fim do atendimento"
          />
        </Field>
        <Field label="Quando" hint={AGENT_EVENTS[event].description}>
          <select
            className={inputClass}
            value={event}
            disabled={saving}
            onChange={(e) => setEvent(e.target.value as AgentEventName)}
          >
            {agentEventSchema.options.map((option) => (
              <option key={option} value={option}>
                {AGENT_EVENTS[option].label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <h3 className="mt-6 mb-3 text-sm font-semibold text-zinc-900">Ações</h3>
      <ol className="space-y-3">
        {actions.map((action, index) => (
          <li key={action.id ?? `nova-${index}`}>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {index + 1}. {ACTION_TYPES[action.type].label}
                  </p>
                  <p className="text-xs text-zinc-500">{ACTION_TYPES[action.type].description}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={buttonClass('ghost', 'sm')}
                    disabled={saving || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Mover para cima"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={buttonClass('ghost', 'sm')}
                    disabled={saving || index === actions.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Mover para baixo"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={buttonClass('ghost-danger', 'sm')}
                    disabled={saving || actions.length === 1}
                    onClick={() => setActions((list) => list.filter((_, i) => i !== index))}
                  >
                    Remover
                  </button>
                </div>
              </div>
              <ActionConfig
                action={action}
                disabled={saving}
                onChange={(next) => update(index, next)}
              />
            </Card>
          </li>
        ))}
      </ol>
      {actions.length < TRIGGER_MAX_ACTIONS && (
        <select
          className={`${buttonClass('secondary', 'sm')} mt-3 pr-2`}
          value=""
          disabled={saving}
          onChange={(e) => {
            if (!e.target.value) return;
            setActions((list) => [...list, newAction(e.target.value as TriggerActionType)]);
          }}
          aria-label="Adicionar ação"
        >
          <option value="">+ Adicionar ação</option>
          {triggerActionTypeSchema.options.map((type) => (
            <option key={type} value={type}>
              {ACTION_TYPES[type].label}
            </option>
          ))}
        </select>
      )}
    </Modal>
  );
}
