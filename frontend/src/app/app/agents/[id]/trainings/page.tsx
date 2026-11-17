'use client';

import {
  type AgentFunctionConfigView,
  TRAINING_IMPORT_MAX_ITEMS,
  type TrainingExport,
  type TrainingListResponse,
  type TrainingView,
} from '@gptmaker/contracts';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react';
import {
  BookIcon,
  DownloadIcon,
  FileIcon,
  GlobeIcon,
  PlusIcon,
  TextIcon,
  UploadIcon,
  VideoIcon,
} from '@/components/icons';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading, Spinner } from '@/components/ui';
import { type createFormat, type T, useErrorMessage, useFormat, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { ApiRequestError } from '@/lib/platform-session';
import {
  changeTrainingFilters,
  EMPTY_TRAINING_FILTERS,
  hasActiveTrainingFilters,
  parseTrainingFilters,
  trainingFiltersQuery,
  type TrainingListFilters,
} from '@/lib/training-list';
import {
  downloadJsonFile,
  exportHasImages,
  formatBytes,
  trainingExportFileName,
  trainingIntervalLabel,
  trainingStatus,
  trainingTitle,
  trainingTypeLabel,
} from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';
import { useAgent } from '../agent-context';
import { AddTrainingModal } from './add-training-modal';
import { EditTextTrainingModal } from './edit-text-modal';
import { ImportTrainingsModal } from './import-trainings-modal';
import { TrainingFilters, TrainingPagination } from './list-controls';
import { TrainingSettingsModal } from './settings-modal';

/** Enquanto houver treinamento processando, a lista se atualiza sozinha (o status vem do callback). */
const POLL_MS = 5000;
const POLL_MAX = 120;
/** Espera o usuário parar de digitar antes de buscar. */
const SEARCH_DEBOUNCE_MS = 300;

const ICONS: Record<TrainingView['type'], ComponentType<SVGProps<SVGSVGElement>>> = {
  TEXT: TextIcon,
  WEBSITE: GlobeIcon,
  VIDEO: VideoIcon,
  DOCUMENT: FileIcon,
};

function UsageMeter({
  label,
  t,
  used,
  limit,
  format = String,
}: {
  label: string;
  t: T;
  used: number;
  limit: number | null;
  format?: (value: number) => string;
}) {
  const ratio = limit ? Math.min(used / limit, 1) : 0;
  const tone = ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-brand-600';
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        <p className="text-xs text-zinc-500">
          <span className="text-sm font-semibold text-zinc-900">{format(used)}</span>
          {limit === null ? t('page.noLimit') : t('page.ofLimit', { limit: format(limit) })}
        </p>
      </div>
      {limit !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
    </Card>
  );
}

function details(training: TrainingView, t: T, format: ReturnType<typeof createFormat>): string {
  const parts = [trainingTypeLabel(training.type, t)];
  if (training.document) parts.push(formatBytes(training.document.sizeBytes, format));
  if (training.type === 'WEBSITE') {
    if (training.trainingSubPages) parts.push(t('page.withSubPages'));
    if (training.trainingInterval && training.trainingInterval !== 'NEVER') {
      parts.push(trainingIntervalLabel(training.trainingInterval, t).toLowerCase());
    }
  }
  parts.push(format.dateTime(new Date(training.createdAt), { dateStyle: 'short' }));
  if (training.status === 'EXPIRED' && training.expiredAt) {
    parts.push(
      t('page.expiredOn', {
        date: format.dateTime(new Date(training.expiredAt), { dateStyle: 'short' }),
      }),
    );
  } else if (training.expiresAt) {
    parts.push(
      t('page.expiresOn', {
        date: format.dateTime(new Date(training.expiresAt), {
          dateStyle: 'short',
          timeStyle: 'short',
        }),
      }),
    );
  }
  return parts.join(' · ');
}

/** `useSearchParams` pede um `Suspense` acima (build estático do Next). */
export default function AgentTrainingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AgentTrainings />
    </Suspense>
  );
}

