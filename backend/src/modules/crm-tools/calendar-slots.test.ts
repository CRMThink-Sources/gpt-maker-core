import type { BusinessHours, WeekDay } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  type AgendaBusy,
  DEFAULT_CALENDAR_HOURS,
  freeSlots,
  localDate,
  localParts,
  searchWindow,
  type SlotQuery,
  zonedToEpoch,
} from './calendar-slots';

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const MIN = 60_000;

/** Expediente só nos dias dados (os demais ficam sem atendimento). */
function hoursOf(
  timezone: string,
  days: Partial<Record<WeekDay, Array<[string, string]>>>,
): BusinessHours {
  const day = (key: WeekDay) => (days[key] ?? []).map(([start, end]) => ({ start, end }));
  return {
    timezone,
    days: {
      mon: day('mon'),
      tue: day('tue'),
      wed: day('wed'),
      thu: day('thu'),
      fri: day('fri'),
      sat: day('sat'),
      sun: day('sun'),
    },
  };
}

/** 2026-11-24 é terça-feira; `America/Sao_Paulo` é UTC-3 sem horário de verão. */
const SP = 'America/Sao_Paulo';
const busy = (startIso: string, endIso: string) => ({ start: at(startIso), end: at(endIso) });

function query(overrides: Partial<SlotQuery> & Pick<SlotQuery, 'hours' | 'now'>): SlotQuery {
  return {
    slotMinutes: 30,
    minNoticeMinutes: 0,
    maxDaysAhead: 0,
    agendas: [{ ownerId: 1, busy: [] }],
    ...overrides,
  };
}

const starts = (slots: ReturnType<typeof freeSlots>) => slots.map((slot) => iso(slot.start));

