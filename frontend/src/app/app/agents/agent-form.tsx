'use client';

import type { AgentSettings, AgentView, AvailableModel } from '@gptmaker/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import { AGENT_TYPES, COMMUNICATION_TYPES, credits } from '@/lib/agents';

/** Valores do formulário como o usuário os digitou; as páginas montam o corpo da API. */
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

export function initialValues(agent: AgentView | undefined, models: AvailableModel[]) {
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
  } satisfies AgentFormValues;
}

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

const input =
  'mt-1 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm disabled:opacity-70';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function AgentForm({
  initial,
  models,
  currentModel,
  withSettings,
  readOnly,
  submitLabel,
  onSubmit,
}: {
  initial: AgentFormValues;
  models: AvailableModel[];
  /** Modelo atual do agente, mostrado mesmo se o plano não o oferece mais. */
  currentModel?: AgentView['model'];
  /** Settings só existem depois de criado (a criação usa os padrões do GPTMaker). */
  withSettings: boolean;
  readOnly: boolean;
  submitLabel: string;
  onSubmit: (values: AgentFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<AgentFormValues>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const setSetting = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) =>
    setValues((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const options: Array<Pick<AvailableModel, 'id' | 'displayName' | 'creditsPerResponse'>> = [
    ...models,
  ];
  const outOfPlan = currentModel && !models.some((model) => model.id === currentModel.id);
  if (outOfPlan) options.unshift(currentModel);
  const selected = models.find((model) => model.id === values.modelId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(values);
    } finally {
      setSaving(false);
    }
  }

  const { settings } = values;

  return (
    <form onSubmit={submit} className="mt-4 space-y-6">
      <fieldset disabled={readOnly || saving} className="space-y-4">
        <legend className="text-lg font-semibold">Identidade</legend>
        <Field label="Nome" hint="É o nome que o cliente vê no chat.">
          <input
            className={input}
            required
            maxLength={100}
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de agente">
            <select
              className={input}
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
              className={input}
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
        <Field label="Foto (endereço da imagem)" hint="Opcional. Um link https para a imagem.">
          <input
            className={input}
            type="url"
            maxLength={2000}
            value={values.avatarUrl}
            onChange={(e) => set('avatarUrl', e.target.value)}
          />
        </Field>
        <Field
          label="Comportamento"
          hint="Como o agente deve agir: o que pode e não pode fazer, como se apresentar."
        >
          <textarea
            className={`${input} min-h-28`}
            maxLength={10_000}
            value={values.behavior}
            onChange={(e) => set('behavior', e.target.value)}
          />
        </Field>
      </fieldset>

      <fieldset disabled={readOnly || saving} className="space-y-4">
        <legend className="text-lg font-semibold">Empresa</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome da empresa">
            <input
              className={input}
              maxLength={200}
              value={values.jobName}
              onChange={(e) => set('jobName', e.target.value)}
            />
          </Field>
          <Field label="Site">
            <input
              className={input}
              type="url"
              maxLength={2000}
              value={values.jobSite}
              onChange={(e) => set('jobSite', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Sobre a empresa" hint="O que a empresa faz, para quem, e o que oferece.">
          <textarea
            className={`${input} min-h-20`}
            maxLength={5000}
            value={values.jobDescription}
            onChange={(e) => set('jobDescription', e.target.value)}
          />
        </Field>
      </fieldset>

      <fieldset disabled={readOnly || saving} className="space-y-2">
        <legend className="text-lg font-semibold">Modelo de IA</legend>
        {options.length === 0 ? (
          <p className="text-sm text-red-700">Nenhum modelo disponível no momento.</p>
        ) : (
          <Field
            label="Modelo"
            hint="Cada resposta do agente consome créditos conforme o modelo escolhido."
          >
            <select
              className={input}
              required
              value={values.modelId}
              onChange={(e) => set('modelId', e.target.value)}
            >
              {options.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName} — {credits(model.creditsPerResponse)}
                  {outOfPlan && model.id === currentModel.id ? ' (atual, fora do plano)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        {selected?.description && <p className="text-xs text-zinc-600">{selected.description}</p>}
      </fieldset>

      {withSettings && (
        <fieldset disabled={readOnly || saving} className="space-y-4">
          <legend className="text-lg font-semibold">Atendimento</legend>
          <div className="space-y-2">
            {TOGGLES.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings[key] ?? false}
                  onChange={(e) => setSetting(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Juntar mensagens seguidas do cliente">
              <select
                className={input}
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
                className={input}
                placeholder="America/Sao_Paulo"
                maxLength={64}
                value={settings.timezone ?? ''}
                onChange={(e) => setSetting('timezone', e.target.value || undefined)}
              />
            </Field>
            <Field label="Limite de mensagens por contato no dia">
              <select
                className={input}
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
                className={input}
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
              className={`${input} min-h-16`}
              maxLength={2000}
              value={settings.onLackKnowLedge ?? ''}
              onChange={(e) => setSetting('onLackKnowLedge', e.target.value)}
            />
          </Field>
        </fieldset>
      )}

      {!readOnly && (
        <button
          type="submit"
          disabled={saving || options.length === 0}
          className="rounded bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? 'Salvando…' : submitLabel}
        </button>
      )}
    </form>
  );
}
