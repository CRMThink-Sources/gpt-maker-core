'use client';

import { TRAINING_TEXT_MAX, type TrainingUsage, type TrainingView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { BookIcon, FileIcon, GlobeIcon, PlusIcon, TextIcon, VideoIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import {
  formatBytes,
  TRAINING_INTERVALS,
  TRAINING_TYPES,
  trainingStatus,
  trainingTitle,
} from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';
import { inputClass } from '../../agent-fields';
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
  const [editing, setEditing] = useState<TrainingView | null>(null);
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

  const add = canManage && (
    <button type="button" onClick={() => setAdding(true)} className={buttonClass('primary')}>
      <PlusIcon className="size-4" />
      Adicionar treinamento
    </button>
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">O que o agente sabe</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Textos, sites, documentos e vídeos que o agente usa para responder. Treinar não consome
            créditos.
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
            <UsageMeter
              label="Espaço em documentos"
              used={listing.usage.documentBytes.used}
              limit={listing.usage.documentBytes.limit}
              format={formatBytes}
            />
          </div>

          <Card>
            {listing.trainings.length === 0 ? (
              <EmptyState
                icon={<BookIcon className="size-6" />}
                title="Nenhum treinamento ainda"
                description="Sem treinamento o agente só conhece o que está no comportamento. Comece pelas perguntas mais frequentes dos seus clientes."
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
                        (confirmingId === training.id ? (
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
                            {training.type === 'TEXT' && (
                              <button
                                type="button"
                                onClick={() => setEditing(training)}
                                disabled={busyId !== null}
                                className={buttonClass('ghost', 'sm')}
                              >
                                Editar
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
      {editing && (
        <EditTextModal
          training={editing}
          onClose={() => setEditing(null)}
          onSave={async (text) => {
            await api(`${base}/${editing.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ text }),
            });
            setEditing(null);
            await reload();
          }}
        />
      )}
    </>
  );
}

function EditTextModal({
  training,
  onClose,
  onSave,
}: {
  training: TrainingView;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(training.text ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível salvar. Tente de novo.'));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Editar texto"
      onRequestClose={() => !saving && onClose()}
      footer={
        <div className="flex justify-end gap-2">
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
            disabled={saving || text.trim() === ''}
            className={buttonClass('primary')}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <textarea
        className={`${inputClass} mt-0 min-h-64`}
        maxLength={TRAINING_TEXT_MAX}
        autoFocus
        disabled={saving}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Conteúdo do treinamento"
      />
      <p className="mt-1.5 text-xs text-zinc-500">
        {text.length.toLocaleString('pt-BR')}/{TRAINING_TEXT_MAX.toLocaleString('pt-BR')}{' '}
        caracteres.
      </p>
    </Modal>
  );
}