describe('freeSlots', () => {
  it('evento ocupado no meio do dia: 09:00 e 09:30, depois 11:00 e 11:30', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T10:00:00Z'),
        hours: hoursOf(SP, { tue: [['09:00', '12:00']] }),
        // 10:00–11:00 no horário local.
        agendas: [{ ownerId: 7, busy: [busy('2026-11-24T13:00:00Z', '2026-11-24T14:00:00Z')] }],
      }),
    );
    expect(starts(slots)).toEqual([
      '2026-11-24T12:00:00Z',
      '2026-11-24T12:30:00Z',
      '2026-11-24T14:00:00Z',
      '2026-11-24T14:30:00Z',
    ]);
    expect(slots.every((slot) => slot.ownerId === 7 && slot.end - slot.start === 30 * MIN)).toBe(
      true,
    );
  });

  it('o horário que só encosta no evento ocupado continua livre', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T10:00:00Z'),
        hours: hoursOf(SP, { tue: [['09:00', '11:00']] }),
        // Ocupado das 09:30 às 10:00: 09:00–09:30 e 10:00–10:30 não se sobrepõem.
        agendas: [{ ownerId: 1, busy: [busy('2026-11-24T12:30:00Z', '2026-11-24T13:00:00Z')] }],
      }),
    );
    expect(starts(slots)).toEqual([
      '2026-11-24T12:00:00Z',
      '2026-11-24T13:00:00Z',
      '2026-11-24T13:30:00Z',
    ]);
  });

  it('antecedência mínima: às 13:20 com 60 minutos, o primeiro horário é 14:30', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T16:20:00Z'),
        minNoticeMinutes: 60,
        hours: hoursOf(SP, { tue: [['13:00', '16:00']] }),
      }),
    );
    expect(starts(slots)).toEqual([
      '2026-11-24T17:30:00Z',
      '2026-11-24T18:00:00Z',
      '2026-11-24T18:30:00Z',
    ]);
  });

  it('o primeiro horário depois da antecedência é oferecido e os anteriores não', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T16:30:00Z'),
        minNoticeMinutes: 60,
        hours: hoursOf(SP, { tue: [['14:00', '15:00']] }),
      }),
    );
    // Agora são 13:30 locais e a antecedência é de 60 minutos: o primeiro horário possível é 14:30
    // (o de 14:00 já passou do limite), e ele ainda cabe até as 15:00.
    expect(starts(slots)).toEqual(['2026-11-24T17:30:00Z']);
  });

  it('o compromisso precisa caber inteiro no intervalo do expediente', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T10:00:00Z'),
        slotMinutes: 45,
        hours: hoursOf(SP, { tue: [['09:00', '10:00']] }),
      }),
    );
    expect(starts(slots)).toEqual(['2026-11-24T12:00:00Z']);
  });

  it('dois intervalos no dia: a grade recomeça depois do almoço', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T10:00:00Z'),
        slotMinutes: 60,
        hours: hoursOf(SP, {
          tue: [
            ['09:00', '10:00'],
            ['13:00', '14:00'],
          ],
        }),
      }),
    );
    expect(starts(slots)).toEqual(['2026-11-24T12:00:00Z', '2026-11-24T16:00:00Z']);
  });

  it('dia sem expediente (sábado) não tem horários', () => {
    expect(
      freeSlots(
        query({
          now: at('2026-11-21T13:00:00Z'),
          hours: hoursOf(SP, { tue: [['09:00', '12:00']] }),
        }),
      ),
    ).toEqual([]);
  });

  it('fuso America/Manaus (UTC-4)', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T10:00:00Z'),
        hours: hoursOf('America/Manaus', { tue: [['09:00', '10:00']] }),
      }),
    );
    expect(starts(slots)).toEqual(['2026-11-24T13:00:00Z', '2026-11-24T13:30:00Z']);
  });

  it('virada de dia: às 23:50 só restam os horários do dia seguinte, e 24:00 fecha o dia', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T02:50:00Z'), // 23:50 de segunda no horário local
        maxDaysAhead: 1,
        hours: hoursOf(SP, { mon: [['23:00', '24:00']], tue: [['00:00', '01:00']] }),
      }),
    );
    expect(starts(slots)).toEqual(['2026-11-24T03:00:00Z', '2026-11-24T03:30:00Z']);
  });

  it('horário de verão, salto: 02:00 não existe e é pulado (America/New_York)', () => {
    const slots = freeSlots(
      query({
        now: at('2026-03-08T00:00:00Z'),
        slotMinutes: 60,
        maxDaysAhead: 1,
        hours: hoursOf('America/New_York', { sun: [['01:00', '05:00']] }),
      }),
    );
    // 01:00 EST, (02:00 não existe), 03:00 EDT, 04:00 EDT.
    expect(starts(slots)).toEqual([
      '2026-03-08T06:00:00Z',
      '2026-03-08T07:00:00Z',
      '2026-03-08T08:00:00Z',
    ]);
  });

  it('horário de verão, repetição: a hora duplicada vale uma vez, na primeira ocorrência', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-01T00:00:00Z'),
        slotMinutes: 60,
        maxDaysAhead: 1,
        hours: hoursOf('America/New_York', { sun: [['01:00', '03:00']] }),
      }),
    );
    // 01:00 EDT (05:00Z) e 02:00 EST (07:00Z).
    expect(starts(slots)).toEqual(['2026-11-01T05:00:00Z', '2026-11-01T07:00:00Z']);
  });

  it('lista de usuários: livre se algum estiver livre, vale o primeiro da lista', () => {
    const agendas: AgendaBusy[] = [
      { ownerId: 1, busy: [busy('2026-11-24T17:00:00Z', '2026-11-24T18:00:00Z')] }, // Ana: 14:00 ocupada
      { ownerId: 2, busy: [] }, // Bruno livre
    ];
    const slots = freeSlots(
      query({
        now: at('2026-11-24T10:00:00Z'),
        slotMinutes: 60,
        agendas,
        hours: hoursOf(SP, { tue: [['14:00', '16:00']] }),
      }),
    );
    expect(slots.map((slot) => [iso(slot.start), slot.ownerId])).toEqual([
      ['2026-11-24T17:00:00Z', 2],
      ['2026-11-24T18:00:00Z', 1],
    ]);
  });

  it('lista de usuários: horário em que todos estão ocupados não aparece', () => {
    const both = busy('2026-11-24T17:00:00Z', '2026-11-24T18:00:00Z');
    const slots = freeSlots(
      query({
        now: at('2026-11-24T10:00:00Z'),
        slotMinutes: 60,
        agendas: [
          { ownerId: 1, busy: [both] },
          { ownerId: 2, busy: [both] },
        ],
        hours: hoursOf(SP, { tue: [['14:00', '16:00']] }),
      }),
    );
    expect(starts(slots)).toEqual(['2026-11-24T18:00:00Z']);
  });

  it('sem agendas não há horários', () => {
    expect(
      freeSlots(
        query({
          now: at('2026-11-24T10:00:00Z'),
          agendas: [],
          hours: hoursOf(SP, { tue: [['09:00', '12:00']] }),
        }),
      ),
    ).toEqual([]);
  });

  it('devolve no máximo 10 horários, em ordem', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-24T10:00:00Z'),
        hours: hoursOf(SP, { tue: [['09:00', '18:00']] }),
      }),
    );
    expect(slots).toHaveLength(10);
    expect(iso(slots[9]!.start)).toBe('2026-11-24T16:30:00Z');
    expect(slots.map((slot) => slot.start)).toEqual([...slots.map((slot) => slot.start)].sort());
  });

  it('sem horário de funcionamento: segunda a sexta, 09:00–18:00, America/Sao_Paulo', () => {
    const slots = freeSlots(
      query({
        now: at('2026-11-20T20:00:00Z'), // sexta, 17:00 local
        slotMinutes: 60,
        maxDaysAhead: 3,
        limit: 3,
        hours: DEFAULT_CALENDAR_HOURS,
      }),
    );
    // Sexta 17:00, depois o fim de semana sem horários e segunda 09:00 e 10:00.
    expect(starts(slots)).toEqual([
      '2026-11-20T20:00:00Z',
      '2026-11-23T12:00:00Z',
      '2026-11-23T13:00:00Z',
    ]);
  });

  it('a janela vai de hoje até hoje + dias à frente, inclusive', () => {
    const base = {
      now: at('2026-11-24T10:00:00Z'),
      hours: hoursOf(SP, {
        tue: [['09:00', '09:30']],
        wed: [['09:00', '09:30']],
        thu: [['09:00', '09:30']],
      }),
    };
    expect(starts(freeSlots(query({ ...base, maxDaysAhead: 1 })))).toEqual([
      '2026-11-24T12:00:00Z',
      '2026-11-25T12:00:00Z',
    ]);
    expect(starts(freeSlots(query({ ...base, maxDaysAhead: 2 })))).toHaveLength(3);
  });

  it('"a partir de" antes de hoje vale hoje; depois de hoje pula os dias anteriores', () => {
    const base = {
      now: at('2026-11-24T10:00:00Z'),
      maxDaysAhead: 2,
      hours: hoursOf(SP, { tue: [['09:00', '09:30']], wed: [['09:00', '09:30']] }),
    };
    expect(starts(freeSlots(query({ ...base, from: '2026-11-01' })))).toEqual([
      '2026-11-24T12:00:00Z',
      '2026-11-25T12:00:00Z',
    ]);
    expect(starts(freeSlots(query({ ...base, from: '2026-11-25' })))).toEqual([
      '2026-11-25T12:00:00Z',
    ]);
  });
});

