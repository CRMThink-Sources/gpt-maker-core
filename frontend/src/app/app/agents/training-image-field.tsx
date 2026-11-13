'use client';

import {
  TRAINING_IMAGE_MAX_BYTES,
  TRAINING_IMAGE_MIMETYPES,
  type UploadedTrainingImage,
} from '@gptmaker/contracts';
import { useRef, useState } from 'react';
import { createT, type T, useT } from '@/i18n';
import { useAppSession } from '../session-provider';
import { useApiFailure } from './agent-fields';

const ACCEPT = TRAINING_IMAGE_MIMETYPES.join(',');
const MAX_MB = Math.round(TRAINING_IMAGE_MAX_BYTES / (1024 * 1024));

/** Problema do arquivo escolhido (texto para o usuário) ou `null` se pode enviar. */
export function imageFileProblem(
  file: { type: string; size: number },
  t: T = createT('pt-BR', 'agentForm'),
): string | null {
  if (!(TRAINING_IMAGE_MIMETYPES as readonly string[]).includes(file.type)) {
    return t('image.invalidType');
  }
  if (file.size > TRAINING_IMAGE_MAX_BYTES) return t('image.tooLarge', { max: MAX_MB });
  return null;
}

/**
 * Imagem opcional de um treinamento de texto (spec agent-training-image): envia o arquivo ao
 * agente e devolve o `imageId` (ou `null` ao remover). `previewUrl` é a miniatura quando já
 * conhecida (recém-enviada ou vinda da lista de treinamentos).
 */
export function TrainingImageField({
  agentId,
  imageId,
  previewUrl,
  onChange,
  disabled,
}: {
  agentId: string;
  imageId: string | null;
  previewUrl?: string | null;
  onChange: (image: { id: string; url: string } | null) => void;
  disabled?: boolean;
}) {
  const t = useT('agentForm');
  const failure = useApiFailure();
  const { api } = useAppSession();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    const problem = imageFileProblem(file, t);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const image = await api<UploadedTrainingImage>(`/app/agents/${agentId}/trainings/images`, {
        method: 'POST',
        body,
      });
      onChange({ id: image.id, url: image.url });
    } catch (e) {
      setError(failure(e, t('failures.uploadImage')));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="text-sm">
      <span className="font-medium text-zinc-800">{t('image.label')}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {imageId &&
          (previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={t('image.alt')}
              className="size-16 rounded-lg border border-zinc-200 object-cover"
            />
          ) : (
            <span className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-600">
              {t('image.attached')}
            </span>
          ))}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          aria-label={t('image.choose')}
          className="hidden"
          disabled={disabled || uploading}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {uploading ? t('image.uploading') : imageId ? t('image.replace') : t('image.add')}
        </button>
        {imageId && (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
            className="text-sm text-zinc-500 hover:text-red-600 disabled:opacity-50"
          >
            {t('image.remove')}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">{t('image.hint', { max: MAX_MB })}</p>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