/** Aba Treinamentos: o que o agente sabe, com o uso dos limites do plano. */
function AgentTrainings() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const t = useT('trainings');
  const tc = useT('common');
  const format = useFormat();
  const translateError = useErrorMessage('trainings');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Página e filtros vivem na URL: recarregar e compartilhar o link mantêm o contexto.
  const filters = useMemo(() => parseTrainingFilters(searchParams), [searchParams]);
  const [search, setSearch] = useState(filters.q);
  const [listing, setListing] = useState<TrainingListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrainingView | null>(null);
  // Site e vídeo só no modo avançado; agente sem função (anterior às funções) segue livre.
  const [mediaAllowed, setMediaAllowed] = useState<boolean | null>(null);
  // No controle assumido não há botão de modo avançado: o caminho é voltar ao formulário.
  const [takenOver, setTakenOver] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [settingsOf, setSettingsOf] = useState<TrainingView | null>(null);

  const canManage = session.canManage && agent.status !== 'OUT_OF_SYNC';
  const base = `/app/agents/${agent.id}/trainings`;

  const apply = useCallback(
    (next: TrainingListFilters) => {
      const query = trainingFiltersQuery(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const changeFilters = (patch: Partial<Omit<TrainingListFilters, 'page'>>) =>
    apply(changeTrainingFilters(filters, patch));

  const listQuery = trainingFiltersQuery(filters);
  const fetchListing = useCallback(
    () => api<TrainingListResponse>(listQuery ? `${base}?${listQuery}` : base),
    [api, base, listQuery],
  );

  // A busca só vai à URL (e à API) depois de uma pausa na digitação.
  useEffect(() => {
    if (search.trim() === filters.q.trim()) return;
    const timer = window.setTimeout(
      () => apply(changeTrainingFilters(filters, { q: search })),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search, filters, apply]);
  // Voltar/limpar pela URL também atualiza o campo (ajuste durante o render, sem effect).
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    setSearch(filters.q);
  }

  const reload = useCallback(async () => {
    try {
      setListing(await fetchListing());
    } catch (e) {
      setError(errorMessage(e, t('page.loadError'), translateError));
    }
  }, [fetchListing, t, translateError]);

  useEffect(() => {
    let cancelled = false;
    api<AgentFunctionConfigView>(`/app/agents/${agent.id}/function`)
      .then((config) => {
        if (cancelled) return;
        setMediaAllowed(config.mode === 'ADVANCED');
        setTakenOver(config.mode === 'TAKEN_OVER');
      })
      // Outra falha não libera: a API recusaria e o cliente veria o erro só depois de preencher.
      .catch(
        (e: unknown) =>
          !cancelled &&
          setMediaAllowed(e instanceof ApiRequestError && e.code === 'FUNCTION_NOT_CONFIGURED'),
      );
    return () => {
      cancelled = true;
    };
  }, [api, agent.id]);

  useEffect(() => {
    let cancelled = false;
    fetchListing()
      .then((data) => !cancelled && setListing(data))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, t('page.loadError'), translateError)),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o idioma não refaz a leitura
  }, [fetchListing]);

  // Página que deixou de existir (ex.: removeu o último item dela): volta para a última.
  const lastPage = listing?.page.totalPages ?? 1;
  const outOfRange = listing !== null && listing.trainings.length === 0 && filters.page > lastPage;
  useEffect(() => {
    if (outOfRange) apply({ ...filters, page: Math.max(lastPage, 1) });
  }, [outOfRange, lastPage, filters, apply]);

  const processing = listing?.trainings.some((training) => training.status === 'PROCESSING');
  useEffect(() => {
    if (!processing) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > POLL_MAX) window.clearInterval(timer);
      fetchListing()
        .then(setListing)
        .catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [processing, fetchListing]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError(errorMessage(e, t('page.actionError'), translateError));
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  /** Baixa os treinamentos manuais; sem nenhum, só avisa (spec agent-training-transfer). */
  async function exportTrainings() {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const file = await api<TrainingExport>(`${base}/export`);
      if (file.trainings.length === 0) {
        setNotice(t('page.exportEmpty'));
        return;
      }
      downloadJsonFile(file, trainingExportFileName(agent.name));
      if (exportHasImages(file)) setNotice(t('page.exportImages'));
    } catch (e) {
      setError(errorMessage(e, t('page.exportError'), translateError));
    } finally {
      setExporting(false);
    }
  }

  // Texto é sempre liberado; site e vídeo dependem do modo avançado (`mediaAllowed`).
  const add = canManage && (
    <button type="button" onClick={() => setAdding(true)} className={buttonClass('primary')}>
      <PlusIcon className="size-4" />
      {t('page.add')}
    </button>
  );

  const filtering = hasActiveTrainingFilters(filters);
  // O link da aba Função fica no meio da frase: a tradução marca o lugar com {link}.
  const [introBefore, introAfter = ''] = t('page.intro', { link: '' }).split('');

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">{t('page.heading')}</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {introBefore}
            <Link href={`/app/agents/${agent.id}/function`} className="text-brand-700 underline">
              {t('page.functionTab')}
            </Link>
            {introAfter}{' '}
            {mediaAllowed === false
              ? takenOver
                ? t('page.mediaTakenOver')
                : t('page.mediaTurnOn')
              : t('page.mediaAdvanced')}{' '}
            {t('page.noCredits')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportTrainings}
            disabled={exporting || listing === null}
            className={buttonClass('secondary')}
          >
            <DownloadIcon className="size-4" />
            {exporting ? t('page.exporting') : t('page.export')}
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setImporting(true)}
              className={buttonClass('secondary')}
            >
              <UploadIcon className="size-4" />
              {t('page.import')}
            </button>
          )}
          {add}
        </div>
      </div>

      {error && (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="warning" className="mb-6">
          {notice}
        </Alert>
      )}

      {listing === null ? (
        !error && <Loading />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <UsageMeter
              label={t('page.usageLabel')}
              t={t}
              used={listing.usage.trainings.used}
              limit={listing.usage.trainings.limit}
            />
          </div>

          {(listing.page.total > 0 || filtering || listing.availableTags.length > 0) && (
            <TrainingFilters
              filters={filters}
              search={search}
              onSearch={setSearch}
              availableTags={listing.availableTags}
              onChange={changeFilters}
              onClear={() => apply(EMPTY_TRAINING_FILTERS)}
            />
          )}

          <Card>
            {listing.trainings.length === 0 && filtering ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-500">
                <p>{t('page.noResults')}</p>
                <button
                  type="button"
                  onClick={() => apply(EMPTY_TRAINING_FILTERS)}
                  className={`${buttonClass('secondary', 'sm')} mt-3`}
                >
                  {t('page.clearFilters')}
                </button>
              </div>
            ) : listing.trainings.length === 0 ? (
              <EmptyState
                icon={<BookIcon className="size-6" />}
                title={t('page.emptyTitle')}
                description={t('page.emptyDescription')}
                action={add}
              />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {listing.trainings.map((training) => {
                  const Icon = ICONS[training.type];
                  const status = trainingStatus(training.status, t);
                  const busy = busyId === training.id;
                  const expired = training.status === 'EXPIRED';
                  return (
                    <li key={training.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      {training.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={training.image.url}
                          alt={t('page.imageAlt')}
                          className="size-9 shrink-0 rounded-lg border border-zinc-200 object-cover"
                        />
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                          <Icon className="size-5" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            className="truncate text-sm font-medium text-zinc-900"
                            title={trainingTitle(training, t)}
                          >
                            {trainingTitle(training, t)}
                          </p>
                          {training.managed && <Badge tone="brand">{t('page.fromFunction')}</Badge>}
                          {training.type === 'TEXT' && !training.managed && (
                            <Badge tone="zinc">{t('page.manual')}</Badge>
                          )}
                          <Badge tone={status.tone}>
                            {training.status === 'PROCESSING' && (
                              <Spinner className="-ml-0.5 size-3" />
                            )}
                            {status.label}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {details(training, t, format)}
                        </p>
                        {training.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {training.tags.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() =>
                                  changeFilters({
                                    tags: filters.tags.includes(tag)
                                      ? filters.tags
                                      : [...filters.tags, tag],
                                  })
                                }
                                className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        )}
                        {expired && (
                          <p className="mt-1 text-xs text-zinc-500">{t('page.expiredHint')}</p>
                        )}
                        {training.status === 'FAILED' && training.error && (
                          <p className="mt-1 text-xs text-amber-800">{training.error}</p>
                        )}
                      </div>

                      {canManage &&
                        (training.managed ? (
                          training.status === 'FAILED' && (
                            <button
                              type="button"
                              onClick={() =>
                                run(training.id, () =>
                                  api(`${base}/${training.id}/retry`, { method: 'POST' }),
                                )
                              }
                              disabled={busyId !== null}
                              className={buttonClass('secondary', 'sm')}
                            >
                              {busy ? t('page.retrying') : t('page.retry')}
                            </button>
                          )
                        ) : confirmingId === training.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-600">{t('page.confirmRemove')}</span>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              disabled={busy}
                              className={buttonClass('secondary', 'sm')}
                            >
                              {tc('cancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                run(training.id, () =>
                                  api(`${base}/${training.id}`, { method: 'DELETE' }),
                                )
                              }
                              disabled={busy}
                              className={buttonClass('danger', 'sm')}
                            >
                              {busy ? t('page.removing') : t('page.remove')}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            {training.status === 'FAILED' && (
                              <button
                                type="button"
                                onClick={() =>
                                  run(training.id, () =>
                                    api(`${base}/${training.id}/retry`, { method: 'POST' }),
                                  )
                                }
                                disabled={busyId !== null}
                                className={buttonClass('secondary', 'sm')}
                              >
                                {busy ? t('page.retrying') : t('page.retry')}
                              </button>
                            )}
                            {!expired && (
                              <button
                                type="button"
                                onClick={() => setSettingsOf(training)}
                                disabled={busyId !== null}
                                className={buttonClass('secondary', 'sm')}
                              >
                                {t('page.tagsAction')}
                              </button>
                            )}
                            {training.type === 'TEXT' && !expired && (
                              <button
                                type="button"
                                onClick={() => setEditing(training)}
                                disabled={busyId !== null}
                                className={buttonClass('secondary', 'sm')}
                              >
                                {t('page.edit')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setConfirmingId(training.id)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost-danger', 'sm')}
                            >
                              {t('page.remove')}
                            </button>
                          </div>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {listing.page.total > 0 && (
            <TrainingPagination
              info={listing.page}
              onPage={(page) => apply({ ...filters, page })}
            />
          )}
        </>
      )}

      {adding && (
        <AddTrainingModal
          agentId={agent.id}
          mediaAllowed={mediaAllowed === true}
          availableTags={listing?.availableTags ?? []}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}

      {importing && (
        <ImportTrainingsModal
          agentId={agent.id}
          maxItems={TRAINING_IMPORT_MAX_ITEMS}
          onClose={() => setImporting(false)}
          onImported={() => void reload()}
        />
      )}

      {settingsOf && (
        <TrainingSettingsModal
          agentId={agent.id}
          training={settingsOf}
          availableTags={listing?.availableTags ?? []}
          onClose={() => setSettingsOf(null)}
          onSaved={() => {
            setSettingsOf(null);
            void reload();
          }}
        />
      )}

      {editing && (
        <EditTextTrainingModal
          agentId={agent.id}
          training={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
