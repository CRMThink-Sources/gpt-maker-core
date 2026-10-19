'use client';

import {
  CRM_ENTITY_LABELS,
  CRM_FIELD_DESCRIPTION_MAX,
  type CrmCatalogView,
  type CrmEntity,
  type CrmFieldView,
  crmFieldSettingInputSchema,
  STAGE_SEMANTIC_LABELS,
  type StageSemantic,
} from '@gptmaker/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlusIcon, RefreshIcon } from '@/components/icons';
import {
  Alert,
  Badge,
  buttonClass,
  Card,
  Loading,
  PageHeader,
  Spinner,
  type Tone,
} from '@/components/ui';
import {
  CRM_ENTITY_TABS,
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

const STAGE_TONES: Record<StageSemantic, Tone> = {
  process: 'zinc',
  success: 'green',
  failure: 'amber',
};

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
  const [entity, setEntity] = useState<CrmEntity>('contact');
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

  /** Atualiza o catálogo com o campo salvo (move entre adicionados e disponíveis). */
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
      description="Adicione os campos do seu Bitrix24 que o agente pode ler e explique o que cada um significa no seu negócio."
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

  const tabFields = catalog.fields.filter((field) => field.entity === entity);
  const added = tabFields.filter((field) => field.exposed);
  // Campo que sumiu do portal não pode ser adicionado de novo.
  const available = tabFields.filter((field) => !field.exposed && field.available);
  const entityLabel = CRM_ENTITY_LABELS[entity].toLowerCase();

  return (
    <>
      {header}

      <Card className="mb-6 p-5 text-sm text-zinc-600">
        <ul className="list-disc space-y-1 pl-5">
          <li>O agente só lê os campos adicionados aqui.</li>
          <li>
            Descreva o que cada campo significa no seu negócio (ex.: &quot;Plano contratado pelo
            cliente; Ouro dá direito a suporte 24h&quot;). Assim o agente entende e usa a informação
            certa.
          </li>
          <li>Adicione telefone e e-mail só se o agente realmente precisar deles.</li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500">
          Dados lidos do Bitrix24 em {formatDateTime(catalog.loadedAt)}.
        </p>
      </Card>

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
          Campos e funis atualizados do Bitrix24.
        </Alert>
      )}

      <nav
        className="mb-4 flex flex-wrap gap-6 border-b border-zinc-200"
        aria-label="Entidades do CRM"
        role="tablist"
      >
        {CRM_ENTITY_TABS.map((tab) => {
          const active = tab === entity;
          const count = catalog.fields.filter(
            (field) => field.entity === tab && field.exposed,
          ).length;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setEntity(tab)}
              className={`-mb-px border-b-2 pb-3 text-sm font-medium transition-colors ${
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800'
              }`}
            >
              {CRM_ENTITY_LABELS[tab]}
              <span className="ml-1.5 text-xs font-normal text-zinc-400">{count}</span>
            </button>
          );
        })}
      </nav>

      <section className="mb-8">
        <h2 className="text-base font-semibold text-zinc-900">Campos que o agente lê</h2>
        <p className="mt-0.5 mb-3 text-sm text-zinc-500">
          {added.length === 1 ? '1 campo adicionado' : `${added.length} campos adicionados`} em{' '}
          {entityLabel}.
        </p>
        <Card>
          {added.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-zinc-500">
              Nenhum campo adicionado em {entityLabel}.
              {canManage && ' Escolha abaixo os campos que o agente deve ler.'}
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {added.map((field) => (
                <AddedFieldRow
                  key={`${version}:${field.entity}:${field.code}`}
                  field={field}
                  readOnly={!canManage}
                  onSaved={onFieldSaved}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      {canManage && (
        <AddFieldsSection
          key={`${version}:${entity}`}
          entityLabel={entityLabel}
          fields={available}
          onSaved={onFieldSaved}
        />
      )}

      <section>
        <h2 className="text-lg font-semibold text-zinc-900">Funis e etapas</h2>
        <p className="mt-0.5 mb-4 text-sm text-zinc-500">
          O agente vê o funil e a etapa dos negócios pelo nome. Para mudar, edite os funis no
          Bitrix24 e clique em &quot;Atualizar do Bitrix24&quot;.
        </p>
        {catalog.pipelines.length === 0 ? (
          <Card className="px-5 py-8 text-center text-sm text-zinc-500">
            Nenhum funil de negócios encontrado.
          </Card>
        ) : (
          <div className="space-y-4">
            {catalog.pipelines.map((pipeline) => (
              <Card key={pipeline.id} className="p-5">
                <p className="text-sm font-medium text-zinc-900">{pipeline.name}</p>
                <ol className="mt-3 flex flex-wrap gap-2">
                  {pipeline.stages.map((stage, index) => (
                    <li
                      key={`${index}:${stage.name}`}
                      className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700"
                    >
                      {stage.name}
                      <Badge tone={STAGE_TONES[stage.semantic]}>
                        {STAGE_SEMANTIC_LABELS[stage.semantic]}
                      </Badge>
                    </li>
                  ))}
                </ol>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** Rótulo, selos, tipo, código e valores aceitos (igual nas duas listas). */
function FieldSummary({ field }: { field: CrmFieldView }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-zinc-900">{field.label}</p>
        {field.custom && <Badge tone="brand">Personalizado</Badge>}
        {PERSONAL_TYPES.has(field.type) && <Badge tone="amber">Dado pessoal</Badge>}
        {!field.available && <Badge tone="amber">Não existe mais no portal</Badge>}
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">
        {fieldTypeLabel(field.type)}
        <span className="text-zinc-300"> · </span>
        <code className="text-[11px]">{field.code}</code>
      </p>
      {field.options.length > 0 && (
        <p className="mt-1 text-xs text-zinc-500" title={field.options.join(', ')}>
          Valores aceitos: {summarizeOptions(field.options)}
        </p>
      )}
    </div>
  );
}

type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

/**
 * Campo que o agente lê. A descrição salva ao sair do campo ou pelo botão; "Remover" tira o campo
 * da leitura do agente (a descrição fica guardada para quando for adicionado de novo). Os
 * salvamentos da mesma linha vão em fila, sempre com o estado mais recente.
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
  const [description, setDescription] = useState(field.description);
  const [savedDescription, setSavedDescription] = useState(field.description);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [removing, setRemoving] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const dirty = description.trim() !== savedDescription.trim();
  const descriptionId = `crm-desc-${field.entity}-${field.code}`;

  function save(next: { exposed: boolean; description: string }) {
    const parsed = crmFieldSettingInputSchema.safeParse(next);
    if (!parsed.success) {
      setState({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Revise a descrição.',
      });
      return;
    }
    if (!next.exposed) setRemoving(true);
    setState({ kind: 'saving' });
    pending.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        const saved = await saveCrmField(api, field.entity, field.code, parsed.data);
        setSavedDescription(saved.description);
        pending.current -= 1;
        if (pending.current === 0) setState({ kind: 'saved' });
        // Removido: a linha sai da lista quando o catálogo é atualizado.
        onSaved(saved);
      } catch (e) {
        pending.current -= 1;
        setRemoving(false);
        setState({
          kind: 'error',
          message: crmErrorMessage(e, 'Não foi possível salvar este campo. Tente de novo.'),
        });
      }
    });
  }

  function saveDescription() {
    if (!dirty) return;
    save({ exposed: true, description });
  }

  function remove() {
    save({ exposed: false, description });
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-4">
        <FieldSummary field={field} />
        {!readOnly && (
          <button
            type="button"
            onClick={remove}
            disabled={removing}
            className={buttonClass('ghost-danger', 'sm')}
          >
            {removing && <Spinner className="size-3.5" />}
            {removing ? 'Removendo…' : 'Remover'}
          </button>
        )}
      </div>

      <div className="mt-3">
        <label htmlFor={descriptionId} className="sr-only">
          Descrição de {field.label} para o agente
        </label>
        <textarea
          id={descriptionId}
          className={`${inputClass} mt-0 min-h-16`}
          maxLength={CRM_FIELD_DESCRIPTION_MAX}
          disabled={readOnly || removing}
          placeholder={
            readOnly ? 'Sem descrição.' : 'O que este campo significa no seu negócio (opcional)'
          }
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (state.kind !== 'saving') setState({ kind: 'idle' });
          }}
          onBlur={saveDescription}
        />
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-zinc-500">
            {description.length}/{CRM_FIELD_DESCRIPTION_MAX}
          </span>
          <div className="flex items-center gap-3">
            <SaveFeedback state={state} />
            {!readOnly && dirty && (
              <button
                type="button"
                // Antes do blur do textarea: evita salvar duas vezes.
                onMouseDown={(e) => e.preventDefault()}
                onClick={saveDescription}
                disabled={state.kind === 'saving'}
                className={buttonClass('secondary', 'sm')}
              >
                Salvar descrição
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Campos do portal ainda não adicionados, com busca por nome ou código. */
function AddFieldsSection({
  entityLabel,
  fields,
  onSaved,
}: {
  entityLabel: string;
  fields: CrmFieldView[];
  onSaved: (field: CrmFieldView) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const wanted = normalize(query.trim());
    if (!wanted) return fields;
    return fields.filter(
      (field) => normalize(field.label).includes(wanted) || normalize(field.code).includes(wanted),
    );
  }, [fields, query]);

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-zinc-900">Adicionar campos</h2>
      <p className="mt-0.5 mb-3 text-sm text-zinc-500">
        Campos de {entityLabel} do seu Bitrix24 que o agente ainda não lê.
      </p>
      <Card>
        <div className="border-b border-zinc-100 px-5 py-3">
          <label htmlFor="crm-field-search" className="sr-only">
            Buscar campo
          </label>
          <input
            id="crm-field-search"
            type="search"
            className={`${inputClass} mt-0`}
            placeholder="Buscar pelo nome ou código do campo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            {fields.length === 0
              ? `Todos os campos de ${entityLabel} já foram adicionados.`
              : 'Nenhum campo encontrado com essa busca.'}
          </p>
        ) : (
          <ul className="max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto">
            {filtered.map((field) => (
              <AvailableFieldRow
                key={`${field.entity}:${field.code}`}
                field={field}
                onSaved={onSaved}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function AvailableFieldRow({
  field,
  onSaved,
}: {
  field: CrmFieldView;
  onSaved: (field: CrmFieldView) => void;
}) {
  const { api } = useAppSession();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setAdding(true);
    setError(null);
    try {
      // A descrição guardada volta junto quando o campo já foi adicionado antes.
      onSaved(
        await saveCrmField(api, field.entity, field.code, {
          exposed: true,
          description: field.description,
        }),
      );
    } catch (e) {
      setError(crmErrorMessage(e, 'Não foi possível adicionar este campo. Tente de novo.'));
      setAdding(false);
    }
  }

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-start gap-4">
        <FieldSummary field={field} />
        <button
          type="button"
          onClick={add}
          disabled={adding}
          className={buttonClass('secondary', 'sm')}
        >
          {adding ? <Spinner className="size-3.5" /> : <PlusIcon className="size-3.5" />}
          {adding ? 'Adicionando…' : 'Adicionar'}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function SaveFeedback({ state }: { state: SaveState }) {
  if (state.kind === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-zinc-500" role="status">
        <Spinner className="size-3.5" />
        Salvando…
      </span>
    );
  }
  if (state.kind === 'saved') {
    return (
      <span className="text-emerald-700" role="status">
        Salvo
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span className="text-red-700" role="alert">
        {state.message}
      </span>
    );
  }
  return null;
}
