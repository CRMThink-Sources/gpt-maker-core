'use client';

import type {
  AdminDeadLetterPeek,
  AdminDeadLetterQueue,
  AdminOperationsView,
  DeadLetterQueueKey,
  FailureSource,
} from '@gptmaker/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { useAdmin, useOperator } from '../admin-provider';
import { FAILURE_SOURCES } from '../failure-sources';

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const QUEUES: Record<DeadLetterQueueKey, { title: string; description: string }> = {
  inbound: {
    title: 'Mensagens do chatbot',
    description:
      'Esgotaram as tentativas ou tiveram erro permanente. O diálogo já foi para um operador e a mensagem aparece nos erros do portal.',
  },
  transfer: {
    title: 'Transferências para humano',
    description: 'Pedidos de transferência do agente que falharam depois das tentativas.',
  },
};

function QueueCard({
  queue,
  isAdmin,
  onPurged,
}: {
  queue: AdminDeadLetterQueue;
  isAdmin: boolean;
  onPurged: (text: string) => void;
}) {
  const { api } = useAdmin();
  const [peek, setPeek] = useState<AdminDeadLetterPeek | null>(null);
  const [busy, setBusy] = useState<'peek' | 'purge' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = QUEUES[queue.key];

  async function load() {
    setBusy('peek');
    setError(null);
    try {
      setPeek(await api<AdminDeadLetterPeek>(`/admin/operations/dlq/${queue.key}?limit=20`));
    } catch (e) {
      setError(message(e, 'Não foi possível ler a fila.'));
    } finally {
      setBusy(null);
    }
  }

  async function purge() {
    setBusy('purge');
    setError(null);
    try {
      const { purged } = await api<{ purged: number }>(`/admin/operations/dlq/${queue.key}/purge`, {
        method: 'POST',
      });
      setConfirm(false);
      setPeek(null);
      onPurged(`${purged} mensagem(ns) descartada(s) de ${meta.title.toLowerCase()}.`);
    } catch (e) {
      setError(message(e, 'Não foi possível descartar.'));
    } finally {
      setBusy(null);
    }
  }

  const count = peek?.queue.messages ?? queue.messages;

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3 border-b border-zinc-100 px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-zinc-900">
            {meta.title}{' '}
            <span className={count ? 'text-amber-700' : 'text-zinc-500'}>
              ({count === null ? 'indisponível' : count})
            </span>
          </h2>
          <p className="text-xs text-zinc-500">{meta.description}</p>
          <p className="text-xs text-zinc-400">
            Fila <code>{queue.name}</code>
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy !== null || !count}
            className={buttonClass('secondary', 'sm')}
          >
            {busy === 'peek' && <Spinner className="size-4" />}
            {peek ? 'Atualizar' : 'Ver mensagens'}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              disabled={busy !== null || !count}
              className={buttonClass('ghost-danger', 'sm')}
            >
              Descartar todas
            </button>
          )}
        </div>
      </div>
      {error && (
        <Alert tone="error" className="m-4">
          {error}
        </Alert>
      )}
      {peek &&
        (peek.messages.length === 0 ? (
          <p className="px-5 py-3 text-sm text-zinc-500">Fila vazia.</p>
        ) : (
          <>
            <ul className="divide-y divide-zinc-100">
              {peek.messages.map((m, index) => (
                <li key={index} className="px-5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    {m.tenant ? (
                      <Link
                        href={`/admin/tenants/${m.tenant.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {m.tenant.domain}
                      </Link>
                    ) : (
                      <span className="text-zinc-500">portal desconhecido</span>
                    )}
                    {m.dialogId && (
                      <span className="text-xs text-zinc-500">diálogo {m.dialogId}</span>
                    )}
                    {m.reference && (
                      <span className="text-xs text-zinc-500">
                        ref. <code>{m.reference}</code>
                      </span>
                    )}
                    {m.attempts !== null && (
                      <span className="text-xs text-zinc-500">{m.attempts} tentativa(s)</span>
                    )}
                    {m.receivedAt && (
                      <span className="ml-auto text-xs text-zinc-500">
                        {dateTime(m.receivedAt)}
                      </span>
                    )}
                  </div>
                  {m.lastError && <p className="text-xs text-amber-800">{m.lastError}</p>}
                </li>
              ))}
            </ul>
            <p className="border-t border-zinc-100 px-5 py-2 text-xs text-zinc-400">
              As primeiras {peek.messages.length} da fila, sem o texto das mensagens. Ler não as
              remove.
            </p>
          </>
        ))}

      {confirm && (
        <Modal
          title="Descartar mensagens da fila"
          description={`As ${count ?? ''} mensagens de "${meta.title}" serão apagadas da fila. Elas já foram tratadas (diálogo transferido ou alerta enviado) e as de mensagens continuam nos erros de cada portal.`}
          onRequestClose={() => busy === null && setConfirm(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(false)}
                disabled={busy !== null}
                className={buttonClass('secondary')}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void purge()}
                disabled={busy !== null}
                className={buttonClass('danger')}
              >
                {busy === 'purge' && <Spinner className="size-4" />}
                Descartar
              </button>
            </div>
          }
        >
          {error && <Alert tone="error">{error}</Alert>}
        </Modal>
      )}
    </Card>
  );
}

/** DLQs do canal e portais com mais falhas nos últimos 7 dias (15.7). */
export default function AdminOperationsPage() {
  const { api } = useAdmin();
  const isAdmin = useOperator().role === 'ADMIN';
  const [view, setView] = useState<AdminOperationsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => api<AdminOperationsView>('/admin/operations'), [api]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((v) => !cancelled && setView(v))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <>
      <PageHeader
        title="Erros"
        description="Filas de mensagens que falharam (DLQ) e portais com falhas definitivas nos últimos 7 dias."
      />
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {!view && !error && <Loading />}
      {view && (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {view.queues.map((queue) => (
              <QueueCard
                key={queue.key}
                queue={queue}
                isAdmin={isAdmin}
                onPurged={(text) => {
                  setNotice(text);
                  void load().then(setView);
                }}
              />
            ))}
          </div>

          <Card>
            <div className="border-b border-zinc-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-zinc-900">Portais com falhas (7 dias)</h2>
              <p className="text-xs text-zinc-500">
                Só o que esgotou as tentativas. O detalhe de cada falha fica na página do portal.
              </p>
            </div>
            {view.ranking.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Nenhuma falha nos últimos 7 dias.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {view.ranking.map((row) => (
                  <li
                    key={row.tenant.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                  >
                    <Link
                      href={`/admin/tenants/${row.tenant.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {row.tenant.domain}
                    </Link>
                    <span className="text-xs text-zinc-500">
                      {(Object.entries(row.bySource) as Array<[FailureSource, number]>)
                        .map(([source, total]) => `${FAILURE_SOURCES[source]} ${total}`)
                        .join(' · ')}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">
                      última {dateTime(row.lastAt)}
                    </span>
                    <span className="w-10 text-right font-semibold tabular-nums text-zinc-900">
                      {row.total}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
