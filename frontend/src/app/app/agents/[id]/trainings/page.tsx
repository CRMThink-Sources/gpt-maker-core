'use client';

import type { AgentFunctionConfigView, TrainingUsage, TrainingView } from '@gptmaker/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { BookIcon, FileIcon, GlobeIcon, PlusIcon, TextIcon, VideoIcon } from '@/components/icons';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading, Spinner } from '@/components/ui';
import { type createFormat, type T, useErrorMessage, useFormat, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { inputClass } from '../../agent-fields';
import { ApiRequestError } from '@/lib/platform-session';
import {
  formatBytes,
  trainingIntervalLabel,
  trainingStatus,
  trainingTitle,
  trainingTypeLabel,
} from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';
import { useAgent } from '../agent-context';
import { AddTrainingModal } from './add-training-modal';
import { EditTextTrainingModal } from './edit-text-modal';

/** Enquanto houver treinamento processando, a lista se atualiza sozinha (o status vem do callback). */
const POLL_MS = 5000;
const POLL_MAX = 120;
/** Quantos treinamentos aparecem por vez; o resto entra em "Mostrar mais". */
const PAGE_SIZE = 20;

const ICONS: Record<TrainingView['type'], ComponentType<SVGProps<SVGSVGElement>>> = {
  TEXT: TextIcon,
  WEBSITE: GlobeIcon,
  VIDEO: VideoIcon,
  DOCUMENT: FileIcon,
};

interface Listing {
  trainings: TrainingView[];
  usage: TrainingUsage;
}

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
  return parts.join(' · ');
}

/** Aba Treinamentos: o que o agente sabe, com o uso dos limites do plano. */
export default function AgentTrainingsPage() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const t = useT('trainings');
  const tc = useT('common');
  const format = useFormat();
  const translateError = useErrorMessage('trainings');
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TrainingView | null>(null);
  // Site e vídeo só no modo avançado; agente sem função (anterior às funções) segue livre.
  const [mediaAllowed, setMediaAllowed] = useState<boolean | null>(null);
  // No controle assumido não há botão de modo avançado: o caminho é voltar ao formulário.
  const [takenOver, setTakenOver] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const canManage = session.canManage && agent.status !== 'OUT_OF_SYNC';
  const base = `/app/agents/${agent.id}/trainings`;

  const fetchListing = useCallback(() => api<Listing>(base), [api, base]);

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

  // Texto é sempre liberado; site e vídeo dependem do modo avançado (`mediaAllowed`).
  const add = canManage && (
    <button type="button" onClick={() => setAdding(true)} className={buttonClass('primary')}>
      <PlusIcon className="size-4" />
      {t('page.add')}
    </button>
  );

  const term = query.trim().toLowerCase();
  const filtered = (listing?.trainings ?? []).filter(
    (training) => !term || trainingTitle(training, t).toLowerCase().includes(term),
  );
  const shown = filtered.slice(0, visible);
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
        {add}
      </div>

      {error && (
        <Alert tone="error" className="mb-6">
          {error}
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

          {listing.trainings.length > PAGE_SIZE && (
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(PAGE_SIZE);
              }}
              placeholder={t('page.searchPlaceholder')}
              aria-label={t('page.searchLabel')}
              className={`${inputClass} mb-4`}
            />
          )}

          <Card>
            {listing.trainings.length > 0 && filtered.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-500">
                {t('page.noMatch', { query: query.trim() })}
              </p>
            ) : listing.trainings.length === 0 ? (
              <EmptyState
                icon={<BookIcon className="size-6" />}
                title={t('page.emptyTitle')}
                description={t('page.emptyDescription')}
                action={add}
              />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {shown.map((training) => {
                  const Icon = ICONS[training.type];
                  const status = trainingStatus(training.status, t);
                  const busy = busyId === training.id;
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
                            {training.type === 'TEXT' && (
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
          {filtered.length > shown.length && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm text-zinc-500">
              <span>{t('page.showing', { shown: shown.length, total: filtered.length })}</span>
              <button
                type="button"
                onClick={() => setVisible((current) => current + PAGE_SIZE)}
                className={buttonClass('secondary', 'sm')}
              >
                {t('page.showMore')}
              </button>
            </div>
          )}
        </>
      )}

      {adding && (
        <AddTrainingModal
          agentId={agent.id}
          mediaAllowed={mediaAllowed === true}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
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
