'use client';

import {
  type IntentionActionInput,
  INTENTION_MAX_FIELDS,
  INTENTION_MAX_PAIRS,
  type IntentionFieldType,
  type IntentionInput,
  intentionInputSchema,
  intentionJsonName,
  type IntentionView,
} from '@gptmaker/contracts';
import { useRef, useState } from 'react';
import { CloseIcon, PlusIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, buttonClass } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { newAction, SAMPLE_CONTEXT } from '@/lib/triggers';
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
      fields: [{ name: '', description: '', type: 'STRING', required: true }],
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

/** Problemas de validação em linguagem de tela (`Campo 2: ...`). */
function issuesOf(form: Form): string[] {
  const result = intentionInputSchema.safeParse(form);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const [root, index] = issue.path;
    const label = SECTION_LABELS[String(root)] ?? String(root);
    return typeof index === 'number'
      ? `${label} ${index + 1}: ${issue.message}`
      : `${label}: ${issue.message}`;
  });
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

/** Cadastro e edição de intenção: o que o agente coleta, a API que chama e como responde. */
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
  const [tab, setTab] = useState<'headers' | 'params' | 'body'>('params');
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const setField = (index: number, patch: Partial<FieldRow>) =>
    set(
      'fields',
      form.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );

  async function save() {
    const problems = issuesOf(form);
    setIssues(problems);
    setError(null);
    if (problems.length) return;
    setBusy(true);
    try {
      const base = `/app/agents/${agentId}/intentions`;
      await api(intention ? `${base}/${intention.id}` : base, {
        method: intention ? 'PUT' : 'POST',
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível salvar a intenção.'));
      setBusy(false);
    }
  }

  const tabs = [
    { key: 'params' as const, label: `Parâmetros (${form.params.length})` },
    { key: 'headers' as const, label: `Cabeçalhos (${form.headers.length})` },
    ...(form.httpMethod === 'POST' ? [{ key: 'body' as const, label: 'Corpo' }] : []),
  ];

  return (
    <Modal
      title={intention ? 'Editar intenção' : 'Nova intenção'}
      description="O agente coleta as informações na conversa, chama a sua API e responde ao cliente com o resultado."
      onRequestClose={() => !busy && onClose()}
      footer={
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            Ativa
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={buttonClass('secondary')}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className={buttonClass('primary')}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <section className="space-y-4">
          <Field label="1. Nome da intenção" hint="Curto e único neste agente.">
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Consultar status do pedido"
              maxLength={255}
              className={inputClass}
              autoFocus
            />
          </Field>
          <Field
            label="Quando usar"
            hint="O agente lê isto para decidir chamar a intenção. Seja específico."
          >
            <textarea
              value={form.whenToUse}
              onChange={(e) => set('whenToUse', e.target.value)}
              placeholder="Quando o cliente perguntar onde está o pedido ou qual o prazo de entrega"
              className={`${inputClass} min-h-20`}
            />
          </Field>
        </section>

        <section>
          <h3 className="text-sm font-medium text-zinc-800">2. Informações que o agente coleta</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            O agente pergunta ao cliente o que faltar. Use o campo na chamada como{' '}
            <code className="rounded bg-zinc-100 px-1">{'{{nome_do_campo}}'}</code>.
          </p>
          <div className="mt-3 space-y-3">
            {form.fields.map((field, index) => (
              <div key={index} className="rounded-lg border border-zinc-200 p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <input
                    value={field.name}
                    onChange={(e) => setField(index, { name: e.target.value })}
                    placeholder="Número do pedido"
                    aria-label={`Nome do campo ${index + 1}`}
                    maxLength={60}
                    className={`${inputClass} mt-0 min-w-40 flex-1`}
                  />
                  <select
                    value={field.type}
                    onChange={(e) =>
                      setField(index, { type: e.target.value as IntentionFieldType })
                    }
                    aria-label={`Tipo do campo ${index + 1}`}
                    className={`${inputClass} mt-0 w-36`}
                  >
                    {Object.entries(FIELD_TYPES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 py-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => setField(index, { required: e.target.checked })}
                    />
                    Obrigatório
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
                    aria-label={`Remover campo ${index + 1}`}
                  >
                    <CloseIcon className="size-4" />
                  </button>
                </div>
                <input
                  value={field.description}
                  onChange={(e) => setField(index, { description: e.target.value })}
                  placeholder="O que é e como pedir ao cliente. Ex.: número do pedido, 6 dígitos"
                  aria-label={`Descrição do campo ${index + 1}`}
                  maxLength={500}
                  className={`${inputClass} mt-2`}
                />
                {intentionJsonName(field.name) && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Na chamada:{' '}
                    <code className="rounded bg-zinc-100 px-1">{`{{${intentionJsonName(field.name)}}}`}</code>
                  </p>
                )}
              </div>
            ))}
            {form.fields.length < INTENTION_MAX_FIELDS && (
              <button
                type="button"
                onClick={() =>
                  set('fields', [
                    ...form.fields,
                    { name: '', description: '', type: 'STRING', required: true },
                  ])
                }
                className={buttonClass('ghost', 'sm')}
              >
                <PlusIcon className="size-4" />
                Adicionar campo
              </button>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-medium text-zinc-800">3. O que a intenção faz</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(
              [
                [
                  'BITRIX',
                  'Ação no Bitrix24',
                  'Cria lead, negócio, tarefa ou comentário no CRM, como nos gatilhos',
                ],
                ['WEBHOOK', 'Chamar uma API', 'Consulta ou envia dados para um sistema seu'],
              ] as const
            ).map(([kind, title, description]) => (
              <button
                key={kind}
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    kind,
                    actions:
                      kind === 'BITRIX' && !current.actions.length
                        ? [newAction('CREATE_LEAD') as IntentionActionInput]
                        : current.actions,
                  }))
                }
                className={`rounded-lg border p-3 text-left text-sm ${
                  form.kind === kind
                    ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                    : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <span className="font-medium text-zinc-900">{title}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">{description}</span>
              </button>
            ))}
          </div>
        </section>

        {form.kind === 'BITRIX' ? (
          <section>
            <h3 className="text-sm font-medium text-zinc-800">Ações no Bitrix24</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Rodam na hora, nesta ordem, com o acesso do app ao seu portal. Use as informações
              coletadas em{' '}
              <code className="rounded bg-zinc-100 px-1">{'{{fields.nome_do_campo}}'}</code>.
              Comentário e negócio usam o cliente do atendimento.
            </p>
            <TemplateScopeProvider
              value={{
                extra: form.fields
                  .map((field) => ({ json: intentionJsonName(field.name), name: field.name }))
                  .filter((field) => field.json)
                  .map((field) => ({
                    path: `fields.${field.json}`,
                    description: `Coletado: ${field.name}`,
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
              <div className="mt-3">
                <ActionsEditor
                  actions={form.actions as IntentionActionInput[]}
                  onChange={(actions) => set('actions', actions)}
                  disabled={busy}
                  types={BITRIX_ACTIONS}
                />
              </div>
            </TemplateScopeProvider>
          </section>
        ) : (
          <section>
            <h3 className="text-sm font-medium text-zinc-800">Chamada à API</h3>
            <div className="mt-2 flex items-start gap-2">
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
                    />
                    O agente monta os parâmetros sozinho a partir das informações coletadas
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
                    />
                    O agente monta o corpo sozinho a partir das informações coletadas
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
          </section>
        )}

        <section>
          <h3 className="text-sm font-medium text-zinc-800">4. Resposta do agente baseada em</h3>
          <div className="mt-2 space-y-2 text-sm text-zinc-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="responseMode"
                checked={form.responseMode === 'API'}
                onChange={() => set('responseMode', 'API')}
              />
              {form.kind === 'BITRIX'
                ? 'No resultado das ações (ex.: "lead criado")'
                : 'No retorno da API (o agente interpreta e responde)'}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="responseMode"
                checked={form.responseMode === 'INSTRUCTIONS'}
                onChange={() => set('responseMode', 'INSTRUCTIONS')}
              />
              Em uma instrução customizada
            </label>
          </div>
          {form.responseMode === 'INSTRUCTIONS' && (
            <textarea
              value={form.instructions ?? ''}
              onChange={(e) => set('instructions', e.target.value || null)}
              placeholder="Informe ao cliente o status e a previsão de entrega, sem mostrar códigos internos"
              aria-label="Instrução de resposta"
              className={`${inputClass} min-h-20`}
            />
          )}
        </section>

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