describe('funções de data e fuso', () => {
  it('zonedToEpoch converte a hora de parede e recusa hora inexistente', () => {
    expect(iso(zonedToEpoch('2026-11-24', 9 * 60, SP)!)).toBe('2026-11-24T12:00:00Z');
    expect(iso(zonedToEpoch('2026-11-24', 24 * 60, SP)!)).toBe('2026-11-25T03:00:00Z');
    expect(zonedToEpoch('2026-03-08', 2 * 60, 'America/New_York')).toBeNull();
  });

  it('localDate e localParts usam o fuso, não o UTC', () => {
    const instant = at('2026-11-25T02:30:00Z'); // ainda é dia 24 em São Paulo
    expect(localDate(instant, SP)).toBe('2026-11-24');
    expect(localParts(instant, SP)).toEqual({ data: '2026-11-24', hora: '23:30' });
    expect(localParts(instant, 'Asia/Tokyo')).toEqual({ data: '2026-11-25', hora: '11:30' });
  });

  it.each([
    ['2026-11-30', 1, '2026-12-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-11-24', 30, '2026-12-24'],
    ['2026-11-24', -1, '2026-11-23'],
  ])('addDays(%s, %i) = %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it('searchWindow: de hoje (no fuso) até hoje + N dias', () => {
    expect(searchWindow(at('2026-11-25T02:30:00Z'), SP, 7)).toEqual({
      first: '2026-11-24',
      last: '2026-12-01',
    });
  });
});
