import {
  type BusinessHours,
  DEFAULT_BUSINESS_TIMEZONE,
  isValidTimezone,
  toMinutes,
  type WeekDay,
} from '@gptmaker/contracts';

/** Intervalo em milissegundos desde a época (UTC), `[start, end)`. */
export interface Interval {
  start: number;
  end: number;
}

/** Agenda de um usuário e os intervalos em que ele está ocupado. */
export interface AgendaBusy {
  ownerId: number;
  busy: Interval[];
}

export interface FreeSlot {
  start: number;
  end: number;
  /** Primeiro usuário da lista que está livre no horário (design D4/D5). */
  ownerId: number;
}

export interface SlotQuery {
  /** Agora, em milissegundos (parâmetro para os testes não dependerem do relógio). */
  now: number;
  /** Primeiro dia pedido (`AAAA-MM-DD` no fuso da agenda); antes de hoje vale hoje. */
  from?: string;
  hours: BusinessHours;
  slotMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  agendas: AgendaBusy[];
  limit?: number;
}

/** Quantos horários uma resposta traz (spec agent-calendar-scheduling, `horarios_livres`). */
export const MAX_FREE_SLOTS = 10;

/**
 * Expediente quando o agente não tem horário de funcionamento: segunda a sexta, das 09:00 às
 * 18:00, em `America/Sao_Paulo` (spec agent-calendar-scheduling). Diferente do atendimento, que
 * sem horário responde 24 h: oferecer horário de madrugada não faz sentido.
 */
export const DEFAULT_CALENDAR_HOURS: BusinessHours = {
  timezone: DEFAULT_BUSINESS_TIMEZONE,
  days: {
    mon: [{ start: '09:00', end: '18:00' }],
    tue: [{ start: '09:00', end: '18:00' }],
    wed: [{ start: '09:00', end: '18:00' }],
    thu: [{ start: '09:00', end: '18:00' }],
    fri: [{ start: '09:00', end: '18:00' }],
    sat: [],
    sun: [],
  },
};

const WEEK_DAY_OF_UTC_DAY: WeekDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MINUTE_MS = 60_000;

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let format = dateFormats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dateFormats.set(timezone, format);
  }
  return format;
}

