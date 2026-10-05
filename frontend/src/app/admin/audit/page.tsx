'use client';

import type { AdminAuditEntry, AdminAuditPage, OperatorView } from '@gptmaker/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { inputClass } from '../../app/agents/agent-fields';
import { useAdmin } from '../admin-provider';

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

/** Nomes das ações com registro próprio; as demais aparecem como a rota chamada. */
const ACTIONS: Record<string, string> = {
  'operator.login': 'Entrou no backoffice',
  'operator.logout': 'Saiu do backoffice',
  'operator.totp_configured': 'Configurou o TOTP',
  'operator.created': 'Criou operador',
  'operator.updated': 'Alterou operador',
  'operator.totp_reset': 'Zerou o TOTP de operador',
  'operator.password_reset': 'Gerou senha temporária',
  'operator.password_changed': 'Trocou a própria senha',
  'plan.rights_updated': 'Alterou direitos do plano',
  'tenant.suspended': 'Suspendeu o portal',
  'tenant.reactivated': 'Reativou o portal',
  'tenant.credits_granted': 'Concedeu créditos',
  'model.created': 'Criou modelo',
  'model.updated': 'Alterou modelo',
  'model.default_set': 'Definiu modelo padrão',
  'model.activated': 'Ativou modelo',
  'model.deactivated': 'Inativou modelo',
  'model.removed': 'Removeu modelo',
  'workspace.orphan_linked': 'Vinculou órfão a portal',
  'workspace.orphan_removed': 'Removeu órfão do GPTMaker',
  'workspace.sync_requested': 'Sincronizou o workspace',
  'reconciliation.approved': 'Aprovou ajuste da reconciliação',
  'reconciliation.dismissed': 'Descartou ajuste da reconciliação',
  'subscription.checked': 'Conferiu assinatura com a plataforma',
  'operations.dlq_purged': 'Descartou mensagens da DLQ',
};

const GROUPS = [
  { value: '', label: 'Todas as ações' },
  { value: 'tenant.', label: 'Portais' },
  { value: 'operator.', label: 'Operadores e acesso' },
  { value: 'plan.', label: 'Planos' },
  { value: 'model.', label: 'Modelos' },
  { value: 'workspace.', label: 'Workspace' },
  { value: 'reconciliation.', label: 'Reconciliação' },
  { value: 'subscription.', label: 'Assinaturas' },
  { value: 'operations.', label: 'Filas (DLQ)' },
  { value: 'POST ', label: 'Outras escritas (rota)' },
];

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

function failed(entry: AdminAuditEntry): boolean {
  return (entry.after as { ok?: boolean } | null)?.ok === false;
}

function Entry({ entry }: { entry: AdminAuditEntry }) {
  const [open, setOpen] = useState(false);
  const label = ACTIONS[entry.action];
  return (
    <li className="px-5 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-36 shrink-0 text-xs tabular-nums text-zinc-500">
          {dateTime(entry.createdAt)}
        </span>
        <span className="font-medium text-zinc-900">
          {entry.actor.name ?? (entry.actor.type === 'SYSTEM' ? 'Sistema' : entry.actor.id)}
        </span>
        <span className={failed(entry) ? 'text-red-700' : 'text-zinc-700'}>
          {label ?? <code className="text-xs">{entry.action}</code>}
          {failed(entry) && ' (falhou)'}
        </span>
        {entry.tenant && (
          <Link
            href={`/admin/tenants/${entry.tenant.id}`}
            className="text-xs text-brand-700 hover:underline"
          >
            {entry.tenant.domain}
          </Link>
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-900"
          aria-expanded={open}
        >
          {open ? 'Ocultar' : 'Detalhes'}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
          <p>
            {entry.entityType}
            {entry.entityId && (
              <>
                {' '}
                · <code>{entry.entityId}</code>
              </>
            )}
            {entry.traceId && (
              <>
                {' '}
                · trace <code>{entry.traceId}</code>
              </>
            )}
          </p>
          {entry.reason && <p>Motivo: {entry.reason}</p>}
          <div className="grid gap-2 md:grid-cols-2">
            {entry.before != null && (
              <div>
                <p className="font-medium text-zinc-500">Antes</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(entry.before, null, 2)}
                </pre>
              </div>
            )}
            {entry.after != null && (
              <div>
                <p className="font-medium text-zinc-500">Depois</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(entry.after, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function AuditTrail() {
  const { api } = useAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const tenantId = params.get('tenantId') ?? '';
  const actorId = params.get('actorId') ?? '';
  const action = params.get('action') ?? '';
  const filters = new URLSearchParams(
    Object.entries({ tenantId, actorId, action }).filter(([, value]) => value),
  ).toString();

  const [operators, setOperators] = useState<OperatorView[]>([]);
  const [page, setPage] = useState<{ filters: string; data: AdminAuditPage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    api<OperatorView[]>('/admin/operators')
      .then(setOperators)
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api<AdminAuditPage>(`/admin/audit?${filters}`)
      .then((data) => !cancelled && setPage({ filters, data }))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [api, filters]);

  function filter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    setError(null);
    router.replace(`/admin/audit${next.size ? `?${next}` : ''}`);
  }

  async function loadMore() {
    if (!page?.data.nextCursor) return;
    setMore(true);
    try {
      const cursor = new URLSearchParams(filters);
      cursor.set('cursor', page.data.nextCursor);
      const data = await api<AdminAuditPage>(`/admin/audit?${cursor}`);
      setPage({
        filters,
        data: { items: [...page.data.items, ...data.items], nextCursor: data.nextCursor },
      });
    } catch (e) {
      setError(message(e, 'Não foi possível carregar.'));
    } finally {
      setMore(false);
    }
  }

  const current = page?.filters === filters ? page.data : null;
  const tenantDomain = current?.items.find((i) => i.tenant?.id === tenantId)?.tenant?.domain;

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Tudo o que os operadores fizeram no backoffice, mais recente primeiro. Senhas e códigos nunca são gravados."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={actorId}
          onChange={(e) => filter('actorId', e.target.value)}
          className={`${inputClass} w-auto`}
          aria-label="Operador"
        >
          <option value="">Todos os operadores</option>
          {operators.map((op) => (
            <option key={op.id} value={op.id}>
              {op.name}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => filter('action', e.target.value)}
          className={`${inputClass} w-auto`}
          aria-label="Ação"
        >
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        {tenantId && (
          <span className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700">
            Portal: {tenantDomain ?? tenantId.slice(0, 8)}
            <button
              type="button"
              onClick={() => filter('tenantId', '')}
              className="text-zinc-500 hover:text-zinc-900"
              aria-label="Remover filtro de portal"
            >
              ×
            </button>
          </span>
        )}
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {!current && !error && <Loading />}
      {current && (
        <Card>
          {current.items.length === 0 ? (
            <p className="px-5 py-4 text-sm text-zinc-500">Nenhuma ação registrada.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {current.items.map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
          {current.nextCursor && (
            <div className="border-t border-zinc-100 px-5 py-3">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={more}
                className={buttonClass('secondary', 'sm')}
              >
                {more && <Spinner className="size-4" />}
                Carregar mais
              </button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/** Trilha de auditoria do backoffice (15.8), só para ADMIN. */
export default function AdminAuditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuditTrail />
    </Suspense>
  );
}
