'use client';

import type { TrainingImportResult } from '@gptmaker/contracts';
import { useRef, useState, type ChangeEvent } from 'react';
import { Modal } from '@/components/modal';
import { Alert, buttonClass } from '@/components/ui';
import { useErrorMessage, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { checkImportFile, importReasonText, type ImportFileCheck } from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';

const REASON_KEYS = {
  NOT_JSON: 'import.notJson',
  INVALID: 'import.invalid',
  VERSION: 'import.version',
  TOO_MANY: 'import.tooMany',
} as const;

/**
 * Importa um arquivo exportado (spec agent-training-transfer): confere a forma do arquivo antes
 * de enviar, soma os treinamentos aos existentes e mostra o resultado item a item.
 */
export function ImportTrainingsModal({
  agentId,
  maxItems,
  onClose,
  onImported,
}: {
  agentId: string;
  maxItems: number;
  onClose: () => void;
  /** Chamado quando a API respondeu (mesmo com itens não criados): a lista deve recarregar. */
  onImported: () => void;
}) {
  const { api } = useAppSession();
  const t = useT('trainings');
  const translateError = useErrorMessage('trainings');
  const [check, setCheck] = useState<ImportFileCheck | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrainingImportResult | null>(null);
  const latestRead = useRef(0);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    // Ao trocar de arquivo rápido, só a última leitura vale (a antiga pode terminar depois).
    const reading = ++latestRead.current;
    if (!file) {
      setCheck(null);
      return;
    }
    const text = await file.text();
    if (reading === latestRead.current) setCheck(checkImportFile(text));
  }

  /** Tipo do item para a tela: o rótulo do tipo, não o código técnico do arquivo. */
  const typeLabel = (type: string | null) =>
    type && t.has(`types.${type}`) ? t(`types.${type}`) : (type ?? '?');

  async function submit() {
    if (!check?.ok) return;
    setError(null);
    setSending(true);
    try {
      setResult(
        await api<TrainingImportResult>(`/app/agents/${agentId}/trainings/import`, {
          method: 'POST',
          body: JSON.stringify(check.payload),
        }),
      );
      onImported();
    } catch (e) {
      setError(errorMessage(e, t('import.error'), translateError));
    } finally {
      setSending(false);
    }
  }

  const notCreated = result?.items.filter((item) => item.status !== 'CREATED') ?? [];
  const warned = result?.items.filter((item) => item.warnings.length > 0) ?? [];

  return (
    <Modal
      title={t('import.title')}
      description={t('import.description')}
      onRequestClose={() => !sending && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className={buttonClass('secondary')}
          >
            {t('import.close')}
          </button>
          {!result && (
            <button
              type="button"
              onClick={submit}
              disabled={!check?.ok || check.count === 0 || sending}
              className={buttonClass('primary')}
            >
              {sending ? t('import.sending') : t('import.submit')}
            </button>
          )}
        </div>
      }
    >
      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}

      {result ? (
        <div className="space-y-4">
          <Alert tone={notCreated.length === 0 && warned.length === 0 ? 'success' : 'warning'}>
            {t('import.summary', {
              created: result.summary.created,
              notCreated: result.summary.rejected + result.summary.failed,
            })}
          </Alert>
          {notCreated.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-zinc-900">{t('import.notCreated')}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
                {notCreated.map((item) => (
                  <li key={item.position}>
                    <span className="font-medium">
                      {t('import.item', { position: item.position, type: typeLabel(item.type) })}
                    </span>
                    {item.reason && <> — {importReasonText(item.reason, t)}</>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {warned.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-zinc-900">{t('import.withWarnings')}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
                {warned.flatMap((item) =>
                  item.warnings.map((warning) => (
                    <li key={`${item.position}-${warning.code}`}>
                      <span className="font-medium">
                        {t('import.item', { position: item.position, type: typeLabel(item.type) })}
                      </span>{' '}
                      — {importReasonText(warning, t)}
                    </li>
                  )),
                )}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-zinc-900">
            {t('import.fileLabel')}
            <input
              type="file"
              accept=".json,application/json"
              onChange={choose}
              disabled={sending}
              className="mt-2 block w-full text-sm text-zinc-700"
            />
          </label>
          {check && !check.ok && (
            <Alert tone="error">{t(REASON_KEYS[check.reason], { max: maxItems })}</Alert>
          )}
          {check?.ok && (
            <div className="space-y-2 text-sm text-zinc-600">
              <p>{t('import.chosen', { count: check.count })}</p>
              {check.withImages > 0 && (
                <p>{t('import.imagesNotice', { count: check.withImages })}</p>
              )}
            </div>
          )}
          <Alert tone="warning">{t('import.duplicatesNotice')}</Alert>
        </div>
      )}
    </Modal>
  );
}
