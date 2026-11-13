'use client';

import {
  type BusinessHours,
  DEFAULT_BUSINESS_TIMEZONE,
  isWithinBusinessHours,
  OUT_OF_HOURS_MESSAGE_MAX,
  WEEK_DAYS,
  type WeekDay,
  businessHoursSchema,
} from '@gptmaker/contracts';
import { createT, type T, useT } from '@/i18n';
import { Field, inputClass, type FieldsProps } from './agent-fields';

const PT_BR = createT('pt-BR', 'agentForm');

/** Mensagens da validação do contrato (`business-hours`) que têm tradução. */
const ISSUE_KEYS: Record<string, string> = {
  'use HH:mm': 'timeFormat',
  'o início deve ser anterior ao fim': 'startBeforeEnd',
  'fuso horário inválido': 'invalidTimezone',
};

/** Expediente comercial usado ao ligar o horário: seg–sex, 09:00–18:00. */
export function defaultBusinessHours(): BusinessHours {
  const weekday = () => [{ start: '09:00', end: '18:00' }];
  return {
    timezone: DEFAULT_BUSINESS_TIMEZONE,
    days: {
      mon: weekday(),
      tue: weekday(),
      wed: weekday(),
      thu: weekday(),
      fri: weekday(),
      sat: [],
      sun: [],
    },
  };
}

/** Primeiro problema do horário (texto para o usuário) ou `null` se estiver válido. */
export function businessHoursProblem(hours: BusinessHours | null, t: T = PT_BR): string | null {
  if (!hours) return null;
  const result = businessHoursSchema.safeParse(hours);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  const key = issue.message.startsWith('intervalos sobrepostos')
    ? 'overlap'
    : ISSUE_KEYS[issue.message];
  const message = key ? t(`hours.problems.${key}`) : issue.message;
  return issue.path[0] === 'days'
    ? t('hours.problems.withDay', { day: t(`hours.days.${issue.path[1] as WeekDay}`), message })
    : message;
}

/** Selo "dentro/fora do horário agora", no fuso do agente. */
export function BusinessHoursStatus({
  hours,
  now = new Date(),
}: {
  hours: BusinessHours | null;
  now?: Date;
}) {
  const t = useT('agentForm');
  if (!hours) {
    return <span className="text-sm font-medium text-zinc-700">{t('hours.always')}</span>;
  }
  if (businessHoursProblem(hours, t)) return null;
  const open = isWithinBusinessHours(hours, now);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        open ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      <span className={`size-1.5 rounded-full ${open ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {open ? t('hours.inside') : t('hours.outside')}
    </span>
  );
}

export function BusinessHoursFields({ values, set, now }: FieldsProps & { now?: Date }) {
  const t = useT('agentForm');
  const hours = values.businessHours;
  const problem = businessHoursProblem(hours, t);

  function update(next: BusinessHours) {
    set('businessHours', next);
  }
  function setInterval(day: WeekDay, index: number, key: 'start' | 'end', value: string) {
    if (!hours) return;
    const list = hours.days[day].map((item, i) => (i === index ? { ...item, [key]: value } : item));
    update({ ...hours, days: { ...hours.days, [day]: list } });
  }
  function addInterval(day: WeekDay) {
    if (!hours) return;
    const list = [...hours.days[day], { start: '09:00', end: '18:00' }];
    update({ ...hours, days: { ...hours.days, [day]: list } });
  }
  function removeInterval(day: WeekDay, index: number) {
    if (!hours) return;
    const list = hours.days[day].filter((_, i) => i !== index);
    update({ ...hours, days: { ...hours.days, [day]: list } });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
          <input
            type="checkbox"
            checked={hours !== null}
            onChange={(e) => set('businessHours', e.target.checked ? defaultBusinessHours() : null)}
          />
          {t('hours.enable')}
        </label>
        <BusinessHoursStatus hours={hours} now={now} />
      </div>
      {!hours && <p className="text-sm text-zinc-500">{t('hours.disabledHint')}</p>}

      {hours && (
        <>
          <Field label={t('hours.timezone')} hint={t('hours.timezoneHint')}>
            <input
              className={inputClass}
              maxLength={64}
              value={hours.timezone}
              onChange={(e) => update({ ...hours, timezone: e.target.value })}
            />
          </Field>

          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {WEEK_DAYS.map((day) => (
              <div key={day} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className="w-20 pt-2 text-sm font-medium text-zinc-800">
                  {t(`hours.days.${day}`)}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  {hours.days[day].length === 0 && (
                    <p className="pt-2 text-sm text-zinc-500">{t('hours.closed')}</p>
                  )}
                  {hours.days[day].map((interval, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label={t('hours.startLabel', { day: t(`hours.days.${day}`) })}
                        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                        value={interval.start}
                        onChange={(e) => setInterval(day, index, 'start', e.target.value)}
                      />
                      <span className="text-sm text-zinc-500">{t('hours.to')}</span>
                      <input
                        type="time"
                        aria-label={t('hours.endLabel', { day: t(`hours.days.${day}`) })}
                        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                        value={interval.end === '24:00' ? '23:59' : interval.end}
                        onChange={(e) => setInterval(day, index, 'end', e.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={t('hours.removeLabel', { day: t(`hours.days.${day}`) })}
                        onClick={() => removeInterval(day, index)}
                        className="text-sm text-zinc-500 hover:text-red-600"
                      >
                        {t('hours.remove')}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => addInterval(day)}
                  className="pt-2 text-sm font-medium text-brand-700 hover:underline"
                >
                  {t('hours.add')}
                </button>
              </div>
            ))}
          </div>

          {problem && (
            <p role="alert" className="text-sm text-red-600">
              {problem}
            </p>
          )}
        </>
      )}

      {hours && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
            <input
              type="checkbox"
              checked={values.outOfHoursTransfer}
              onChange={(e) => set('outOfHoursTransfer', e.target.checked)}
            />
            {t('hours.transfer')}
          </label>
          <p className="text-sm text-zinc-500">{t('hours.transferHint')}</p>
        </div>
      )}

      <Field
        label={t('hours.messageLabel')}
        hint={
          values.outOfHoursTransfer && hours
            ? t('hours.messageHintTransfer')
            : t('hours.messageHintSilent')
        }
      >
        <textarea
          className={inputClass}
          rows={3}
          maxLength={OUT_OF_HOURS_MESSAGE_MAX}
          value={values.outOfHoursMessage}
          onChange={(e) => set('outOfHoursMessage', e.target.value)}
        />
      </Field>
    </div>
  );
}
