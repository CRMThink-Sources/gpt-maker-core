'use client';

import type { AdminTenantRow, AdminWorkspaceView, WorkspaceSyncView } from '@gptmaker/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { Field, inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';
import { GptMakerAgentLink } from '../gptmaker-link';

type Orphan = AdminWorkspaceView['orphans'][number];

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

function dateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
}

/** Vincular órfão: escolhe o portal (sugerido pela criação registrada no app, quando houver). */
function LinkOrphan({
  orphan,
  onClose,
  onDone,
}: {
  orphan: Orphan;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { api } = useAdmin();
  const [query, setQuery] = useState(orphan.suggestedTenant?.tenantCode ?? '');
  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [tenantId, setTenantId] = useState(orphan.suggestedTenant?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = query.trim() ? `?${new URLSearchParams({ q: query.trim() })}` : '';
      api<AdminTenantRow[]>(`/admin/tenants${params}`)
        .then((rows) => !cancelled && setTenants(rows.filter((t) => t.status !== 'UNINSTALLED')))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query]);

  async function link() {
    if (!tenantId) {
      setError('Escolha o portal.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const agent = await api<{ name: string }>(
        `/admin/workspace/orphans/${orphan.findingId}/link`,
        {
          method: 'POST',
          body: JSON.stringify({ tenantId }),
        },
      );
      const domain = tenants.find((t) => t.id === tenantId)?.domain ?? 'o portal';
      onDone(`"${agent.name}" agora é um agente de ${domain}.`);
    } catch (e) {
      setError(message(e, 'Não foi possível vincular.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Vincular ${orphan.name ?? orphan.gptmakerAgentId}`}
      description="O agente passa a ser do portal: renomeado com o código dele no GPTMaker, com um modelo permitido pelo plano e os webhooks do app. Conta no limite de agentes do portal."
      onRequestClose={() => !busy && onClose()}
      footer={
        <div className="flex justify-end gap-2">
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
            onClick={() => void link()}
            disabled={busy}
            className={buttonClass()}
          >
            {busy && <Spinner className="size-4" />}
            Vincular
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Buscar portal" hint="Domínio ou código">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label="Portal">
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className={inputClass}
          >
            <option value="">Escolha…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.domain} ({t.tenantCode})
                {t.id === orphan.suggestedTenant?.id ? ' — sugerido' : ''}
              </option>
            ))}
          </select>
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Workspace GPTMaker: saúde, créditos, órfãos e agentes fora de sincronia (15.6). */
export default function AdminWorkspacePage() {
  const { api } = useAdmin();
  const operator = useOperator();
  const isAdmin = operator.role === 'ADMIN';
  const [view, setView] = useState<AdminWorkspaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linking, setLinking] = useState<Orphan | null>(null);
  const [removing, setRemoving] = useState<Orphan | null>(null);

  const load = useCallback(() => api<AdminWorkspaceView>('/admin/workspace'), [api]);
  const reload = useCallback(() => {
    void load()
      .then(setView)
      .catch((e: unknown) => setError(message(e, 'Não foi possível carregar.')));
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((v) => !cancelled && setView(v))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e, 'Não foi possível concluir.'));
    } finally {
      setBusy(null);
    }
  }

  const status = view?.status;

  return (
    <>
      <PageHeader
        title="Workspace GPTMaker"
        description="Workspace compartilhado de todos os portais: saúde, créditos do partner e agentes sem dono ou sumidos."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void act('health', async () =>
                  setView(
                    await api<AdminWorkspaceView>('/admin/workspace/health', { method: 'POST' }),
                  ),
                )
              }
              className={buttonClass('secondary')}
            >
              {busy === 'health' && <Spinner className="size-4" />}
              Checar agora
            </button>
            {isAdmin && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void act('sync', async () => {
                    const { summary } = await api<WorkspaceSyncView>('/admin/workspace/sync', {
                      method: 'POST',
                    });
                    setNotice(
                      summary
                        ? `Sincronizado: ${summary.remoteAgents} agentes no GPTMaker, ${summary.localAgents} no app; ${summary.orphansFound} órfão(s) novo(s), ${summary.missingConfirmed} sumido(s), ${summary.statusCorrected} status corrigido(s).`
                        : 'A sincronização automática já está rodando; tente de novo em alguns minutos.',
                    );
                    setView(await load());
                  })
                }
                className={buttonClass()}
              >
                {busy === 'sync' && <Spinner className="size-4" />}
                Sincronizar agora
              </button>
            )}
          </div>
        }
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
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-900">Saúde</h2>
              {status ? (
                <Badge tone={status.state === 'up' ? 'green' : 'amber'}>
                  {status.state === 'up' ? 'Funcionando' : 'Com problema'}
                </Badge>
              ) : (
                <Badge tone="zinc">Ainda não checado</Badge>
              )}
            </div>
            {status && (
              <dl className="mt-3 grid gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-zinc-500">Cobrança do partner</dt>
                  {/* Conta pós-paga: o GPTMaker cobra pelo uso; saldo pré-pago 0 é o esperado. */}
                  <dd className="mt-0.5 text-sm text-zinc-900">
                    {status.credits ? (
                      <>
                        Saldo pré-pago:{' '}
                        <span className="font-semibold tabular-nums">
                          {status.credits.toLocaleString('pt-BR')}
                        </span>
                      </>
                    ) : (
                      'Pós-paga (pelo uso)'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Assinatura no GPTMaker</dt>
                  <dd className="mt-0.5 text-sm text-zinc-900">
                    {status.subscriptionStatus ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Última checagem</dt>
                  <dd className="mt-0.5 text-sm text-zinc-900">{dateTime(status.checkedAt)}</dd>
                </div>
                {status.reason && (
                  <div>
                    <dt className="text-xs text-zinc-500">Motivo</dt>
                    <dd className="mt-0.5 text-sm text-amber-800">{status.reason}</dd>
                  </div>
                )}
              </dl>
            )}
          </Card>

          <Card>
            <div className="border-b border-zinc-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-zinc-900">
                Agentes órfãos ({view.orphans.length})
              </h2>
              <p className="text-xs text-zinc-500">
                Existem no GPTMaker sem um portal dono no app. Consomem créditos do partner se
                receberem conversas.
              </p>
            </div>
            {view.orphans.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Nenhum órfão.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {view.orphans.map((o) => (
                  <li
                    key={o.findingId}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-zinc-900">{o.name ?? 'Sem nome'}</p>
                      <p className="text-xs text-zinc-500">
                        <GptMakerAgentLink id={o.gptmakerAgentId} /> · encontrado em{' '}
                        {dateTime(o.detectedAt)}
                        {o.suggestedTenant && <> · sugerido: {o.suggestedTenant.domain}</>}
                      </p>
                      {o.removedLocally && (
                        <p className="text-xs text-amber-700">
                          Removido no app e ainda no GPTMaker: remova.
                        </p>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1">
                        {!o.removedLocally && (
                          <button
                            type="button"
                            onClick={() => setLinking(o)}
                            className={buttonClass('ghost', 'sm')}
                          >
                            Vincular
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setRemoving(o)}
                          className={buttonClass('ghost-danger', 'sm')}
                        >
                          Remover do GPTMaker
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="border-b border-zinc-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-zinc-900">
                Fora de sincronia ({view.outOfSync.length})
              </h2>
              <p className="text-xs text-zinc-500">
                Agentes do app que sumiram do GPTMaker: o chatbot parou de encaminhar. O cliente
                pode remover no app; recriar, só criando um agente novo.
              </p>
            </div>
            {view.outOfSync.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">Nenhum agente fora de sincronia.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {view.outOfSync.map((a) => (
                  <li
                    key={a.agentId}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-zinc-900">{a.name}</p>
                      <p className="text-xs text-zinc-500">
                        <GptMakerAgentLink id={a.gptmakerAgentId} /> · desde{' '}
                        {dateTime(a.detectedAt)}
                      </p>
                    </div>
                    <Link
                      href={`/admin/tenants/${a.tenant.id}`}
                      className="text-sm text-brand-700 hover:underline"
                    >
                      {a.tenant.domain}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {view.recent.length > 0 && (
            <Card>
              <h2 className="border-b border-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900">
                Resolvidos recentemente
              </h2>
              <ul className="divide-y divide-zinc-100">
                {view.recent.map((r, index) => (
                  <li
                    key={index}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm"
                  >
                    <span className="text-zinc-700">
                      {r.kind === 'ORPHAN'
                        ? 'Órfão'
                        : r.kind === 'MISSING'
                          ? 'Sumido'
                          : 'Status divergente'}{' '}
                      · {r.resolution ?? 'resolvido'}
                    </span>
                    <span className="text-xs text-zinc-500">{dateTime(r.resolvedAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {linking && (
        <LinkOrphan
          orphan={linking}
          onClose={() => setLinking(null)}
          onDone={(text) => {
            setLinking(null);
            setNotice(text);
            reload();
          }}
        />
      )}
      {removing && (
        <Modal
          title="Remover do GPTMaker"
          description={`O agente "${removing.name ?? removing.gptmakerAgentId}" é apagado do workspace. Não dá para desfazer.`}
          onRequestClose={() => setRemoving(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoving(null)}
                className={buttonClass('secondary')}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void act('remove', async () => {
                    setView(
                      await api<AdminWorkspaceView>(
                        `/admin/workspace/orphans/${removing.findingId}/remove`,
                        { method: 'POST' },
                      ),
                    );
                    setNotice('Órfão removido do GPTMaker.');
                    setRemoving(null);
                  })
                }
                className={buttonClass('danger')}
              >
                {busy === 'remove' && <Spinner className="size-4" />}
                Remover
              </button>
            </div>
          }
        >
          <p className="text-sm text-zinc-600">
            Use quando o agente foi criado por engano ou de teste.
          </p>
        </Modal>
      )}
    </>
  );
}
