'use client';

import type { AgentSettings, AgentView, AvailableModel } from '@gptmaker/contracts';
import {
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent,
  type SVGProps,
} from 'react';
import { useT } from '@/i18n';
import { ChatIcon, ClockIcon, SparkIcon, UserIcon } from '@/components/icons';
import { buttonClass, Card } from '@/components/ui';
import {
  type AgentFormValues,
  Field,
  IdentityFields,
  inputClass,
  ModelFields,
} from './agent-fields';
import { BusinessHoursFields, businessHoursProblem } from './business-hours-fields';

const GROUPING_KEYS = [
  'NO_GROUP',
  'FIVE_SEC',
  'TEN_SEC',
  'THIRD_SEC',
  'ONE_MINUTE',
] as const satisfies ReadonlyArray<NonNullable<AgentSettings['messageGroupingTime']>>;

const DAILY_LIMITS = [20, 50, 100, 200, 500, 1000] as const;

const LIMIT_ACTION_KEYS = [
  'TEMP_BLOCK_30S',
  'TEMP_BLOCK_5M',
  'TEMP_BLOCK_10M',
  'TEMP_BLOCK_30M',
  'TEMP_BLOCK_1H',
  'BLOCK',
  'TRANSFER',
] as const satisfies ReadonlyArray<NonNullable<AgentSettings['maxDailyMessagesLimitAction']>>;

/** Settings operacionais; os gerenciados pela função (transferência, emojis...) ficam na aba Função. */
type Toggle = 'enabledReminder' | 'splitMessages' | 'signMessages';

const TOGGLES: Toggle[] = ['enabledReminder', 'splitMessages', 'signMessages'];

export type SectionKey = 'identity' | 'model' | 'service' | 'hours';

/** Seções da edição, uma por vez na tela; a navegação lateral alterna entre elas. */
const SECTIONS: Array<{
  key: SectionKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Campos do formulário que pertencem à seção (para marcar alteração não salva). */
  fields: Array<keyof AgentFormValues>;
}> = [
  {
    key: 'identity',
    icon: UserIcon,
    fields: ['name', 'avatarUrl'],
  },
  {
    key: 'model',
    icon: SparkIcon,
    fields: ['modelId'],
  },
  {
    key: 'service',
    icon: ChatIcon,
    fields: ['settings'],
  },
  {
    key: 'hours',
    icon: ClockIcon,
    fields: ['businessHours', 'outOfHoursMessage', 'outOfHoursTransfer'],
  },
];

/**
 * Seção da edição: card com o próprio cabeçalho (ícone, título e explicação) e os campos. As
 * inativas ficam montadas e ocultas, para o formulário validar e salvar todas juntas.
 */
function Section({
  section: { key, icon: Icon },
  active,
  disabled,
  flush = false,
  children,
}: {
  section: (typeof SECTIONS)[number];
  active: boolean;
  disabled: boolean;
  /** Sem espaçamento interno (listas que vão de borda a borda). */
  flush?: boolean;
  children: ReactNode;
}) {
  const t = useT('agentForm.sections');
  const title = t(`${key}.title`);
  const description = t(`${key}.description`);
  return (
    <div hidden={!active} data-section={key} role="tabpanel" aria-label={title}>
      <Card>
        <div className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="size-4.5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
            <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
          </div>
        </div>
        <fieldset disabled={disabled} className={flush ? '' : 'space-y-5 p-5'}>
          {children}
        </fieldset>
      </Card>
    </div>
  );
}

