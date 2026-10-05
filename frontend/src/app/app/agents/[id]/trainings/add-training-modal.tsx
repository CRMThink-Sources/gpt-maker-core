'use client';

import {
  type CreateTrainingInput,
  TRAINING_DOCUMENT_MAX_BYTES,
  TRAINING_TEXT_MAX,
  type TrainingInterval,
  type TrainingView,
} from '@gptmaker/contracts';
import {
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type FormEvent,
  type SVGProps,
} from 'react';
import { FileIcon, GlobeIcon, TextIcon, UploadIcon, VideoIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, buttonClass } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import {
  ACCEPTED_EXTENSIONS,
  documentProblem,
  formatBytes,
  TRAINING_INTERVALS,
} from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';
import { Field, inputClass } from '../../agent-fields';

type Kind = TrainingView['type'];

const KINDS: Array<{
  kind: Kind;
  label: string;
  hint: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { kind: 'TEXT', label: 'Texto', hint: 'Perguntas e respostas, políticas', icon: TextIcon },
  { kind: 'WEBSITE', label: 'Site', hint: 'Páginas do seu site', icon: GlobeIcon },
  { kind: 'DOCUMENT', label: 'Documento', hint: 'PDF, Word, planilhas', icon: FileIcon },
  { kind: 'VIDEO', label: 'Vídeo', hint: 'Link de um vídeo', icon: VideoIcon },
];

/** Adiciona um treinamento ao agente: escolhe o tipo e preenche o conteúdo. */
export function AddTrainingModal({
  agentId,
  onClose,
  onCreated,
}: {
  agentId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { api } = useAppSession();
  const [kind, setKind] = useState<Kind>('TEXT');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [subPages, setSubPages] = useState(false);
  // Intervalo de re-treinamento do site.
  const [refresh, setRefresh] = useState<TrainingInterval>('NEVER');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function pick(selected: File | undefined) {
    if (!selected) return;
    const problem = documentProblem(selected);
    setError(problem);
    setFile(problem ? null : selected);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files[0]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const base = `/app/agents/${agentId}/trainings`;
      if (kind === 'DOCUMENT') {
        if (!file) throw new Error('Escolha um arquivo.');
        const form = new FormData();
        form.append('file', file);
        await api(`${base}/document`, { method: 'POST', body: form });
      } else {
        const body: CreateTrainingInput =
          kind === 'TEXT'
            ? { type: 'TEXT', text }
            : kind === 'WEBSITE'
              ? { type: 'WEBSITE', url, trainingSubPages: subPages, trainingInterval: refresh }
              : { type: 'VIDEO', url };
        await api(base, { method: 'POST', body: JSON.stringify(body) });
      }
      onCreated();
    } catch (e) {
      setError(
        e instanceof Error && !('code' in e)
          ? e.message
          : errorMessage(e, 'Não foi possível enviar o treinamento. Tente de novo.'),
      );
      setSaving(false);
    }
  }

  const ready =
    kind === 'TEXT' ? text.trim() !== '' : kind === 'DOCUMENT' ? file !== null : url.trim() !== '';

  return (
    <Modal
      title="Adicionar treinamento"
      description="O agente aprende com o conteúdo e passa a usá-lo nas respostas."
      onRequestClose={() => !saving && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={buttonClass('secondary')}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="add-training"
            disabled={!ready || saving}
            className={buttonClass('primary')}
          >
            {saving ? 'Enviando…' : 'Adicionar'}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Tipo">
        {KINDS.map((option) => {
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
              <span className="mt-2 font-medium text-zinc-900">{option.label}</span>
              <span className="text-xs text-zinc-500">{option.hint}</span>
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
            <Field
              label="Conteúdo"
              hint={`Escreva como explicaria a um atendente novo: regras, preços, perguntas frequentes. ${text.length.toLocaleString('pt-BR')}/${TRAINING_TEXT_MAX.toLocaleString('pt-BR')} caracteres.`}
            >
              <textarea
                className={`${inputClass} min-h-48`}
                required
                autoFocus
                maxLength={TRAINING_TEXT_MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
          )}

          {(kind === 'WEBSITE' || kind === 'VIDEO') && (
            <Field
              label={kind === 'WEBSITE' ? 'Endereço do site' : 'Link do vídeo'}
              hint={
                kind === 'VIDEO'
                  ? 'Ex.: um vídeo do YouTube com a explicação do produto.'
                  : undefined
              }
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
                  <span className="font-medium text-zinc-800">Ler também as páginas ligadas</span>
                  <span className="block text-xs text-zinc-500">
                    O agente aprende com as páginas do site a partir deste endereço.
                  </span>
                </span>
              </label>
              <Field
                label="Atualizar o conteúdo"
                hint="Para sites que mudam com frequência, como catálogo e preços."
              >
                <select
                  className={inputClass}
                  value={refresh}
                  onChange={(e) => setRefresh(e.target.value as TrainingInterval)}
                >
                  {Object.entries(TRAINING_INTERVALS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {kind === 'DOCUMENT' && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? 'border-brand-500 bg-brand-50/50' : 'border-zinc-300'
              }`}
            >
              <UploadIcon className="size-8 text-zinc-400" />
              {file ? (
                <p className="mt-3 text-sm font-medium text-zinc-900">
                  {file.name}
                  <span className="ml-1 font-normal text-zinc-500">({formatBytes(file.size)})</span>
                </p>
              ) : (
                <p className="mt-3 text-sm text-zinc-700">Arraste o arquivo para cá ou</p>
              )}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className={`${buttonClass('secondary', 'sm')} mt-3`}
              >
                {file ? 'Trocar arquivo' : 'Escolher arquivo'}
              </button>
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                accept={ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
                onChange={(e) => pick(e.target.files?.[0])}
              />
              <p className="mt-3 text-xs text-zinc-500">
                {ACCEPTED_EXTENSIONS.join(', ').toUpperCase()} · até{' '}
                {formatBytes(TRAINING_DOCUMENT_MAX_BYTES)}
              </p>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
