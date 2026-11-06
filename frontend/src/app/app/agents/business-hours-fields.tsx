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
import { Field, inputClass, type FieldsProps } from './agent-fields';

const DAY_LABELS: Record<WeekDay, string> = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo',
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
export function businessHoursProblem(hours: BusinessHours | null): string | null {
  if (!hours) return null;
  const result = businessHoursSchema.safeParse(hours);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  const day = issue.path[0] === 'days' ? DAY_LABELS[issue.path[1] as WeekDay] : null;
  return day ? `${day}: ${issue.message}` : issue.message;
}

/** Selo "dentro/fora do horário agora", no fuso do agente. */
export function BusinessHoursStatus({
  hours,
  now = new Date(),
}: {
  hours: BusinessHours | null;
  now?: Date;
}) {
  if (!hours) return <span className="text-sm font-medium text-zinc-700">24 horas</span>;
  if (businessHoursProblem(hours)) return null;
  const open = isWithinBusinessHours(hours, now);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        open ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      <span className={`size-1.5 rounded-full ${open ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {open ? 'Dentro do horário agora' : 'Fora do horário agora'}
    </span>
  );
}

export function BusinessHoursFields({ values, set, now }: FieldsProps & { now?: Date }) {
  const hours = values.businessHours;
  const problem = businessHoursProblem(hours);

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
          Definir horário de funcionamento
        </label>
        <BusinessHoursStatus hours={hours} now={now} />
      </div>
      {!hours && (
        <p className="text-sm text-zinc-500">
          Sem horário definido, o agente responde 24 horas por dia, todos os dias.
        </p>
      )}

      {hours && (
        <>
          <Field
            label="Fuso horário"
            hint="O horário abaixo vale neste fuso (ex.: America/Sao_Paulo, America/Manaus)."
          >
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
                  {DAY_LABELS[day]}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  {hours.days[day].length === 0 && (
                    <p className="pt-2 text-sm text-zinc-500">Sem atendimento</p>
                  )}
                  {hours.days[day].map((interval, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label={`${DAY_LABELS[day]}: início`}
                        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                        value={interval.start}
                        onChange={(e) => setInterval(day, index, 'start', e.target.value)}
                      />
                      <span className="text-sm text-zinc-500">às</span>
                      <input
                        type="time"
                        aria-label={`${DAY_LABELS[day]}: fim`}
                        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                        value={interval.end === '24:00' ? '23:59' : interval.end}
                        onChange={(e) => setInterval(day, index, 'end', e.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={`${DAY_LABELS[day]}: remover intervalo`}
                        onClick={() => removeInterval(day, index)}
                        className="text-sm text-zinc-500 hover:text-red-600"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => addInterval(day)}
                  className="pt-2 text-sm font-medium text-brand-700 hover:underline"
                >
                  Adicionar intervalo
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
            Transferir para um atendente
          </label>
          <p className="text-sm text-zinc-500">
            Fora do horário, a conversa vai para o operador livre da Linha Aberta e o agente deixa
            de responder nela. Para o atendimento acontecer, o expediente da Linha Aberta precisa
            estar configurado no Bitrix24. A conversa só volta para o agente quando o atendente a
            encerra.
          </p>
        </div>
      )}

      <Field
        label="Mensagem fora do horário (opcional)"
        hint={
          values.outOfHoursTransfer && hours
            ? 'Enviada ao cliente antes de a conversa ir para o atendente, sem consumir créditos. Em branco, a conversa é transferida sem aviso.'
            : 'Enviada uma vez a cada 12 horas para quem escrever fora do horário, sem consumir créditos. Em branco, o agente fica em silêncio. Mensagens fora do horário não são respondidas depois.'
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
