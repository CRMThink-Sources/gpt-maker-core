'use client';

import {
  CRM_ENTITY_LABELS,
  CRM_FIELD_DESCRIPTION_MAX,
  type CrmCatalogView,
  type CrmEntity,
  type CrmFieldView,
  crmFieldSettingInputSchema,
} from '@gptmaker/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertIcon, PencilIcon, PlusIcon, RefreshIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import {
  buildAgentPreview,
  CRM_ENTITY_TABS,
  CRM_ENTITY_USAGE,
  crmErrorMessage,
  crmFeatureOff,
  crmUnavailable,
  fieldTypeLabel,
  getCrmCatalog,
  refreshCrmCatalog,
  saveCrmField,
  summarizeOptions,
} from '@/lib/crm';
import { formatDateTime } from '@/lib/triggers';
import { inputClass } from '../agents/agent-fields';
import { useAppSession } from '../session-provider';

type LoadError = { kind: 'off' } | { kind: 'error'; message: string; retry: boolean };

/** Telefone e e-mail: dados pessoais, só se o agente realmente precisar. */
const PERSONAL_TYPES = new Set(['crm_multifield']);

/** Sem acento e sem caixa, para a busca de campos. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** "CRM para o agente": o que o agente pode ler do Bitrix24 e o que cada campo significa. */
export default function CrmPage() {
  const { session, api } = useAppSession();
  const [catalog, setCatalog] = useState<CrmCatalogView | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [tab, setTab] = useState<CrmEntity>('contact');
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  // Remonta as linhas depois de recarregar o catálogo (descarta rascunhos antigos).
  const [version, setVersion] = useState(0);

  const canManage = session.canManage;

  const load = useCallback(async () => {
    try {
      setCatalog(await getCrmCatalog(api));
      setLoadError(null);
    } catch (e) {
      setLoadError(
        crmFeatureOff(e)
          ? { kind: 'off' }
          : {
              kind: 'error',
              message: crmErrorMessage(e, 'Não foi possível carregar os campos do CRM.'),
              retry: true,
            },
      );
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    getCrmCatalog(api)
      .then((data) => !cancelled && setCatalog(data))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setLoadError(
            crmFeatureOff(e)
              ? { kind: 'off' }
              : {
                  kind: 'error',
                  message: crmErrorMessage(e, 'Não foi possível carregar os campos do CRM.'),
                  retry: true,
                },
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function retry() {
    setLoadError(null);
    await load();
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshed(false);
    try {
      setCatalog(await refreshCrmCatalog(api));
      setVersion((v) => v + 1);
      setRefreshed(true);
    } catch (e) {
      setRefreshError(
        crmUnavailable(e)
          ? 'O Bitrix24 não respondeu agora. Os campos abaixo são da última leitura; tente de novo em instantes.'
          : crmErrorMessage(e, 'Não foi possível atualizar do Bitrix24. Tente de novo.'),
      );
    } finally {
      setRefreshing(false);
    }
  }

  /** Atualiza o catálogo com o campo salvo (entra ou sai da lista do agente). */
  const onFieldSaved = useCallback((field: CrmFieldView) => {
    setCatalog((current) =>
      current
        ? {
            ...current,
            fields: current.fields.map((f) =>
              f.entity === field.entity && f.code === field.code ? field : f,
            ),
          }
        : current,
    );
  }, []);

  const header = (
    <PageHeader
      title="CRM para o agente"
      description="Escolha os campos do Bitrix24 que o agente pode ler e explique o que cada um significa no seu negócio."
      actions={
        canManage &&
        catalog && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className={buttonClass('secondary')}
          >
            {refreshing ? <Spinner className="size-4" /> : <RefreshIcon className="size-4" />}
            {refreshing ? 'Atualizando…' : 'Atualizar do Bitrix24'}
          </button>
        )
      }
    />
  );

  if (loadError?.kind === 'off') {
    return (
      <>
        {header}
        <Alert tone="warning">O acesso do agente ao CRM ainda não está disponível.</Alert>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        {header}
        <Alert tone="error">
          <p>{loadError.message}</p>
          <button
            type="button"
            onClick={retry}
            className={`${buttonClass('secondary', 'sm')} mt-2`}
          >
            Tentar de novo
          </button>
        </Alert>
      </>
    );
  }

  if (!catalog) {
    return (
      <>
        {header}
        <Loading label="Lendo os campos do seu Bitrix24…" />
      </>
    );
  }

  const tabs = CRM_ENTITY_TABS.map((entity) => ({
    id: entity,
    label: CRM_ENTITY_LABELS[entity],
    count: catalog.fields.filter((field) => field.entity === entity && field.exposed).length,
  }));

  return (
    <>
      {header}

      {!canManage && (
        <Alert tone="warning" className="mb-6">
          Você pode consultar estas configurações. Para alterá-las, peça acesso a um administrador.
        </Alert>
      )}
      {refreshError && (
        <Alert tone="error" className="mb-6">
          {refreshError}
        </Alert>
      )}
      {refreshed && (
        <Alert tone="success" className="mb-6">
          Campos atualizados do Bitrix24.
        </Alert>
      )}

      <HowItWorks />

      <nav
        className="mb-5 flex flex-wrap gap-6 border-b border-zinc-200"
        aria-label="Seções do CRM"
        role="tablist"
      >
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`-mb-px border-b-2 pb-3 text-sm font-medium transition-colors ${
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800'
              }`}
            >
              {item.label}
              <span className="ml-1.5 text-xs font-normal text-zinc-400">{item.count}</span>
            </button>
          );
        })}
      </nav>

      <EntityTab
        key={`${version}:${tab}`}
        entity={tab}
        fields={catalog.fields.filter((field) => field.entity === tab)}
        canManage={canManage}
        onAdd={() => setAdding(true)}
        onSaved={onFieldSaved}
      />

      <p className="mt-6 text-xs text-zinc-400">
        Dados lidos do Bitrix24 em {formatDateTime(catalog.loadedAt)}.
      </p>

      {adding && (
        <AddFieldsModal
          entity={tab}
          // Campo que sumiu do portal não pode ser adicionado de novo.
          fields={catalog.fields.filter(
            (field) => field.entity === tab && !field.exposed && field.available,
          )}
          onSaved={onFieldSaved}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

const STEPS = [
  {
    title: 'Escolha os campos',
    text: 'Só os campos adicionados aqui chegam ao agente. O resto do Bitrix24 fica invisível para ele.',
  },
  {
    title: 'Explique o que significam',
    text: 'A descrição diz ao agente como interpretar o campo no seu negócio.',
  },
];

/** Os dois passos da tela, para quem chega sem saber para que ela serve. */
function HowItWorks() {
  return (
    <ol className="mb-6 grid gap-3 sm:grid-cols-2">
      {STEPS.map((step, index) => (
        <li
          key={step.title}
          className="flex gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {index + 1}
          </span>
          <div>
            <p className="text-sm font-medium text-zinc-900">{step.title}</p>
            <p className="mt-0.5 text-sm text-zinc-600">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Exemplo fictício do que o agente recebe com os campos expostos da entidade. */
function AgentPreview({ entity, fields }: { entity: CrmEntity; fields: CrmFieldView[] }) {
  const lines = buildAgentPreview(fields);
  return (
    <Card className="mt-4 p-5">
      <p className="text-sm font-medium text-zinc-900">O que o agente recebe</p>
      <p className="mt-0.5 text-xs text-zinc-500">
        Exemplo com valores fictícios, não é um cliente real.
      </p>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          O agente não recebe dados de {CRM_ENTITY_LABELS[entity].toLowerCase()}.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5 rounded-lg bg-zinc-50 p-3 font-mono text-xs text-zinc-700">
          {lines.map((line) => (
            <li key={line.label}>
              <span className="text-zinc-900">{line.label}:</span> {line.example}
              {line.description && <span className="text-zinc-500"> ({line.description})</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Campos que o agente lê numa entidade, com o botão de adicionar. */
function EntityTab({
  entity,
  fields,
  canManage,
  onAdd,
  onSaved,
}: {
  entity: CrmEntity;
  fields: CrmFieldView[];
  canManage: boolean;
  onAdd: () => void;
  onSaved: (field: CrmFieldView) => void;
}) {
  const added = fields.filter((field) => field.exposed);
  const availableCount = fields.filter((field) => !field.exposed && field.available).length;
  const entityLabel = CRM_ENTITY_LABELS[entity].toLowerCase();

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-700">{CRM_ENTITY_USAGE[entity]}</p>
          <p className="text-xs text-zinc-500">
            {added.length === 1 ? 'O agente lê 1 campo' : `O agente lê ${added.length} campos`} de{' '}
            {entityLabel}.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={onAdd}
            disabled={availableCount === 0}
            title={availableCount === 0 ? 'Todos os campos já foram adicionados' : undefined}
            className={buttonClass('primary', 'sm')}
          >
            <PlusIcon className="size-3.5" />
            Adicionar campos
          </button>
        )}
      </div>
      <Card>
        {added.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            O agente ainda não lê nenhum campo de {entityLabel}.
            {canManage && ' Use "Adicionar campos" para escolher.'}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {added.map((field) => (
              <AddedFieldRow
                key={`${field.entity}:${field.code}`}
                field={field}
                readOnly={!canManage}
                onSaved={onSaved}
              />
            ))}
          </ul>
        )}
      </Card>
      <AgentPreview entity={entity} fields={added} />
    </section>
  );
}

/** Nome, selos e uma linha com tipo e valores aceitos; o código técnico fica só na dica do nome. */
function FieldSummary({ field }: { field: CrmFieldView }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p
          className="text-sm font-medium text-zinc-900"
          title={`Código no Bitrix24: ${field.code}`}
        >
          {field.label}
        </p>
        {field.custom && <Badge tone="brand">Personalizado</Badge>}
        {PERSONAL_TYPES.has(field.type) && <Badge tone="amber">Dado pessoal</Badge>}
        {!field.available && <Badge tone="amber">Não existe mais no portal</Badge>}
      </div>
      <p className="mt-0.5 truncate text-xs text-zinc-500">
        {fieldTypeLabel(field.type)}
        {field.options.length > 0 && (
          <span title={field.options.join(', ')}>: {summarizeOptions(field.options, 4)}</span>
        )}
      </p>
    </div>
  );
}

/**
 * Campo que o agente lê, compacto: a descrição aparece como texto e só vira caixa de edição ao
 * clicar no lápis (ou em "Adicionar descrição"). "Remover" tira o campo da leitura do agente; a
 * descrição fica guardada para quando ele for adicionado de novo.
 */
function AddedFieldRow({
  field,
  readOnly,
  onSaved,
}: {
  field: CrmFieldView;
  readOnly: boolean;
  onSaved: (field: CrmFieldView) => void;
}) {
  const { api } = useAppSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.description);
  const [busy, setBusy] = useState<'description' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const descriptionId = `crm-desc-${field.entity}-${field.code}`;

  async function save(next: { exposed: boolean; description: string }) {
    const parsed = crmFieldSettingInputSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise a descrição.');
      return;
    }
    setBusy(next.exposed ? 'description' : 'remove');
    setError(null);
    try {
      const saved = await saveCrmField(api, field.entity, field.code, parsed.data);
      setEditing(false);
      // Removido: a linha sai da lista quando o catálogo é atualizado.
      onSaved(saved);
    } catch (e) {
      setError(crmErrorMessage(e, 'Não foi possível salvar este campo. Tente de novo.'));
    } finally {
      setBusy(null);
    }
  }

  function startEditing() {
    setDraft(field.description);
    setError(null);
    setEditing(true);
  }

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-4">
        <FieldSummary field={field} />
        {!readOnly && (
          <button
            type="button"
            onClick={() => save({ exposed: false, description: field.description })}
            disabled={busy !== null}
            className={buttonClass('ghost-danger', 'sm')}
          >
            {busy === 'remove' && <Spinner className="size-3.5" />}
            {busy === 'remove' ? 'Removendo…' : 'Remover'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2.5">
          <label htmlFor={descriptionId} className="sr-only">
            Descrição de {field.label} para o agente
          </label>
          <textarea
            id={descriptionId}
            className={`${inputClass} mt-0 min-h-16`}
            maxLength={CRM_FIELD_DESCRIPTION_MAX}
            autoFocus
            placeholder='Ex.: "Plano contratado pelo cliente; Ouro dá direito a suporte 24h"'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-zinc-500">
              {draft.length}/{CRM_FIELD_DESCRIPTION_MAX}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy !== null}
                className={buttonClass('ghost', 'sm')}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => save({ exposed: true, description: draft })}
                disabled={busy !== null || draft.trim() === field.description.trim()}
                className={buttonClass('primary', 'sm')}
              >
                {busy === 'description' && <Spinner className="size-3.5" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : field.description ? (
        <div className="mt-1.5 flex items-start gap-1.5">
          <p className="text-sm text-zinc-600">{field.description}</p>
          {!readOnly && (
            <button
              type="button"
              onClick={startEditing}
              className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label={`Editar a descrição de ${field.label}`}
              title="Editar descrição"
            >
              <PencilIcon className="size-3.5" />
            </button>
          )}
        </div>
      ) : !field.custom ? (
        // Campo padrão se explica pelo nome: sem aviso, só o link discreto.
        !readOnly && (
          <button
            type="button"
            onClick={startEditing}
            className="mt-1 text-xs font-medium text-brand-700 hover:underline"
          >
            + Adicionar descrição
          </button>
        )
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="flex items-center gap-1.5">
            <AlertIcon className="size-3.5 shrink-0" />
            Sem descrição: explique o que este campo significa no seu negócio.
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={startEditing}
              className="font-medium text-amber-900 underline hover:no-underline"
            >
              Escrever descrição
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Escolha de campos para o agente ler: busca, seleção múltipla e confirmação única. Os salvamentos
 * vão um por vez; os que falham continuam marcados para tentar de novo.
 */
function AddFieldsModal({
  entity,
  fields,
  onSaved,
  onClose,
}: {
  entity: CrmEntity;
  fields: CrmFieldView[];
  onSaved: (field: CrmFieldView) => void;
  onClose: () => void;
}) {
  const { api } = useAppSession();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const wanted = normalize(query.trim());
    if (!wanted) return fields;
    return fields.filter(
      (field) => normalize(field.label).includes(wanted) || normalize(field.code).includes(wanted),
    );
  }, [fields, query]);

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    const failed = new Set<string>();
    for (const field of fields.filter((item) => selected.has(item.code))) {
      try {
        // A descrição guardada volta junto quando o campo já foi adicionado antes.
        onSaved(
          await saveCrmField(api, field.entity, field.code, {
            exposed: true,
            description: field.description,
          }),
        );
      } catch {
        failed.add(field.code);
      }
    }
    setSaving(false);
    if (!failed.size) {
      onClose();
      return;
    }
    setSelected(failed);
    setError(
      failed.size === 1
        ? 'Não foi possível adicionar 1 campo. Ele continua marcado; tente de novo.'
        : `Não foi possível adicionar ${failed.size} campos. Eles continuam marcados; tente de novo.`,
    );
  }

  const count = selected.size;

  return (
    <Modal
      title={`Adicionar campos de ${CRM_ENTITY_LABELS[entity].toLowerCase()}`}
      description="Marque os campos do seu Bitrix24 que o agente pode ler."
      onRequestClose={() => !saving && onClose()}
      header={
        <div className="mt-3">
          <label htmlFor="crm-field-search" className="sr-only">
            Buscar campo
          </label>
          <input
            id="crm-field-search"
            type="search"
            autoFocus
            className={`${inputClass} mt-0`}
            placeholder="Buscar pelo nome ou código do campo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-zinc-500">
            {count === 0
              ? 'Nenhum selecionado'
              : count === 1
                ? '1 selecionado'
                : `${count} selecionados`}
          </span>
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
              onClick={confirm}
              disabled={saving || count === 0}
              className={buttonClass('primary')}
            >
              {saving && <Spinner className="size-4" />}
              {saving
                ? 'Adicionando…'
                : count > 1
                  ? `Adicionar ${count} campos`
                  : 'Adicionar campo'}
            </button>
          </div>
        </div>
      }
    >
      <p className="mb-4 text-xs text-zinc-500">
        Depois de adicionar, descreva o que cada campo significa no seu negócio. Telefone e e-mail
        são dados pessoais: adicione só se o agente realmente precisar deles.
      </p>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          {fields.length === 0
            ? 'Todos os campos já foram adicionados.'
            : 'Nenhum campo encontrado com essa busca.'}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {filtered.map((field) => (
            <li key={field.code}>
              <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-zinc-50">
                <input
                  type="checkbox"
                  checked={selected.has(field.code)}
                  onChange={() => toggle(field.code)}
                  disabled={saving}
                  className="mt-0.5 size-4 rounded border-zinc-300 text-brand-600"
                />
                <FieldSummary field={field} />
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
