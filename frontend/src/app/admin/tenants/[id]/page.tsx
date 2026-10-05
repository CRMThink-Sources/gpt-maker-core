'use client';

import {
  type AdminTenantDetail,
  grantCreditsSchema,
  suspendTenantSchema,
} from '@gptmaker/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../../admin-provider';
import { GptMakerAgentLink } from '../../gptmaker-link';
import { credits, dateTime, TenantStatusBadge } from '../shared';
import { TenantFailures } from './failures';
import { SubscriptionSection } from './subscription';

const ENTRY_LABELS: Record<string, string> = {
  GRANT: 'Crédito do ciclo',
  TOPUP: 'Créditos adicionais',
  ADJUSTMENT: 'Ajuste',
  EXPIRE: 'Expiração',
  REFUND: 'Estorno',
};

const WALLETS = { TRIAL: 'teste', PLAN: 'plano', EXTRA: 'adicional' } as const;

const NOTIFICATION_LABELS: Record<string, string> = {
  CREDIT_80: '80% consumido',
  CREDIT_ZERO: 'Créditos esgotados',
  PAYMENT_FAILED: 'Pagamento recusado',
  PERIOD_ENDING: 'Fim de período',
  MODEL_DOWNGRADED: 'Modelo trocado',
  TEST: 'Teste',
};

const AGENT_STATUS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  OUT_OF_SYNC: 'Fora de sincronia',
};

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

/** Modal de ação com motivo (e quantidade, na concessão). */
function ActionModal({
  title,
  description,
  confirm,
  danger,
  withAmount,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
  withAmount?: boolean;
  onClose: () => void;
  onSubmit: (input: { reason: string; amount: number | null }) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ reason, amount });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      description={description}
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
            onClick={() => void submit()}
            disabled={busy}
            className={buttonClass(danger ? 'danger' : 'primary')}
          >
            {busy && <Spinner className="size-4" />}
            {confirm}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {withAmount && (
          <Field label="Créditos">
            <input
              type="number"
              min={1}
              value={amount ?? ''}
              onChange={(e) => setAmount(e.target.value === '' ? null : Number(e.target.value))}
              className={inputClass}
              autoFocus
            />
          </Field>
        )}
        <Field label="Motivo" hint="Fica registrado na auditoria.">
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
            autoFocus={!withAmount}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900">{value}</dd>
    </div>
  );
}

