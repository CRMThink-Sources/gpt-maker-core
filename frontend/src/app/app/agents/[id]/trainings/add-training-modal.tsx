'use client';

import {
  type CreateTrainingInput,
  TRAINING_TEXT_MAX,
  type TrainingInterval,
} from '@gptmaker/contracts';
import { useState, type ComponentType, type FormEvent, type SVGProps } from 'react';
import { GlobeIcon, TextIcon, VideoIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, buttonClass } from '@/components/ui';
import { useErrorMessage, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { TRAINING_INTERVAL_KEYS, trainingIntervalLabel } from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';
import { Field, inputClass } from '../../agent-fields';
import { TrainingImageField } from '../../training-image-field';

type Kind = 'TEXT' | 'WEBSITE' | 'VIDEO';

const KINDS: Array<{
  kind: Kind;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { kind: 'TEXT', icon: TextIcon },
  { kind: 'WEBSITE', icon: GlobeIcon },
  { kind: 'VIDEO', icon: VideoIcon },
];

/**
 * Adiciona um texto (com imagem opcional), site ou vídeo ao agente. Texto é sempre liberado, ao
 * lado dos itens da base do formulário da função; site e vídeo só no modo avançado
 * (`mediaAllowed`); documento não é mais aceito (spec agent-training).
 */
export function AddTrainingModal({
  agentId,
  mediaAllowed,
  onClose,
  onCreated,
}: {
  agentId: string;
  mediaAllowed: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { api } = useAppSession();
  const t = useT('trainings');
  const tc = useT('common');
  const translateError = useErrorMessage('trainings');
  const kinds = KINDS.filter((option) => option.kind === 'TEXT' || mediaAllowed);
  const [kind, setKind] = useState<Kind>('TEXT');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [subPages, setSubPages] = useState(false);
  // Intervalo de re-treinamento do site.
  const [refresh, setRefresh] = useState<TrainingInterval>('NEVER');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body: CreateTrainingInput =
        kind === 'TEXT'
          ? { type: 'TEXT', text: text.trim(), ...(image && { imageId: image.id }) }
          : kind === 'WEBSITE'
            ? { type: 'WEBSITE', url, trainingSubPages: subPages, trainingInterval: refresh }
            : { type: 'VIDEO', url };
      await api(`/app/agents/${agentId}/trainings`, { method: 'POST', body: JSON.stringify(body) });
      onCreated();
    } catch (e) {
      setError(errorMessage(e, t('add.error'), translateError));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t('add.title')}
      description={t('add.description')}
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
            form="add-training"
            disabled={(kind === 'TEXT' ? text.trim() === '' : url.trim() === '') || saving}
            className={buttonClass('primary')}
          >
            {saving ? t('add.sending') : t('add.submit')}
          </button>
        </div>
      }
    >
      <div
        className={`grid gap-2 ${kinds.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}
        role="radiogroup"
        aria-label={t('add.typeLabel')}
      >
        {kinds.map((option) => {
          const Icon = option.icon;
          const selected = option.kind === kind;
          return (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => {
                setKind(option.kind);
                setError(null);
              }}
              className={`flex flex-col items-start rounded-lg border p-3 text-left text-sm transition-colors ${
                selected
                  ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500'
                  : 'border-zinc-200 hover:border-zinc-300'
              }`}
            >
              <Icon className={`size-5 ${selected ? 'text-brand-600' : 'text-zinc-400'}`} />
              <span className="mt-2 font-medium text-zinc-900">
                {t(`add.kinds.${option.kind}.label`)}
              </span>
              <span className="text-xs text-zinc-500">{t(`add.kinds.${option.kind}.hint`)}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <Alert tone="error" className="mt-5">
          {error}
        </Alert>
      )}

      <form id="add-training" onSubmit={submit} className="mt-5">
        <fieldset disabled={saving} className="space-y-5">
          {kind === 'TEXT' && (
            <>
              <Field
                label={t('add.textLabel')}
                hint={t('add.textCount', { count: text.length, max: TRAINING_TEXT_MAX })}
              >
                <textarea
                  className={inputClass}
                  rows={6}
                  required
                  autoFocus
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
            </>
          )}
          {kind !== 'TEXT' && (
            <Field
              label={kind === 'WEBSITE' ? t('add.siteLabel') : t('add.videoLabel')}
              hint={kind === 'VIDEO' ? t('add.videoHint') : undefined}
            >
              <input
                className={inputClass}
                type="url"
                required
                autoFocus
                maxLength={2000}
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
          )}

          {kind === 'WEBSITE' && (
            <>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-brand-600"
                  checked={subPages}
                  onChange={(e) => setSubPages(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-zinc-800">{t('add.subPagesLabel')}</span>
                  <span className="block text-xs text-zinc-500">{t('add.subPagesHint')}</span>
                </span>
              </label>
              <Field label={t('add.refreshLabel')} hint={t('add.refreshHint')}>
                <select
                  className={inputClass}
                  value={refresh}
                  onChange={(e) => setRefresh(e.target.value as TrainingInterval)}
                >
                  {TRAINING_INTERVAL_KEYS.map((value) => (
                    <option key={value} value={value}>
                      {trainingIntervalLabel(value, t)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
