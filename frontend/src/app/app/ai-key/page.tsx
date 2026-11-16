'use client';

import type { AiKeyView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Alert, buttonClass, Card, Loading, PageHeader } from '@/components/ui';
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { useAppSession } from '../session-provider';

/**
 * Chave do Vibecode do cliente para a revisão por IA (spec agent-knowledge-review, "Chave de IA do
 * cliente"). Só o administrador do portal salva: a chave `vibe_api_` pode abrir dados dele. A chave
 * nunca volta da API: a tela mostra só que há chave, o final e quando foi testada.
 */
export default function AiKeyPage() {
  const { session, api } = useAppSession();
  const t = useT('aiKey');
  const format = useFormat();
  const errorText = useErrorMessage('aiKey');
  const [view, setView] = useState<AiKeyView | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<AiKeyView>('/app/ai-key').then(setView), [api]);

  useEffect(() => {
    load().catch(() => setError(t('errors.load')));
    // Trocar o idioma não deve refazer a consulta; só o texto de erro usa `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setNotice(t('saved'));
    } catch (e) {
      setError(errorMessage(e, t('errors.save'), errorText));
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
      setNotice(t('removed'));
    } catch (e) {
      setError(errorMessage(e, t('errors.remove'), errorText));
    } finally {
      setBusy(false);
    }
  }

  if (!session.user.isAdmin) {
    return <Alert tone="warning">{t('adminOnly')}</Alert>;
  }
  if (!view) return error ? <Alert tone="error">{error}</Alert> : <Loading />;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card className="space-y-4 p-5">
        {view.configured ? (
          <p className="text-sm text-zinc-700" data-testid="ai-key-status">
            {view.verifiedAt
              ? t('configuredVerified', {
                  last4: view.last4 ?? '',
                  date: format.dateTime(new Date(view.verifiedAt), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }),
                })
              : t('configured', { last4: view.last4 ?? '' })}
          </p>
        ) : (
          <p className="text-sm text-zinc-700">
            {view.platformAvailable ? t('notConfigured') : t('notConfiguredUnavailable')}
          </p>
        )}
        <label className="block text-sm">
          <span className="font-medium text-zinc-800">
            {view.configured ? t('replaceKey') : t('keyLabel')}
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
          <li>{t('hints.scope')}</li>
          <li>{t('hints.sent')}</li>
          <li>{t('hints.stored')}</li>
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={busy || !value.trim()}
            onClick={save}
          >
            {busy ? t('testing') : t('testAndSave')}
          </button>
          {view.configured && (
            <button
              type="button"
              className={buttonClass('secondary')}
              disabled={busy}
              onClick={remove}
            >
              {t('removeKey')}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
