'use client';

import type { CreateTrainingInput, TrainingInterval } from '@gptmaker/contracts';
import { useState, type ComponentType, type FormEvent, type SVGProps } from 'react';
import { GlobeIcon, VideoIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, buttonClass } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { TRAINING_INTERVALS } from '@/lib/trainings';
import { useAppSession } from '../../../session-provider';
import { Field, inputClass } from '../../agent-fields';

type Kind = 'WEBSITE' | 'VIDEO';

const KINDS: Array<{
  kind: Kind;
  label: string;
  hint: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { kind: 'WEBSITE', label: 'Site', hint: 'Páginas do seu site', icon: GlobeIcon },
  { kind: 'VIDEO', label: 'Vídeo', hint: 'Link de um vídeo', icon: VideoIcon },
];

/**
 * Adiciona um site ou vídeo ao agente (modo avançado). Textos vêm dos itens da base no formulário
 * da função; documento não é mais aceito (spec agent-training).
 */
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
  const [kind, setKind] = useState<Kind>('WEBSITE');
  const [url, setUrl] = useState('');
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
        kind === 'WEBSITE'
          ? { type: 'WEBSITE', url, trainingSubPages: subPages, trainingInterval: refresh }
          : { type: 'VIDEO', url };
      await api(`/app/agents/${agentId}/trainings`, { method: 'POST', body: JSON.stringify(body) });
      onCreated();
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível enviar o treinamento. Tente de novo.'));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Adicionar site ou vídeo"
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
            disabled={url.trim() === '' || saving}
            className={buttonClass('primary')}
          >
            {saving ? 'Enviando…' : 'Adicionar'}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo">
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
          <Field
            label={kind === 'WEBSITE' ? 'Endereço do site' : 'Link do vídeo'}
            hint={
              kind === 'VIDEO' ? 'Ex.: um vídeo do YouTube com a explicação do produto.' : undefined
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
        </fieldset>
      </form>
    </Modal>
  );
}
