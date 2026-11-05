'use client';

import {
  type IntentionActionInput,
  INTENTION_MAX_FIELDS,
  INTENTION_NAME_MAX,
  INTENTION_WHEN_TO_USE_MAX,
  INTENTION_MAX_PAIRS,
  type IntentionFieldType,
  type IntentionInput,
  intentionInputSchema,
  intentionJsonName,
  type IntentionView,
} from '@gptmaker/contracts';
import { useRef, useState } from 'react';
import { BoltIcon, CloseIcon, GlobeIcon, PlusIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Stepper } from '@/components/stepper';
import { Alert, buttonClass } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { ACTION_TYPES, newAction, SAMPLE_CONTEXT } from '@/lib/triggers';
import { useAppSession } from '../../../session-provider';
import { Field, inputClass } from '../../agent-fields';
import { ActionsEditor, TemplateScopeProvider } from '../triggers/trigger-editor';

type Form = Required<IntentionInput>;
type FieldRow = Form['fields'][number];

export const FIELD_TYPES: Record<IntentionFieldType, string> = {
  STRING: 'Texto',
  NUMBER: 'Número',
  BOOLEAN: 'Sim/Não',
  DATE: 'Data',
  DATE_TIME: 'Data e hora',
  URL: 'Link',
};

/** Ações do Bitrix que uma intenção executa (as dos gatilhos, sem o webhook de saída). */
const BITRIX_ACTIONS = [
  'CREATE_LEAD',
  'UPSERT_DEAL',
  'TIMELINE_COMMENT',
  'CREATE_TASK',
  'START_BIZPROC',
  'TRANSFER_TO_HUMAN',
] as const;

const SECTION_LABELS: Record<string, string> = {
  actions: 'Ação',
  name: 'Nome',
  whenToUse: 'Quando usar',
  fields: 'Campo',
  url: 'URL',
  headers: 'Cabeçalho',
  params: 'Parâmetro',
  body: 'Corpo',
  instructions: 'Instrução',
};

/** Formulário a partir da intenção salva; cabeçalho com valor gravado vai como `null` (mantém). */
export function formOf(view: IntentionView | null): Form {
  if (!view) {
    return {
      kind: 'WEBHOOK',
      actions: [],
      name: '',
      whenToUse: '',
      fields: [],
      httpMethod: 'GET',
      url: '',
      headers: [],
      params: [],
      body: null,
      autoGenerateParams: false,
      autoGenerateBody: false,
      responseMode: 'API',
      instructions: null,
      active: true,
    };
  }
  return {
    kind: view.kind,
    actions: view.actions,
    name: view.name,
    whenToUse: view.whenToUse,
    fields: view.fields.map(({ name, description, type, required }) => ({
      name,
      description,
      type,
      required,
    })),
    httpMethod: view.httpMethod,
    url: view.url,
    headers: view.headers.map((header) => ({
      name: header.name,
      value: header.hasValue ? null : '',
    })),
    params: view.params,
    body: view.body,
    autoGenerateParams: view.autoGenerateParams,
    autoGenerateBody: view.autoGenerateBody,
    responseMode: view.responseMode,
    instructions: view.instructions,
    active: view.active,
  };
}

