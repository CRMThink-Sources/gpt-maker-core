import { z } from 'zod';

export const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export const DEFAULT_BUSINESS_TIMEZONE = 'America/Sao_Paulo';
export const OUT_OF_HOURS_MESSAGE_MAX = 1000;

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;

/** Minutos desde 00:00 de um `HH:mm` (`24:00` = 1440). */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const intervalSchema = z
  .object({
    start: z.string().regex(TIME, 'use HH:mm'),
    end: z.string().regex(TIME, 'use HH:mm'),
  })
  .strict()
  .refine((i) => i.start !== '24:00' && toMinutes(i.start) < toMinutes(i.end), {
    message: 'o início deve ser anterior ao fim',
  });

const daySchema = z.array(intervalSchema).max(10);

/** Horário de funcionamento do agente: fuso e intervalos `[início, fim)` por dia da semana. */
export const businessHoursSchema = z
  .object({
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isValidTimezone, { message: 'fuso horário inválido' }),
    days: z
      .object({
        mon: daySchema,
        tue: daySchema,
        wed: daySchema,
        thu: daySchema,
        fri: daySchema,
        sat: daySchema,
        sun: daySchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((hours, ctx) => {
    for (const day of WEEK_DAYS) {
      const sorted = [...hours.days[day]].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
      for (let i = 1; i < sorted.length; i++) {
        if (toMinutes(sorted[i]!.start) < toMinutes(sorted[i - 1]!.end)) {
          ctx.addIssue({
            code: 'custom',
            path: ['days', day],
            message: `intervalos sobrepostos em ${day}`,
          });
          break;
        }
      }
    }
  });
export type BusinessHours = z.infer<typeof businessHoursSchema>;

export const outOfHoursMessageSchema = z.string().trim().min(1).max(OUT_OF_HOURS_MESSAGE_MAX);

const WEEKDAY_BY_SHORT: Record<string, WeekDay> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

/**
 * `true` se `now` cai num intervalo do dia da semana corrente, no fuso do horário. Sem horário
 * (`null`/`undefined`) o agente atende 24h. Início inclusivo, fim exclusivo.
 */
export function isWithinBusinessHours(
  hours: BusinessHours | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!hours) return true;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: hours.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = WEEKDAY_BY_SHORT[get('weekday')];
  if (!day) return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return hours.days[day].some((i) => minutes >= toMinutes(i.start) && minutes < toMinutes(i.end));
}