/** Navegação entre as seções: coluna lateral no desktop, linha rolável no celular. */
function SectionNav({
  active,
  changed,
  onSelect,
}: {
  active: SectionKey;
  changed: Set<SectionKey>;
  onSelect: (key: SectionKey) => void;
}) {
  const t = useT('agentForm.sections');
  return (
    <nav
      role="tablist"
      aria-label={t('navLabel')}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 md:sticky md:top-4 md:mx-0 md:flex-col md:self-start md:overflow-visible md:px-0"
    >
      {SECTIONS.map(({ key, icon: Icon }) => {
        const selected = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(key)}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              selected
                ? 'bg-brand-50 text-brand-700'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            <Icon className="size-4.5 shrink-0" />
            <span className="flex-1">{t(`${key}.title`)}</span>
            {changed.has(key) && (
              <span className="size-2 rounded-full bg-amber-500" title={t('unsaved')} />
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** Linha de opção: nome e explicação à esquerda, chave à direita. */
function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="text-sm">
        <p className="font-medium text-zinc-800">{label}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
      </div>
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

/**
 * Edição do agente em seções (uma por vez, navegação lateral) num formulário só: alterações em
 * várias seções são salvas juntas. A barra de salvar só aparece quando há alteração, com a opção
 * de descartar.
 */
export function AgentForm({
  initial,
  models,
  currentModel,
  readOnly,
  onSubmit,
  section: active,
  onSectionChange: setActive,
}: {
  initial: AgentFormValues;
  models: AvailableModel[];
  currentModel: AgentView['model'];
  readOnly: boolean;
  onSubmit: (values: AgentFormValues) => Promise<void>;
  /** Seção aberta; fica com a página para continuar aberta depois de salvar (o form remonta). */
  section: SectionKey;
  onSectionChange: (section: SectionKey) => void;
}) {
  const t = useT('agentForm');
  const [values, setValues] = useState<AgentFormValues>(initial);
  const [saving, setSaving] = useState(false);
  // Um campo inválido por tentativa de salvar: o primeiro leva à sua seção.
  const invalidHandled = useRef(false);

  const set = <K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const setSetting = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) =>
    setValues((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const hoursProblem = businessHoursProblem(values.businessHours, t);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (hoursProblem) {
      setActive('hours');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(values);
    } finally {
      setSaving(false);
    }
  }

  const disabled = readOnly || saving;
  const { settings } = values;
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initial),
    [values, initial],
  );
  const changed = useMemo(
    () =>
      new Set(
        SECTIONS.filter((section) =>
          section.fields.some(
            (field) => JSON.stringify(values[field]) !== JSON.stringify(initial[field]),
          ),
        ).map((section) => section.key),
      ),
    [values, initial],
  );
  const sectionOf = (key: SectionKey) => SECTIONS.find((section) => section.key === key)!;

  /**
   * Campo obrigatório vazio numa seção oculta: o navegador não consegue mostrar o aviso nela.
   * Abre a seção do primeiro campo inválido e repete o aviso já com ele visível.
   */
  function revealInvalid(event: SyntheticEvent) {
    if (invalidHandled.current) return;
    invalidHandled.current = true;
    setTimeout(() => (invalidHandled.current = false));
    const field = event.target as HTMLInputElement;
    const key = field.closest('[data-section]')?.getAttribute('data-section') as SectionKey | null;
    if (!key || key === active) return;
    setActive(key);
    requestAnimationFrame(() => field.reportValidity());
  }

  return (
    <form
      onSubmit={submit}
      onInvalidCapture={revealInvalid}
      className="grid max-w-5xl gap-6 md:grid-cols-[12rem_minmax(0,1fr)]"
    >
      <SectionNav active={active} changed={changed} onSelect={setActive} />
      <div className="min-w-0 space-y-6">
        <Section section={sectionOf('identity')} active={active === 'identity'} disabled={disabled}>
          <IdentityFields values={values} set={set} />
        </Section>

        <Section section={sectionOf('model')} active={active === 'model'} disabled={disabled}>
          <ModelFields values={values} set={set} models={models} currentModel={currentModel} />
        </Section>

        <Section
          section={sectionOf('service')}
          active={active === 'service'}
          disabled={disabled}
          flush
        >
          <div className="divide-y divide-zinc-100">
            {TOGGLES.map((toggle) => (
              <SwitchRow
                key={toggle}
                label={t(`toggles.${toggle}.label`)}
                hint={t(`toggles.${toggle}.hint`)}
                checked={settings[toggle] ?? false}
                onChange={(value) => setSetting(toggle, value)}
              />
            ))}
          </div>
          <div className="space-y-5 border-t border-zinc-100 p-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t('service.groupMessages')}>
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
                  {!settings.messageGroupingTime && (
                    <option value="">{t('service.default')}</option>
                  )}
                  {GROUPING_KEYS.map((value) => (
                    <option key={value} value={value}>
                      {t(`grouping.${value}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('service.timezone')}>
                <input
                  className={inputClass}
                  placeholder="America/Sao_Paulo"
                  maxLength={64}
                  value={settings.timezone ?? ''}
                  onChange={(e) => setSetting('timezone', e.target.value || undefined)}
                />
              </Field>
              <Field label={t('service.dailyLimit')}>
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
                    <option value="">{t('service.default')}</option>
                  )}
                  <option value="none">{t('service.noLimit')}</option>
                  {DAILY_LIMITS.map((limit) => (
                    <option key={limit} value={limit}>
                      {t('service.messages', { count: limit })}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('service.onLimit')}>
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
                    <option value="">{t('service.default')}</option>
                  )}
                  {LIMIT_ACTION_KEYS.map((value) => (
                    <option key={value} value={value}>
                      {t(`limitActions.${value}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Section>

        <Section section={sectionOf('hours')} active={active === 'hours'} disabled={disabled}>
          <BusinessHoursFields values={values} set={set} />
        </Section>

        {!readOnly && dirty && (
          <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
            <span className="flex items-center gap-2 text-sm text-zinc-700">
              <span className="size-2 rounded-full bg-amber-500" />
              {t('sections.unsaved')}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setValues(initial)}
                disabled={saving}
                className={buttonClass('ghost')}
              >
                {t('bar.discard')}
              </button>
              <button type="submit" disabled={saving} className={buttonClass('primary')}>
                {saving ? t('bar.saving') : t('bar.save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
