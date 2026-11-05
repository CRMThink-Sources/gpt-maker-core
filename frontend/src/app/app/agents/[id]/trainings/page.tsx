'use client';

import type { AgentFunctionConfigView, TrainingUsage, TrainingView } from '@gptmaker/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { BookIcon, FileIcon, GlobeIcon, PlusIcon, TextIcon, VideoIcon } from '@/components/icons';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { ApiRequestError } from '@/lib/platform-session';
import {
  formatBytes,
  TRAINING_INTERVALS,
  TRAINING_TYPES,
  trainingStatus,
  trainingTitle,
} from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';
import { useAgent } from '../agent-context';
import { AddTrainingModal } from './add-training-modal';

/** Enquanto houver treinamento processando, a lista se atualiza sozinha (o status vem do callback). */
const POLL_MS = 5000;
const POLL_MAX = 120;

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
  used,
  limit,
  format = String,
}: {
  label: string;
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
          {limit === null ? ' · sem limite' : ` de ${format(limit)}`}
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

function details(training: TrainingView): string {
  const parts = [TRAINING_TYPES[training.type]];
  if (training.document) parts.push(formatBytes(training.document.sizeBytes));
  if (training.type === 'WEBSITE') {
    if (training.trainingSubPages) parts.push('com páginas ligadas');
    if (training.trainingInterval && training.trainingInterval !== 'NEVER') {
      parts.push(TRAINING_INTERVALS[training.trainingInterval].toLowerCase());
    }
  }
  parts.push(new Date(training.createdAt).toLocaleDateString('pt-BR'));
  return parts.join(' · ');
}

/** Aba Treinamentos: o que o agente sabe, com o uso dos limites do plano. */
export default function AgentTrainingsPage() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Site e vídeo só no modo avançado; agente sem função (anterior às funções) segue livre.
  const [mediaAllowed, setMediaAllowed] = useState<boolean | null>(null);
  // No controle assumido não há botão de modo avançado: o caminho é voltar ao formulário.
  const [takenOver, setTakenOver] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const canManage = session.canManage && agent.status !== 'OUT_OF_SYNC';
  const base = `/app/agents/${agent.id}/trainings`;

  const fetchListing = useCallback(() => api<Listing>(base), [api, base]);

  const reload = useCallback(async () => {
    try {
      setListing(await fetchListing());
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível carregar os treinamentos.'));
    }
  }, [fetchListing]);

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
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar os treinamentos.')),
      );
    return () => {
      cancelled = true;
    };
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
      setError(errorMessage(e, 'Não foi possível concluir. Tente de novo.'));
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  const add = canManage && mediaAllowed && (
    <button type="button" onClick={() => setAdding(true)} className={buttonClass('primary')}>
      <PlusIcon className="size-4" />
      Adicionar site ou vídeo
    </button>
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">O que o agente sabe</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Os itens da base vêm do formulário, na aba{' '}
            <Link href={`/app/agents/${agent.id}/function`} className="text-brand-700 underline">
              Função
            </Link>
            .{' '}
            {mediaAllowed === false
              ? takenOver
                ? 'Para treinar com sites e vídeos, volte ao formulário no modo avançado lá.'
                : 'Para treinar com sites e vídeos, ligue o modo avançado lá.'
              : 'No modo avançado, sites e vídeos entram por aqui.'}{' '}
            Treinar não consome créditos.
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
              label="Treinamentos (todos os agentes)"
              used={listing.usage.trainings.used}
              limit={listing.usage.trainings.limit}
            />
          </div>

          <Card>
            {listing.trainings.length === 0 ? (
              <EmptyState
                icon={<BookIcon className="size-6" />}
                title="Nenhum treinamento ainda"
                description="Preencha a base de conhecimento no formulário da aba Função e publique."
                action={add}
              />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {listing.trainings.map((training) => {
                  const Icon = ICONS[training.type];
                  const status = trainingStatus(training.status);
                  const busy = busyId === training.id;
                  return (
                    <li key={training.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            className="truncate text-sm font-medium text-zinc-900"
                            title={trainingTitle(training)}
                          >
                            {trainingTitle(training)}
                          </p>
                          {training.managed && <Badge tone="brand">da função</Badge>}
                          <Badge tone={status.tone}>
                            {training.status === 'PROCESSING' && (
                              <Spinner className="-ml-0.5 size-3" />
                            )}
                            {status.label}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">{details(training)}</p>
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
                              {busy ? 'Reenviando…' : 'Reenviar'}
                            </button>
                          )
                        ) : confirmingId === training.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-600">Remover?</span>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              disabled={busy}
                              className={buttonClass('secondary', 'sm')}
                            >
                              Cancelar
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
                              {busy ? 'Removendo…' : 'Remover'}
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
                                {busy ? 'Reenviando…' : 'Reenviar'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setConfirmingId(training.id)}
                              disabled={busyId !== null}
                              className={buttonClass('ghost-danger', 'sm')}
                            >
                              Remover
                            </button>
                          </div>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      {adding && (
        <AddTrainingModal
          agentId={agent.id}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}
    </>
  );
}