/** Detalhe do portal: assinatura, saldo, agentes, movimentações e avisos; ações do ADMIN (15.4). */
export default function AdminTenantPage() {
  const { id } = useParams<{ id: string }>();
  const { api } = useAdmin();
  const operator = useOperator();
  const isAdmin = operator.role === 'ADMIN';
  const [tenant, setTenant] = useState<AdminTenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'suspend' | 'reactivate' | 'grant' | null>(null);
  // Um id por abertura do modal: reenviar depois de uma resposta perdida não concede duas vezes.
  const [grantRequestId, setGrantRequestId] = useState('');

  const load = useCallback(() => api<AdminTenantDetail>(`/admin/tenants/${id}`), [api, id]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((row) => !cancelled && setTenant(row))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function post(path: string, body?: unknown) {
    try {
      setTenant(
        await api<AdminTenantDetail>(`/admin/tenants/${id}/${path}`, {
          method: 'POST',
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      setAction(null);
    } catch (e) {
      throw new Error(message(e, 'Não foi possível concluir.'));
    }
  }

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!tenant) return <Loading />;

  return (
    <>
      <PageHeader
        back={{ href: '/admin/tenants', label: 'Portais' }}
        title={tenant.domain}
        aside={<TenantStatusBadge status={tenant.status} />}
        description={`Código ${tenant.tenantCode} · instalação ${tenant.installationId} · instalado em ${dateTime(tenant.installedAt)}`}
        actions={
          isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/admin/audit?tenantId=${tenant.id}`} className={buttonClass('ghost')}>
                Auditoria
              </Link>
              <button
                type="button"
                onClick={() => {
                  setGrantRequestId(crypto.randomUUID());
                  setAction('grant');
                }}
                className={buttonClass('secondary')}
              >
                Conceder créditos
              </button>
              {tenant.status === 'SUSPENDED' ? (
                <button
                  type="button"
                  onClick={() => setAction('reactivate')}
                  className={buttonClass()}
                >
                  Reativar
                </button>
              ) : (
                tenant.status !== 'UNINSTALLED' && (
                  <button
                    type="button"
                    onClick={() => setAction('suspend')}
                    className={buttonClass('danger')}
                  >
                    Suspender
                  </button>
                )
              )}
            </div>
          )
        }
      />

      {tenant.status === 'SUSPENDED' && (
        <Alert tone="warning" className="mb-4">
          Suspenso{tenant.suspendedReason ? `: ${tenant.suspendedReason}` : ''}. Os agentes estão
          pausados e as mensagens não vão para o GPTMaker.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-zinc-900">Saldo</h2>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
            {credits(tenant.balance.total)}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <Fact label="Teste" value={credits(tenant.balance.trial)} />
            <Fact label="Plano" value={credits(tenant.balance.plan)} />
            <Fact label="Adicional" value={credits(tenant.balance.extra)} />
          </dl>
          <dl className="mt-3 space-y-2">
            {tenant.trialEndsAt && (
              <Fact label="Fim do teste" value={dateTime(tenant.trialEndsAt)} />
            )}
            {tenant.expiresAt && (
              <Fact label="Plano e adicional valem até" value={dateTime(tenant.expiresAt)} />
            )}
            <Fact
              label="Últimos 7 dias"
              value={`${credits(tenant.usage7d.responses)} respostas · ${credits(tenant.usage7d.credits)} créditos`}
            />
          </dl>
        </Card>

        <SubscriptionSection
          tenantId={tenant.id}
          isAdmin={isAdmin}
          onChanged={() => void load().then(setTenant)}
          className="lg:col-span-2"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900">
            Agentes ({tenant.agentList.length})
          </h2>
          {tenant.agentList.length === 0 ? (
            <p className="px-5 py-4 text-sm text-zinc-500">Nenhum agente.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {tenant.agentList.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-zinc-900">{a.name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                      {a.model ?? 'sem modelo'} · <GptMakerAgentLink id={a.gptmakerAgentId} />
                    </p>
                  </div>
                  <Badge tone={a.status === 'ACTIVE' ? 'green' : 'zinc'}>
                    {AGENT_STATUS[a.status] ?? a.status}
                    {a.inactiveReason ? ` · ${a.inactiveReason}` : ''}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="border-b border-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900">
            Avisos enviados
          </h2>
          {tenant.notifications.length === 0 ? (
            <p className="px-5 py-4 text-sm text-zinc-500">Nenhum aviso.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {tenant.notifications.map((n, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <span className="text-zinc-900">{NOTIFICATION_LABELS[n.type] ?? n.type}</span>
                  <span className="text-xs text-zinc-500">
                    {n.status === 'SENT' ? `${n.sentTo.length} destinatário(s)` : n.status} ·{' '}
                    {dateTime(n.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="border-b border-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900">
          Últimas movimentações
        </h2>
        {tenant.entries.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-500">Nenhuma movimentação.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {tenant.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-900">
                    {ENTRY_LABELS[e.type] ?? e.type}{' '}
                    <span className="text-xs text-zinc-500">
                      · {WALLETS[e.wallet]} · {dateTime(e.createdAt)}
                    </span>
                  </p>
                  {e.reason && <p className="truncate text-xs text-zinc-500">{e.reason}</p>}
                </div>
                <span
                  className={`font-semibold tabular-nums ${e.amount > 0 ? 'text-emerald-700' : 'text-zinc-700'}`}
                >
                  {e.amount > 0 ? '+' : '−'}
                  {credits(Math.abs(e.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TenantFailures tenantId={tenant.id} />

      {action === 'suspend' && (
        <ActionModal
          title="Suspender portal"
          description="Os agentes são pausados e as mensagens deixam de ir para o GPTMaker até a reativação."
          confirm="Suspender"
          danger
          onClose={() => setAction(null)}
          onSubmit={async ({ reason }) => {
            const parsed = suspendTenantSchema.safeParse({ reason });
            if (!parsed.success)
              throw new Error(parsed.error.issues[0]?.message ?? 'Motivo inválido.');
            await post('suspend', parsed.data);
          }}
        />
      )}
      {action === 'reactivate' && (
        <Modal
          title="Reativar portal"
          description="Os agentes pausados pela suspensão voltam a atender."
          onRequestClose={() => setAction(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAction(null)}
                className={buttonClass('secondary')}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void post('reactivate').catch((e: Error) => setError(e.message))}
                className={buttonClass()}
              >
                Reativar
              </button>
            </div>
          }
        >
          <p className="text-sm text-zinc-600">
            Suspenso por: {tenant.suspendedReason ?? 'motivo não registrado'}.
          </p>
        </Modal>
      )}
      {action === 'grant' && (
        <ActionModal
          title="Conceder créditos"
          description="Entram como créditos adicionais e expiram com o ciclo atual do plano."
          confirm="Conceder"
          withAmount
          onClose={() => setAction(null)}
          onSubmit={async ({ reason, amount }) => {
            if (amount === null) throw new Error('Informe a quantidade de créditos.');
            const parsed = grantCreditsSchema.safeParse({
              amount,
              reason,
              requestId: grantRequestId,
            });
            if (!parsed.success)
              throw new Error(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
            await post('credits', parsed.data);
          }}
        />
      )}
    </>
  );
}
