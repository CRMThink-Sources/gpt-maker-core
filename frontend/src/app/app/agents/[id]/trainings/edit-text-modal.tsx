'use client';

import {
  TRAINING_TEXT_MAX,
  type TrainingView,
  type UpdateTrainingInput,
} from '@gptmaker/contracts';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/modal';
import { Alert, buttonClass } from '@/components/ui';
import { useErrorMessage, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { useAppSession } from '../../../session-provider';
import { Field, inputClass } from '../../agent-fields';
import { TrainingImageField } from '../../training-image-field';

/**
 * Edita um texto manual: o texto e a imagem (trocar ou remover). Só o que mudou vai no PATCH:
 * `imageId` ausente mantém a imagem; `null` a remove (spec agent-training-image).
 */
export function EditTextTrainingModal({
  agentId,
  training,
  onClose,
  onSaved,
}: {
  agentId: string;
  training: TrainingView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAppSession();
  const t = useT('trainings');
  const tc = useT('common');
  const translateError = useErrorMessage('trainings');
  const [text, setText] = useState(training.text ?? '');
  const [image, setImage] = useState<{ id: string; url: string } | null>(
    training.image ? { id: training.image.id, url: training.image.url } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const body: UpdateTrainingInput = {};
  if (text.trim() !== (training.text ?? '')) body.text = text.trim();
  if ((image?.id ?? null) !== (training.image?.id ?? null)) body.imageId = image?.id ?? null;
  const changed = Object.keys(body).length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api(`/app/agents/${agentId}/trainings/${training.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e, t('edit.error'), translateError));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t('edit.title')}
      description={t('edit.description')}
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
            form="edit-text-training"
            disabled={!changed || text.trim() === '' || saving}
            className={buttonClass('primary')}
          >
            {saving ? t('edit.saving') : tc('save')}
          </button>
        </div>
      }
    >
      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}
      <form id="edit-text-training" onSubmit={submit}>
        <fieldset disabled={saving} className="space-y-5">
          <Field
            label={t('add.textLabel')}
            hint={t('add.textCount', { count: text.length, max: TRAINING_TEXT_MAX })}
          >
            <textarea
              className={inputClass}
              rows={6}
              required
              maxLength={TRAINING_TEXT_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <TrainingImageField
            agentId={agentId}
            imageId={image?.id ?? null}
            previewUrl={image?.url}
            onChange={setImage}
            disabled={saving}
          />
        </fieldset>
      </form>
    </Modal>
  );
}
