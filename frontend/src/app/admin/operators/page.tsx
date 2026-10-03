'use client';

import {
  type CreatedOperatorView,
  createOperatorSchema,
  type OperatorRole,
  type OperatorView,
} from '@gptmaker/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { PlusIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { Field, inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';

const ROLES: Record<OperatorRole, string> = { ADMIN: 'Administrador', SUPPORT: 'Suporte' };

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

function formatDateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : 'nunca';
}

/** Senha temporária mostrada uma vez, para o ADMIN repassar por um canal seguro. */
function TemporaryPassword({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title="Senha temporária"
      description={`Repasse para ${email} por um canal seguro. Ela não aparece de novo.`}
      onRequestClose={onClose}
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass()}>
            Pronto
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-zinc-100 px-3 py-2 font-mono text-base">
          {password}
        </code>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(password).then(() => setCopied(true))}
          className={buttonClass('secondary')}
        >
          {copied ? 'Copiada' : 'Copiar'}
        </button>
      </div>
      <p className="mt-3 text-sm text-zinc-600">
        No primeiro login a pessoa configura o app autenticador e deve trocar a senha em “Minha
        conta”.
      </p>
    </Modal>
  );
}

function CreateOperator({
  onCreated,
  onClose,
}: {
  onCreated: (created: CreatedOperatorView) => void;
  onClose: () => void;
}) {
  const { api } = useAdmin();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<OperatorRole>('SUPPORT');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const parsed = createOperatorSchema.safeParse({ email, name, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api<CreatedOperatorView>('/admin/operators', {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        }),
      );
    } catch (e) {
      setError(message(e, 'Não foi possível criar o operador.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Novo operador"
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
            className={buttonClass()}
          >
            {busy && <Spinner className="size-4" />}
            Criar
          </button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label="E-mail">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Perfil" hint="Suporte só consulta; Administrador também altera.">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OperatorRole)}
            className={inputClass}
          >
            <option value="SUPPORT">Suporte</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  );
}

/** Operadores do backoffice: todos consultam; só ADMIN cria e altera (tudo auditado). */
export default function OperatorsPage() {
  const { api } = useAdmin();
  const me = useOperator();
  const isAdmin = me.role === 'ADMIN';
  const [operators, setOperators] = useState<OperatorView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(() => api<OperatorView[]>('/admin/operators'), [api]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((list) => !cancelled && setOperators(list))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      setOperators(await load());
    } catch (e) {
      setError(message(e, 'Não foi possível concluir.'));
    } finally {
      setBusyId(null);
    }
  }

  const patch = (op: OperatorView, body: Partial<Pick<OperatorView, 'active' | 'role'>>) =>
    run(op.id, () =>
      api(`/admin/operators/${op.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    );

  return (
    <>
      <PageHeader
        title="Operadores"
        description="Quem acessa o backoffice. Login com senha e app autenticador."
        actions={
          isAdmin && (
            <button type="button" onClick={() => setCreating(true)} className={buttonClass()}>
              <PlusIcon className="size-4" />
              Novo operador
            </button>
          )
        }
      />
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {!operators && !error && <Loading />}
      {operators && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-2xl text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2.5 font-medium">Operador</th>
                <th className="px-4 py-2.5 font-medium">Perfil</th>
                <th className="px-4 py-2.5 font-medium">Situação</th>
                <th className="px-4 py-2.5 font-medium">Último acesso</th>
                {isAdmin && <th className="px-4 py-2.5 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => (
                <tr key={op.id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-900">
                      {op.name}
                      {op.id === me.id && (
                        <span className="ml-1 text-xs text-zinc-400">(você)</span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">{op.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin && op.id !== me.id ? (
                      <select
                        value={op.role}
                        disabled={busyId === op.id}
                        onChange={(e) => void patch(op, { role: e.target.value as OperatorRole })}
                        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
                      >
                        <option value="SUPPORT">Suporte</option>
                        <option value="ADMIN">Administrador</option>
                      </select>
                    ) : (
                      ROLES[op.role]
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={op.active ? 'green' : 'zinc'}>
                        {op.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                      {!op.totpConfigured && <Badge tone="amber">Autenticador pendente</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{formatDateTime(op.lastLoginAt)}</td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      {op.id !== me.id && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {busyId === op.id && <Spinner className="size-4" />}
                          <button
                            type="button"
                            disabled={busyId === op.id}
                            onClick={() => void patch(op, { active: !op.active })}
                            className={buttonClass(op.active ? 'ghost-danger' : 'ghost', 'sm')}
                          >
                            {op.active ? 'Desativar' : 'Reativar'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === op.id}
                            onClick={() =>
                              void run(op.id, () =>
                                api(`/admin/operators/${op.id}/reset-totp`, { method: 'POST' }),
                              )
                            }
                            className={buttonClass('ghost', 'sm')}
                          >
                            Zerar autenticador
                          </button>
                          <button
                            type="button"
                            disabled={busyId === op.id}
                            onClick={() =>
                              void run(op.id, async () => {
                                const { temporaryPassword } = await api<{
                                  temporaryPassword: string;
                                }>(`/admin/operators/${op.id}/reset-password`, { method: 'POST' });
                                setSecret({ email: op.email, password: temporaryPassword });
                              })
                            }
                            className={buttonClass('ghost', 'sm')}
                          >
                            Nova senha
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <CreateOperator
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setSecret({ email: created.operator.email, password: created.temporaryPassword });
            void load().then(setOperators);
          }}
        />
      )}
      {secret && <TemporaryPassword {...secret} onClose={() => setSecret(null)} />}
    </>
  );
}
