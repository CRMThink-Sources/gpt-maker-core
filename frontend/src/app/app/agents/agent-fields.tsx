'use client';

import {
  AGENT_BEHAVIOR_MAX,
  AGENT_JOB_DESCRIPTION_MAX,
  type AgentSettings,
  type AgentView,
  type AvailableModel,
} from '@gptmaker/contracts';
import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui';
import { AGENT_TYPES, COMMUNICATION_TYPES, credits } from '@/lib/agents';

/** Valores do formulário como o usuário os digitou; as telas montam o corpo da API. */
export interface AgentFormValues {
  name: string;
  avatarUrl: string;
  behavior: string;
  type: AgentView['type'];
  communicationType: AgentView['communicationType'];
  jobName: string;
  jobSite: string;
  jobDescription: string;
  modelId: string;
  /** Só as settings que o usuário mexeu ou que o agente já tem; as demais não são enviadas. */
  settings: AgentSettings;
}

export function initialValues(
  agent: AgentView | undefined,
  models: AvailableModel[],
): AgentFormValues {
  return {
    name: agent?.name ?? '',
    avatarUrl: agent?.avatarUrl ?? '',
    behavior: agent?.behavior ?? '',
    type: agent?.type ?? 'SUPPORT',
    communicationType: agent?.communicationType ?? 'NORMAL',
    jobName: agent?.jobName ?? '',
    jobSite: agent?.jobSite ?? '',
    jobDescription: agent?.jobDescription ?? '',
    modelId: agent?.model.id ?? models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? '',
    settings: { ...agent?.settings },
  };
}

/** Props comuns dos grupos de campos: valores atuais e como alterar um deles. */
export interface FieldsProps {
  values: AgentFormValues;
  set: <K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) => void;
}

/** Caracteres usados do limite, para o usuário ver quanto ainda cabe. */
function counter(text: string, max: number): string {
  return `${text.length.toLocaleString('pt-BR')}/${max.toLocaleString('pt-BR')} caracteres.`;
}

export const inputClass =
  'mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100 disabled:bg-zinc-50 disabled:text-zinc-500';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-zinc-800">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function IdentityFields({ values, set, autoFocus }: FieldsProps & { autoFocus?: boolean }) {
  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar name={values.name || '?'} src={values.avatarUrl || null} size="lg" />
        <div className="flex-1">
          <Field label="Nome" hint="É o nome que o cliente vê no chat.">
            <input
              className={inputClass}
              required
              maxLength={100}
              autoFocus={autoFocus}
              placeholder="Ex.: Ana, da Loja Exemplo"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Tipo de agente">
          <select
            className={inputClass}
            value={values.type}
            onChange={(e) => set('type', e.target.value as AgentFormValues['type'])}
          >
            {Object.entries(AGENT_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tom de conversa">
          <select
            className={inputClass}
            value={values.communicationType}
            onChange={(e) =>
              set('communicationType', e.target.value as AgentFormValues['communicationType'])
            }
          >
            {Object.entries(COMMUNICATION_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Foto" hint="Opcional. Link https de uma imagem quadrada.">
        <input
          className={inputClass}
          type="url"
          maxLength={2000}
          placeholder="https://"
          value={values.avatarUrl}
          onChange={(e) => set('avatarUrl', e.target.value)}
        />
      </Field>
      <Field
        label="Comportamento"
        hint={`O que o agente pode e não pode fazer, como se apresentar, quando encaminhar. ${counter(values.behavior, AGENT_BEHAVIOR_MAX)}`}
      >
        <textarea
          className={`${inputClass} min-h-32`}
          required
          maxLength={AGENT_BEHAVIOR_MAX}
          value={values.behavior}
          onChange={(e) => set('behavior', e.target.value)}
        />
      </Field>
    </>
  );
}

export function CompanyFields({ values, set, autoFocus }: FieldsProps & { autoFocus?: boolean }) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nome da empresa">
          <input
            className={inputClass}
            maxLength={200}
            autoFocus={autoFocus}
            value={values.jobName}
            onChange={(e) => set('jobName', e.target.value)}
          />
        </Field>
        <Field label="Site">
          <input
            className={inputClass}
            type="url"
            maxLength={2000}
            placeholder="https://"
            value={values.jobSite}
            onChange={(e) => set('jobSite', e.target.value)}
          />
        </Field>
      </div>
      <Field
        label="Sobre a empresa"
        hint={`O que a empresa faz, para quem e o que oferece. ${counter(values.jobDescription, AGENT_JOB_DESCRIPTION_MAX)}`}
      >
        <textarea
          className={`${inputClass} min-h-24`}
          required
          maxLength={AGENT_JOB_DESCRIPTION_MAX}
          value={values.jobDescription}
          onChange={(e) => set('jobDescription', e.target.value)}
        />
      </Field>
    </>
  );
}

export function ModelFields({
  values,
  set,
  models,
  currentModel,
}: FieldsProps & {
  models: AvailableModel[];
  /** Modelo atual do agente, mostrado mesmo se o plano não o oferece mais. */
  currentModel?: AgentView['model'];
}) {
  const options: Array<Pick<AvailableModel, 'id' | 'displayName' | 'creditsPerResponse'>> = [
    ...models,
  ];
  const outOfPlan = currentModel && !models.some((model) => model.id === currentModel.id);
  if (outOfPlan) options.unshift(currentModel);

  if (options.length === 0) {
    return <p className="text-sm text-red-700">Nenhum modelo disponível no momento.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Modelo">
      {options.map((model) => {
        const selected = values.modelId === model.id;
        const description = models.find((entry) => entry.id === model.id)?.description;
        return (
          <label
            key={model.id}
            className={`relative flex cursor-pointer flex-col rounded-lg border p-4 text-sm transition-colors has-disabled:cursor-default ${
              selected
                ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500'
                : 'border-zinc-200 hover:border-zinc-300'
            }`}
          >
            <input
              type="radio"
              name="model"
              className="sr-only"
              checked={selected}
              onChange={() => set('modelId', model.id)}
            />
            <span className="font-medium text-zinc-900">{model.displayName}</span>
            <span className="mt-0.5 text-xs font-medium text-brand-700">
              {credits(model.creditsPerResponse)}
            </span>
            {description && <span className="mt-2 text-xs text-zinc-500">{description}</span>}
            {outOfPlan && model.id === currentModel.id && (
              <span className="mt-2 text-xs text-amber-700">
                Modelo atual, não está mais no seu plano.
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
