'use client';

import type { TrainingView, UpdateTrainingSettingsInput } from '@gptmaker/contracts';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/modal';
import { Alert, buttonClass } from '@/components/ui';
import { useErrorMessage, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { isoToLocalInput, localInputToIso } from '@/lib/training-list';
import { trainingTitle } from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';
import { expiresInPast, ExpiresAtField, TagsField } from './training-fields';

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * Tags e prazo de qualquer tipo de treinamento. Só grava aqui: não reenvia nada ao GPTMaker.
 * Manda só o que mudou, para não revalidar uma data que já passou e o job ainda não expirou.
 */
export function TrainingSettingsModal({
  agentId,
  training,
  availableTags,
  onClose,
  onSaved,
}: {
  agentId: string;
  training: TrainingView;
  availableTags: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAppSession();
  const t = useT('trainings');
  const tc = useT('common');
  const translateError = useErrorMessage('trainings');
  const [tags, setTags] = useState(training.tags);
  const initialExpires = isoToLocalInput(training.expiresAt);
  const [expires, setExpires] = useState(initialExpires);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tagsChanged = !sameTags(tags, training.tags);
  const expiresChanged = expires !== initialExpires;
  const invalid = expiresChanged && expiresInPast(expires);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body: UpdateTrainingSettingsInput = {
        ...(tagsChanged && { tags }),
        ...(expiresChanged && { expiresAt: expires ? localInputToIso(expires) : null }),
      };
      await api(`/app/agents/${agentId}/trainings/${training.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e, t('settings.error'), translateError));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t('settings.title')}
      description={`${trainingTitle(training, t)} — ${t('settings.description')}`}
      onRequestClose={() => !saving && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={buttonClass('secondary')}
          >
            {tc('cancel')}
          </button>
          <button
            type="submit"
            form="training-settings"
            disabled={saving || invalid || (!tagsChanged && !expiresChanged)}
            className={buttonClass('primary')}
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      }
    >
      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}
      <form id="training-settings" onSubmit={submit}>
        <fieldset disabled={saving} className="space-y-5">
          <TagsField value={tags} onChange={setTags} suggestions={availableTags} />
          {!training.managed && <ExpiresAtField value={expires} onChange={setExpires} />}
        </fieldset>
      </form>
    </Modal>
  );
}
