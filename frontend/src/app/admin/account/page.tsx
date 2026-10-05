'use client';

import { changePasswordSchema } from '@gptmaker/contracts';
import { type FormEvent, useState } from 'react';
import { Alert, buttonClass, Card, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { Field, inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';

/** Minha conta: troca de senha (encerra as sessões; entra de novo com a nova). */
export default function AdminAccountPage() {
  const { api, signOut } = useAdmin();
  const operator = useOperator();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }
    const parsed = changePasswordSchema.safeParse({ current, next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Senha inválida.');
      return;
    }
    setBusy(true);
    try {
      await api('/admin/auth/password', { method: 'POST', body: JSON.stringify(parsed.data) });
      await signOut();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Não foi possível trocar a senha.');
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Minha conta" description={`${operator.name} · ${operator.email}`} />
      <Card className="max-w-md p-6">
        <h2 className="text-base font-semibold text-zinc-900">Trocar senha</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Pelo menos 12 caracteres. Depois da troca, todas as sessões são encerradas e você entra de
          novo.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="Senha atual">
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Nova senha">
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Confirme a nova senha">
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <button type="submit" disabled={busy} className={buttonClass()}>
            {busy && <Spinner className="size-4" />}
            Trocar senha
          </button>
        </form>
      </Card>
    </>
  );
}
