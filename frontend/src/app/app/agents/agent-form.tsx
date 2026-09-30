'use client';

import type { AgentSettings, AgentView, AvailableModel } from '@gptmaker/contracts';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { buttonClass, Card } from '@/components/ui';
import {
  type AgentFormValues,
  CompanyFields,
  Field,
  IdentityFields,
  inputClass,
  ModelFields,
} from './agent-fields';

const GROUPING: Record<NonNullable<AgentSettings['messageGroupingTime']>, string> = {
  NO_GROUP: 'Não agrupar',
  FIVE_SEC: '5 segundos',
  TEN_SEC: '10 segundos',
  THIRD_SEC: '30 segundos',
  ONE_MINUTE: '1 minuto',
};

const DAILY_LIMITS = [20, 50, 100, 200, 500, 1000] as const;

const LIMIT_ACTIONS: Record<NonNullable<AgentSettings['maxDailyMessagesLimitAction']>, string> = {
  TEMP_BLOCK_30S: 'Pausar por 30 segundos',
  TEMP_BLOCK_5M: 'Pausar por 5 minutos',
  TEMP_BLOCK_10M: 'Pausar por 10 minutos',
  TEMP_BLOCK_30M: 'Pausar por 30 minutos',
  TEMP_BLOCK_1H: 'Pausar por 1 hora',
  BLOCK: 'Parar de responder no dia',
  TRANSFER: 'Transferir para um atendente',
};

type Toggle =
  | 'enabledHumanTransfer'
  | 'enabledReminder'
  | 'splitMessages'
  | 'enabledEmoji'
  | 'limitSubjects'
  | 'signMessages'
  | 'knowledgeByFunction';

const TOGGLES: Array<[Toggle, string]> = [
  ['enabledHumanTransfer', 'Transferir para um atendente quando o cliente pedir'],
  ['enabledReminder', 'Lembrar o cliente quando ele parar de responder'],
  ['splitMessages', 'Dividir respostas longas em várias mensagens'],
  ['enabledEmoji', 'Usar emojis'],
  ['limitSubjects', 'Falar só dos assuntos do treinamento'],
  ['signMessages', 'Assinar as mensagens com o nome do agente'],
  ['knowledgeByFunction', 'Consultar o treinamento só quando precisar'],
];

/** Seção de configurações: título e explicação à esquerda, campos num card à direita. */
function Section({
  title,
  description,
  disabled,
  children,
}: {
  title: string;
  description: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:gap-8">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </div>
      <Card className="lg:col-span-2">
        <fieldset disabled={disabled} className="space-y-5 p-5">
          {children}
        </fieldset>
      </Card>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-zinc-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
          checked ? 'bg-brand-600' : 'bg-zinc-200'
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

/** Edição do agente em página inteira: todas as seções visíveis, uma barra de salvar fixa. */
export function AgentForm({
  initial,
  models,
  currentModel,
  readOnly,
  cancelHref,
  onSubmit,
}: {
  initial: AgentFormValues;
  models: AvailableModel[];
  currentModel: AgentView['model'];
  readOnly: boolean;
  cancelHref: string;
  onSubmit: (values: AgentFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<AgentFormValues>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const setSetting = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) =>
    setValues((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(values);
    } finally {
      setSaving(false);
    }
  }

  const disabled = readOnly || saving;
  const { settings } = values;

  return (
    <form onSubmit={submit} className="space-y-8">
      <Section
        title="Identidade"
        description="Como o agente se apresenta aos clientes no chat."
        disabled={disabled}
      >
        <IdentityFields values={values} set={set} />
      </Section>

      <Section
        title="Empresa"
        description="Contexto que o agente usa para falar em nome do seu negócio."
        disabled={disabled}
      >
        <CompanyFields values={values} set={set} />
      </Section>

      <Section
        title="Modelo de IA"
        description="Cada resposta do agente consome créditos conforme o modelo."
        disabled={disabled}
      >
        <ModelFields values={values} set={set} models={models} currentModel={currentModel} />
      </Section>

      <Section
        title="Atendimento"
        description="Regras da conversa. Campos sem escolha seguem o padrão do GPTMaker."
        disabled={disabled}
      >
        <div className="space-y-4">
          {TOGGLES.map(([key, label]) => (
            <Switch
              key={key}
              label={label}
              checked={settings[key] ?? false}
              onChange={(value) => setSetting(key, value)}
            />
          ))}
        </div>
        <div className="grid gap-5 border-t border-zinc-100 pt-5 sm:grid-cols-2">
          <Field label="Juntar mensagens seguidas do cliente">
            <select
              className={inputClass}
              value={settings.messageGroupingTime ?? ''}
              onChange={(e) =>
                setSetting(
                  'messageGroupingTime',
                  e.target.value as NonNullable<AgentSettings['messageGroupingTime']>,
                )
              }
            >
              {!settings.messageGroupingTime && <option value="">Padrão do GPTMaker</option>}
              {Object.entries(GROUPING).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fuso horário">
            <input
              className={inputClass}
              placeholder="America/Sao_Paulo"
              maxLength={64}
              value={settings.timezone ?? ''}
              onChange={(e) => setSetting('timezone', e.target.value || undefined)}
            />
          </Field>
          <Field label="Limite de mensagens por contato no dia">
            <select
              className={inputClass}
              value={
                settings.maxDailyMessages === undefined
                  ? ''
                  : String(settings.maxDailyMessages ?? 'none')
              }
              onChange={(e) =>
                setSetting(
                  'maxDailyMessages',
                  e.target.value === 'none'
                    ? null
                    : (Number(e.target.value) as (typeof DAILY_LIMITS)[number]),
                )
              }
            >
              {settings.maxDailyMessages === undefined && (
                <option value="">Padrão do GPTMaker</option>
              )}
              <option value="none">Sem limite</option>
              {DAILY_LIMITS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit} mensagens
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ao atingir o limite">
            <select
              className={inputClass}
              value={settings.maxDailyMessagesLimitAction ?? ''}
              onChange={(e) =>
                setSetting(
                  'maxDailyMessagesLimitAction',
                  e.target.value as NonNullable<AgentSettings['maxDailyMessagesLimitAction']>,
                )
              }
            >
              {!settings.maxDailyMessagesLimitAction && (
                <option value="">Padrão do GPTMaker</option>
              )}
              {Object.entries(LIMIT_ACTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Quando o agente não souber responder"
          hint="Ex.: “Vou verificar com a equipe e já retorno.”"
        >
          <textarea
            className={`${inputClass} min-h-20`}
            maxLength={2000}
            value={settings.onLackKnowLedge ?? ''}
            onChange={(e) => setSetting('onLackKnowLedge', e.target.value)}
          />
        </Field>
      </Section>

      {!readOnly && (
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
          <Link href={cancelHref} className={buttonClass('secondary')}>
            Cancelar
          </Link>
          <button type="submit" disabled={saving} className={buttonClass('primary')}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      )}
    </form>
  );
}
