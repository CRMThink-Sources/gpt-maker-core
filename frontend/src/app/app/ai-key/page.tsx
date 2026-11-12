'use client';

import type { AiKeyView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Alert, buttonClass, Card, Loading, PageHeader } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { useAppSession } from '../session-provider';

/**
 * Chave do Vibecode do cliente para a revisão por IA (spec agent-knowledge-review, "Chave de IA do
 * cliente"). Só o administrador do portal salva: a chave `vibe_api_` pode abrir dados dele. A chave
 * nunca volta da API: a tela mostra só que há chave, o final e quando foi testada.
 */
export default function AiKeyPage() {
  const { session, api } = useAppSession();
  const [view, setView] = useState<AiKeyView | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<AiKeyView>('/app/ai-key').then(setView), [api]);

  useEffect(() => {
    load().catch(() => setError('Não foi possível carregar a chave.'));
  }, [load]);

  async function save() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setView(
        await api<AiKeyView>('/app/ai-key', {
          method: 'PUT',
          body: JSON.stringify({ apiKey: value.trim() }),
        }),
      );
      setValue('');
      setNotice('Chave testada e salva.');
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível salvar a chave.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api('/app/ai-key', { method: 'DELETE' });
      await load();
      setNotice('Chave removida. A revisão por IA passa a usar créditos.');
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível remover a chave.'));
    } finally {
      setBusy(false);
    }
  }

  if (!session.user.isAdmin) {
    return <Alert tone="warning">Só administradores do portal configuram a chave Vibecode.</Alert>;
  }
  if (!view) return error ? <Alert tone="error">{error}</Alert> : <Loading />;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Chave Vibecode"
        description="Use a sua chave do Vibecode do Bitrix24 para a revisão por IA da função, sem gastar créditos."
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card className="space-y-4 p-5">
        {view.configured ? (
          <p className="text-sm text-zinc-700" data-testid="ai-key-status">
            Chave configurada, final {view.last4}
            {view.verifiedAt && `, testada em ${new Date(view.verifiedAt).toLocaleString('pt-BR')}`}
            .
          </p>
        ) : (
          <p className="text-sm text-zinc-700">
            Nenhuma chave salva. A revisão por IA usa os créditos do app
            {view.platformAvailable
              ? ''
              : ' e, no momento, está indisponível sem uma chave própria'}
            .
          </p>
        )}
        <label className="block text-sm">
          <span className="font-medium text-zinc-800">
            {view.configured ? 'Trocar a chave' : 'Chave do Vibecode'}
          </span>
          <input
            type="password"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            placeholder="vibe_api_…"
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-500">
          <li>
            Crie a chave só com o escopo vibe:ai: ela não precisa de acesso aos dados do portal.
          </li>
          <li>O texto da função e da base é enviado ao Vibecode na revisão por IA.</li>
          <li>A chave é guardada cifrada e não aparece de novo depois de salva.</li>
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={busy || !value.trim()}
            onClick={save}
          >
            {busy ? 'Testando…' : 'Testar e salvar'}
          </button>
          {view.configured && (
            <button
              type="button"
              className={buttonClass('secondary')}
              disabled={busy}
              onClick={remove}
            >
              Remover chave
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