/** Texto com botão para inserir `{{campo}}` onde está o cursor. */
function WithFields({
  value,
  onChange,
  fields,
  multiline,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  fields: FieldRow[];
  multiline?: boolean;
  placeholder?: string;
  label: string;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const names = fields.map((field) => intentionJsonName(field.name)).filter(Boolean);

  function insert(jsonName: string) {
    const placeholderText = `{{${jsonName}}}`;
    const element = ref.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + placeholderText + value.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + placeholderText.length, start + placeholderText.length);
    });
  }

  const Input = multiline ? 'textarea' : 'input';
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1">
      <Input
        ref={ref}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} mt-0 ${multiline ? 'min-h-28 font-mono text-xs' : ''}`}
      />
      {names.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && insert(e.target.value)}
          className="mt-0 shrink-0 rounded-lg border border-zinc-300 bg-white px-1.5 py-2 text-xs text-zinc-600"
          aria-label={`Inserir campo em ${label}`}
        >
          <option value="">+ campo</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {`{{${name}}}`}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Pares nome/valor (cabeçalhos ou parâmetros). */
function Pairs({
  kind,
  rows,
  onChange,
  fields,
}: {
  kind: 'header' | 'param';
  rows: Array<{ name: string; value: string | null }>;
  onChange: (rows: Array<{ name: string; value: string | null }>) => void;
  fields: FieldRow[];
}) {
  const set = (index: number, patch: Partial<{ name: string; value: string | null }>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-2">
          <input
            value={row.name}
            onChange={(e) => set(index, { name: e.target.value })}
            placeholder={kind === 'header' ? 'Authorization' : 'nome'}
            aria-label="Nome"
            className={`${inputClass} mt-0 w-40 shrink-0`}
          />
          {row.value === null ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex-1 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500">
                Valor guardado (oculto)
              </span>
              <button
                type="button"
                onClick={() => set(index, { value: '' })}
                className={buttonClass('ghost', 'sm')}
              >
                Trocar
              </button>
            </div>
          ) : (
            <WithFields
              value={row.value}
              onChange={(value) => set(index, { value })}
              fields={fields}
              label="Valor"
              placeholder="valor"
            />
          )}
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            className={buttonClass('ghost', 'sm')}
            aria-label="Remover"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      ))}
      {rows.length < INTENTION_MAX_PAIRS && (
        <button
          type="button"
          onClick={() => onChange([...rows, { name: '', value: '' }])}
          className={buttonClass('ghost', 'sm')}
        >
          <PlusIcon className="size-4" />
          {kind === 'header' ? 'Adicionar cabeçalho' : 'Adicionar parâmetro'}
        </button>
      )}
      {kind === 'header' && (
        <p className="text-xs text-zinc-500">
          Valores de cabeçalho (como chaves de API) ficam guardados cifrados e não aparecem de novo.
        </p>
      )}
    </div>
  );
}

const STEPS = [
  { title: 'Intenção', description: 'Quando o agente deve usar esta intenção.' },
  {
    title: 'Informações',
    description: 'O que o agente pergunta ao cliente antes de agir (opcional).',
  },
  { title: 'Ação', description: 'O que acontece com as informações coletadas.' },
  { title: 'Resposta', description: 'Como o agente responde ao cliente depois da ação.' },
] as const;

/** Passo de cada parte do formulário (para validar só o que está na tela). */
const STEP_OF: Record<string, number> = {
  name: 0,
  whenToUse: 0,
  fields: 1,
  kind: 2,
  url: 2,
  headers: 2,
  params: 2,
  body: 2,
  actions: 2,
  responseMode: 3,
  instructions: 3,
};

/** Informações deixadas em branco (sem nome nem descrição) são descartadas. */
function withoutBlankFields(form: Form): Form {
  return {
    ...form,
    fields: form.fields.filter((field) => field.name.trim() || field.description?.trim()),
  };
}

function issuesAt(form: Form, step: number): string[] {
  const result = intentionInputSchema.safeParse(withoutBlankFields(form));
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => (STEP_OF[String(issue.path[0])] ?? 3) === step)
    .map((issue) => {
      const [root, index] = issue.path;
      const label = SECTION_LABELS[String(root)] ?? String(root);
      return typeof index === 'number'
        ? `${label} ${index + 1}: ${issue.message}`
        : `${label}: ${issue.message}`;
    });
}

/** Cartão de escolha (tipo da intenção, modo de resposta). */
function Choice({
  selected,
  onSelect,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon?: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        selected
          ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
      }`}
    >
      {icon && (
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
            selected ? 'bg-brand-600 text-white' : 'bg-zinc-100 text-zinc-500'
          }`}
        >
          {icon}
        </span>
      )}
      <span>
        <span className="block text-sm font-medium text-zinc-900">{title}</span>
        <span className="mt-0.5 block text-xs text-zinc-500">{description}</span>
      </span>
    </button>
  );
}

function IntentStep({ form, set }: { form: Form; set: Setter }) {
  return (
    <div className="space-y-5">
      <Field label="Nome" hint="Curto e único neste agente. Ex.: Registrar interesse.">
        <input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Registrar interesse"
          maxLength={INTENTION_NAME_MAX}
          className={inputClass}
          autoFocus
        />
      </Field>
      <Field
        label="Quando usar"
        hint={`É o que o agente lê para decidir usar a intenção. Descreva a situação do cliente, não a ação. ${form.whenToUse.length.toLocaleString('pt-BR')}/${INTENTION_WHEN_TO_USE_MAX.toLocaleString('pt-BR')} caracteres.`}
      >
        <textarea
          value={form.whenToUse}
          maxLength={INTENTION_WHEN_TO_USE_MAX}
          onChange={(e) => set('whenToUse', e.target.value)}
          placeholder="Quando o cliente quiser falar com um vendedor ou pedir um orçamento"
          className={`${inputClass} min-h-28`}
        />
      </Field>
    </div>
  );
}

function FieldsStep({ form, set }: { form: Form; set: Setter }) {
  const setField = (index: number, patch: Partial<FieldRow>) =>
    set(
      'fields',
      form.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  return (
    <div>
      {form.fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500">
          Nenhuma informação: o agente age sem perguntar nada ao cliente.
        </p>
      ) : (
        <ul className="space-y-3">
          {form.fields.map((field, index) => {
            const json = intentionJsonName(field.name);
            return (
              <li key={index} className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-center">
                  <input
                    value={field.name}
                    onChange={(e) => setField(index, { name: e.target.value })}
                    placeholder="Ex.: Produto de interesse"
                    aria-label={`Nome da informação ${index + 1}`}
                    maxLength={60}
                    className={`${inputClass} mt-0`}
                    autoFocus={!field.name && index === form.fields.length - 1}
                  />
                  <select
                    value={field.type}
                    onChange={(e) =>
                      setField(index, { type: e.target.value as IntentionFieldType })
                    }
                    aria-label={`Tipo da informação ${index + 1}`}
                    className={`${inputClass} mt-0`}
                  >
                    {Object.entries(FIELD_TYPES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => setField(index, { required: e.target.checked })}
                      className="size-4 rounded border-zinc-300 text-brand-600"
                    />
                    Obrigatória
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        'fields',
                        form.fields.filter((_, i) => i !== index),
                      )
                    }
                    className={buttonClass('ghost', 'sm')}
                    aria-label={`Remover informação ${index + 1}`}
                  >
                    <CloseIcon className="size-4" />
                  </button>
                </div>
                <input
                  value={field.description ?? ''}
                  onChange={(e) => setField(index, { description: e.target.value })}
                  placeholder="Opcional: como pedir ao cliente. Ex.: qual plano ou produto ele quer conhecer"
                  aria-label={`Descrição da informação ${index + 1}`}
                  maxLength={500}
                  className={`${inputClass} mt-2`}
                />
                {json && (
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Usada como{' '}
                    <code className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-700">
                      {form.kind === 'BITRIX' ? `{{fields.${json}}}` : `{{${json}}}`}
                    </code>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {form.fields.length < INTENTION_MAX_FIELDS && (
        <button
          type="button"
          onClick={() =>
            set('fields', [
              ...form.fields,
              { name: '', description: '', type: 'STRING', required: true },
            ])
          }
          className={`${buttonClass('secondary', 'sm')} mt-3`}
        >
          <PlusIcon className="size-4" />
          Adicionar informação
        </button>
      )}
    </div>
  );
}

function ActionStep({
  form,
  set,
  setForm,
  busy,
}: {
  form: Form;
  set: Setter;
  setForm: (update: (current: Form) => Form) => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState<'params' | 'headers' | 'body'>('params');
  const tabs = [
    { key: 'params' as const, label: `Parâmetros (${form.params.length})` },
    { key: 'headers' as const, label: `Cabeçalhos (${form.headers.length})` },
    ...(form.httpMethod === 'POST' ? [{ key: 'body' as const, label: 'Corpo' }] : []),
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          selected={form.kind === 'BITRIX'}
          onSelect={() =>
            setForm((current) => ({
              ...current,
              kind: 'BITRIX',
              actions: current.actions.length
                ? current.actions
                : [newAction('CREATE_LEAD') as IntentionActionInput],
            }))
          }
          icon={<BoltIcon className="size-5" />}
          title="Ação no Bitrix24"
          description="Lead, negócio, tarefa, comentário ou transferência para um atendente."
        />
        <Choice
          selected={form.kind === 'WEBHOOK'}
          onSelect={() => set('kind', 'WEBHOOK')}
          icon={<GlobeIcon className="size-5" />}
          title="Chamar uma API"
          description="Consulta ou envia dados para um sistema seu."
        />
      </div>

      {form.kind === 'BITRIX' ? (
        <TemplateScopeProvider
          value={{
            extra: form.fields
              .map((field) => ({ json: intentionJsonName(field.name), name: field.name }))
              .filter((field) => field.json)
              .map((field) => ({
                path: `fields.${field.json}`,
                description: `Informação: ${field.name}`,
              })),
            allowFields: true,
            sample: {
              ...SAMPLE_CONTEXT,
              fields: Object.fromEntries(
                form.fields.map((field) => [intentionJsonName(field.name), `(${field.name})`]),
              ),
            },
          }}
        >
          <p className="text-xs text-zinc-500">
            Rodam na hora, nesta ordem, no seu portal. Comentário, negócio e transferência usam a
            conversa em andamento.
          </p>
          <ActionsEditor
            actions={form.actions as IntentionActionInput[]}
            onChange={(actions) => set('actions', actions)}
            disabled={busy}
            types={BITRIX_ACTIONS}
          />
        </TemplateScopeProvider>
      ) : (
        <div>
          <div className="flex items-start gap-2">
            <select
              value={form.httpMethod}
              onChange={(e) => {
                const method = e.target.value as Form['httpMethod'];
                set('httpMethod', method);
                if (method === 'GET' && tab === 'body') setTab('params');
              }}
              aria-label="Método"
              className={`${inputClass} mt-0 w-24 shrink-0`}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
            <WithFields
              value={form.url}
              onChange={(value) => set('url', value)}
              fields={form.fields}
              label="URL"
              placeholder="https://sua-api.com/pedidos/{{numero_do_pedido}}"
            />
          </div>
          <div className="mt-4 flex gap-4 border-b border-zinc-200 text-sm">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`-mb-px border-b-2 pb-2 ${
                  tab === item.key
                    ? 'border-brand-600 font-medium text-brand-700'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {tab === 'params' && (
              <>
                <label className="mb-3 flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={form.autoGenerateParams}
                    onChange={(e) => set('autoGenerateParams', e.target.checked)}
                    className="size-4 rounded border-zinc-300 text-brand-600"
                  />
                  O agente monta os parâmetros sozinho
                </label>
                <Pairs
                  kind="param"
                  rows={form.params}
                  onChange={(rows) =>
                    set(
                      'params',
                      rows.map((row) => ({ name: row.name, value: row.value ?? '' })),
                    )
                  }
                  fields={form.fields}
                />
              </>
            )}
            {tab === 'headers' && (
              <Pairs
                kind="header"
                rows={form.headers}
                onChange={(rows) => set('headers', rows)}
                fields={form.fields}
              />
            )}
            {tab === 'body' && (
              <>
                <label className="mb-3 flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={form.autoGenerateBody}
                    onChange={(e) => set('autoGenerateBody', e.target.checked)}
                    className="size-4 rounded border-zinc-300 text-brand-600"
                  />
                  O agente monta o corpo sozinho
                </label>
                {!form.autoGenerateBody && (
                  <WithFields
                    value={form.body ?? ''}
                    onChange={(value) => set('body', value || null)}
                    fields={form.fields}
                    multiline
                    label="Corpo JSON"
                    placeholder={'{\n  "pedido": "{{numero_do_pedido}}"\n}'}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResponseStep({ form, set }: { form: Form; set: Setter }) {
  const what =
    form.kind === 'BITRIX'
      ? form.actions.map((action) => ACTION_TYPES[action.type].label.toLowerCase()).join(', ')
      : `${form.httpMethod} ${form.url || '(sem URL)'}`;
  const collected = form.fields.map((field) => field.name).filter(Boolean);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          selected={form.responseMode === 'API'}
          onSelect={() => set('responseMode', 'API')}
          title={form.kind === 'BITRIX' ? 'Pelo resultado das ações' : 'Pelo retorno da API'}
          description={
            form.kind === 'BITRIX'
              ? 'O agente confirma o que foi feito, ex.: "registrei seu interesse".'
              : 'O agente interpreta o retorno e responde com as informações.'
          }
        />
        <Choice
          selected={form.responseMode === 'INSTRUCTIONS'}
          onSelect={() => set('responseMode', 'INSTRUCTIONS')}
          title="Por uma instrução sua"
          description="Você escreve como o agente deve responder."
        />
      </div>
      {form.responseMode === 'INSTRUCTIONS' && (
        <Field label="Instrução de resposta">
          <textarea
            value={form.instructions ?? ''}
            onChange={(e) => set('instructions', e.target.value || null)}
            placeholder="Agradeça, diga que um vendedor vai continuar o atendimento e não prometa prazos"
            className={`${inputClass} min-h-24`}
            autoFocus
          />
        </Field>
      )}

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
        <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Resumo</p>
        <p className="mt-2 text-zinc-700">
          <span className="font-medium text-zinc-900">{form.whenToUse || 'Quando…'}</span>
        </p>
        <p className="mt-1 text-zinc-600">
          {collected.length
            ? `O agente pergunta ${collected.join(', ')} e depois `
            : 'O agente, sem perguntar nada, '}
          {form.kind === 'BITRIX'
            ? `faz no Bitrix24: ${what || 'nenhuma ação'}.`
            : `chama ${what}.`}
        </p>
        <label className="mt-3 flex items-center gap-2 text-zinc-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
            className="size-4 rounded border-zinc-300 text-brand-600"
          />
          Intenção ativa
        </label>
      </div>
    </div>
  );
}

type Setter = <K extends keyof Form>(key: K, value: Form[K]) => void;

/** Cadastro e edição de intenção em passos: quando usar, o que coletar, o que fazer e como responder. */
export function IntentionEditor({
  agentId,
  intention,
  onClose,
  onSaved,
}: {
  agentId: string;
  intention: IntentionView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAppSession();
  const [form, setForm] = useState<Form>(() => formOf(intention));
  const [step, setStep] = useState(0);
  // Na edição tudo já está preenchido: todos os passos ficam ao alcance.
  const [reachable, setReachable] = useState(intention ? STEPS.length - 1 : 0);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set: Setter = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const last = step === STEPS.length - 1;

  function go(target: number) {
    setIssues([]);
    setError(null);
    setStep(target);
  }

  async function next() {
    const problems = issuesAt(form, step);
    setIssues(problems);
    if (problems.length) return;
    if (!last) {
      setReachable((current) => Math.max(current, step + 1));
      go(step + 1);
      return;
    }
    // No último passo, confere tudo (o problema pode estar num passo anterior).
    for (let index = 0; index < STEPS.length; index++) {
      const pending = issuesAt(form, index);
      if (pending.length) {
        setStep(index);
        setIssues(pending);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const base = `/app/agents/${agentId}/intentions`;
      await api(intention ? `${base}/${intention.id}` : base, {
        method: intention ? 'PUT' : 'POST',
        body: JSON.stringify(withoutBlankFields(form)),
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível salvar a intenção.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={intention ? `Editar intenção` : 'Nova intenção'}
      description={STEPS[step]!.description}
      header={
        <Stepper
          steps={STEPS}
          current={step}
          reachable={reachable}
          onSelect={busy ? undefined : go}
        />
      }
      onRequestClose={() => !busy && onClose()}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500">
            Passo {step + 1} de {STEPS.length}
          </span>
          <div className="flex gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => go(step - 1)}
                disabled={busy}
                className={buttonClass('secondary')}
              >
                Voltar
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className={buttonClass('secondary')}
              >
                Cancelar
              </button>
            )}
            <button
              type="button"
              onClick={() => void next()}
              disabled={busy}
              className={buttonClass('primary')}
            >
              {busy ? 'Salvando…' : last ? 'Salvar intenção' : 'Avançar'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {step === 0 && <IntentStep form={form} set={set} />}
        {step === 1 && <FieldsStep form={form} set={set} />}
        {step === 2 && <ActionStep form={form} set={set} setForm={setForm} busy={busy} />}
        {step === 3 && <ResponseStep form={form} set={set} />}

        {issues.length > 0 && (
          <Alert tone="error">
            <ul className="list-inside list-disc space-y-0.5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