/** Diferença (ms) entre a hora de parede no fuso e o UTC no instante `instant`. */
function offsetAt(instant: number, timezone: string): number {
  const parts = formatter(timezone).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Instante (ms) em que a parede do fuso marca `date` (`AAAA-MM-DD`) às `minutes` desde 00:00
 * (1440 = meia-noite do dia seguinte). `null` se essa hora não existe no fuso (salto do horário
 * de verão). Numa hora repetida (fim do horário de verão) vale a primeira ocorrência.
 */
export function zonedToEpoch(date: string, minutes: number, timezone: string): number | null {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let instant = wall - offsetAt(wall, timezone);
  instant = wall - offsetAt(instant, timezone);
  return instant + offsetAt(instant, timezone) === wall ? instant : null;
}

/** `AAAA-MM-DD` de `instant` no fuso. */
export function localDate(instant: number, timezone: string): string {
  const parts = formatter(timezone).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Data e hora de parede de `instant` no fuso, para falar com o cliente. */
export function localParts(instant: number, timezone: string): { data: string; hora: string } {
  const parts = formatter(timezone).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    data: `${get('year')}-${get('month')}-${get('day')}`,
    hora: `${get('hour')}:${get('minute')}`,
  };
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekDayOf(date: string): WeekDay {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return WEEK_DAY_OF_UTC_DAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
}

/** Primeiro e último dia (inclusive) que a busca pode cobrir, no fuso da agenda. */
export function searchWindow(
  now: number,
  timezone: string,
  maxDaysAhead: number,
): { first: string; last: string } {
  const first = localDate(now, timezone);
  return { first, last: addDays(first, maxDaysAhead) };
}

/**
 * Horários livres (spec agent-calendar-scheduling, `horarios_livres`; design D3). Os horários
 * saem de uma grade que começa no início de cada intervalo do expediente, em passos da duração do
 * compromisso, e só entram os que cabem inteiros no intervalo, respeitam a antecedência mínima e
 * não encostam em nenhum período ocupado. Com mais de uma agenda, o horário é livre se ao menos
 * uma estiver livre, e vale a primeira da lista.
 */
export function freeSlots(query: SlotQuery): FreeSlot[] {
  const { hours, slotMinutes, now } = query;
  const limit = query.limit ?? MAX_FREE_SLOTS;
  const earliest = now + query.minNoticeMinutes * MINUTE_MS;
  const window = searchWindow(now, hours.timezone, query.maxDaysAhead);
  const firstDay = query.from && query.from > window.first ? query.from : window.first;
  const slots: FreeSlot[] = [];

  for (let date = firstDay; date <= window.last; date = addDays(date, 1)) {
    const intervals = [...hours.days[weekDayOf(date)]].sort(
      (a, b) => toMinutes(a.start) - toMinutes(b.start),
    );
    for (const interval of intervals) {
      const end = toMinutes(interval.end);
      for (
        let minute = toMinutes(interval.start);
        minute + slotMinutes <= end;
        minute += slotMinutes
      ) {
        const start = zonedToEpoch(date, minute, hours.timezone);
        if (start === null || start < earliest) continue;
        const slotEnd = start + slotMinutes * MINUTE_MS;
        const agenda = query.agendas.find(
          (candidate) => !candidate.busy.some((b) => b.start < slotEnd && b.end > start),
        );
        if (!agenda) continue;
        slots.push({ start, end: slotEnd, ownerId: agenda.ownerId });
        if (slots.length >= limit) return slots;
      }
    }
  }
  return slots;
}

export type SlotViolation = 'past' | 'window' | 'grid' | 'notice';

/**
 * Por que `start` não pode ser usado, ignorando a ocupação das agendas (spec
 * agent-calendar-scheduling, `agendar_compromisso`): dia que já passou, depois da janela de busca,
 * fora da grade do expediente (fora do horário, no meio de um passo ou sem caber no intervalo) ou
 * antes da antecedência mínima. `null` = respeita as regras.
 */
export function slotViolation(
  rules: Pick<SlotQuery, 'now' | 'hours' | 'slotMinutes' | 'minNoticeMinutes' | 'maxDaysAhead'>,
  start: number,
): SlotViolation | null {
  const { hours, slotMinutes } = rules;
  const date = localDate(start, hours.timezone);
  const window = searchWindow(rules.now, hours.timezone, rules.maxDaysAhead);
  if (date < window.first) return 'past';
  if (date > window.last) return 'window';
  const onGrid = hours.days[weekDayOf(date)].some((interval) => {
    const end = toMinutes(interval.end);
    for (
      let minute = toMinutes(interval.start);
      minute + slotMinutes <= end;
      minute += slotMinutes
    ) {
      if (zonedToEpoch(date, minute, hours.timezone) === start) return true;
    }
    return false;
  });
  if (!onGrid) return 'grid';
  return start < rules.now + rules.minNoticeMinutes * MINUTE_MS ? 'notice' : null;
}

/** Campos de um evento em `calendar.accessibility.get` usados para achar o período real dele. */
export interface PortalEventTimes {
  /** `DATE_FROM_TS_UTC` (segundos). */
  fromTs: unknown;
  /** `DATE_TO_TS_UTC` (segundos). */
  toTs: unknown;
  /** `~USER_OFFSET_FROM` (segundos). */
  userOffset?: unknown;
  /** `TZ_FROM`: fuso do evento (nome IANA). */
  timezone?: unknown;
}

/**
 * Período real (instantes UTC) de um evento do Calendário do Bitrix24.
 *
 * `DATE_FROM_TS_UTC` **não é UTC**: é o instante escrito na hora de parede de quem consulta (o
 * usuário do token), como se fosse UTC; e `~USER_OFFSET_FROM` é o deslocamento do fuso do evento em
 * relação ao de quem consulta. Observado no portal de teste (docs/bitrix-observado.md): evento de
 * 14:20 em São Paulo vem com `14:20Z` e offset 0; de 10:00 em Nova York (= 15:00Z) vem com `12:00Z`
 * e offset −7200. Logo, a hora de parede **no fuso do evento** é `TS + ~USER_OFFSET_FROM`, e o
 * instante real sai de convertê-la com `TZ_FROM`. A duração (`TO − FROM`) é a real. Sem fuso
 * válido não há como corrigir: vale o timestamp como veio.
 */
export function eventInterval(event: PortalEventTimes): Interval | null {
  const from = Number(event.fromTs);
  const to = Number(event.toTs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  const timezone =
    typeof event.timezone === 'string' && isValidTimezone(event.timezone) ? event.timezone : null;
  if (!timezone) return { start: from * 1000, end: to * 1000 };

  const offset = Number(event.userOffset ?? 0);
  const wall = new Date((from + (Number.isFinite(offset) ? offset : 0)) * 1000);
  const base = zonedToEpoch(
    wall.toISOString().slice(0, 10),
    wall.getUTCHours() * 60 + wall.getUTCMinutes(),
    timezone,
  );
  // Hora que não existe no fuso (salto do horário de verão): sem como corrigir com segurança.
  if (base === null) return { start: from * 1000, end: to * 1000 };
  const start = base + wall.getUTCSeconds() * 1000;
  return { start, end: start + (to - from) * 1000 };
}
