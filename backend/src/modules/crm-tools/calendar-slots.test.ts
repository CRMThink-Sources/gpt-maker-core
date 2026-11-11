import type { BusinessHours, WeekDay } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  type AgendaBusy,
  DEFAULT_CALENDAR_HOURS,
  eventInterval,
  freeSlots,
  localDate,
  localParts,
  searchWindow,
  slotViolation,
  spokenTime,
  spokenWhen,
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

describe('slotViolation', () => {
  const rules = {
    now: at('2026-11-24T10:00:00Z'), // terça 07:00 em São Paulo
    hours: hoursOf(SP, { tue: [['09:00', '12:00']], wed: [['09:00', '12:00']] }),
    slotMinutes: 30,
    minNoticeMinutes: 60,
    maxDaysAhead: 1,
  };

  it.each([
    ['horário dentro das regras', '2026-11-24T13:00:00Z', null],
    ['último horário que cabe no expediente', '2026-11-24T14:30:00Z', null],
    ['dia seguinte, dentro da janela', '2026-11-25T12:00:00Z', null],
    ['dia que já passou', '2026-11-23T12:00:00Z', 'past'],
    ['depois da janela de busca', '2026-12-01T12:00:00Z', 'window'],
    ['fora do expediente (antes)', '2026-11-24T11:00:00Z', 'grid'],
    ['fora do expediente (depois do fim)', '2026-11-24T15:00:00Z', 'grid'],
    ['não alinhado à grade de 30 minutos', '2026-11-24T13:15:00Z', 'grid'],
    ['compromisso que não cabe até o fim do expediente', '2026-11-24T14:45:00Z', 'grid'],
  ])('%s', (_caso, start, expected) => {
    expect(slotViolation(rules, at(start))).toBe(expected);
  });

  it('dia sem expediente (quinta, com a janela cobrindo o dia)', () => {
    expect(slotViolation({ ...rules, maxDaysAhead: 3 }, at('2026-11-26T12:00:00Z'))).toBe('grid');
  });

  it('antes da antecedência mínima: às 08:30 com 60 minutos, 09:00 não e 09:30 sim', () => {
    const later = { ...rules, now: at('2026-11-24T11:30:00Z') };
    expect(slotViolation(later, at('2026-11-24T12:00:00Z'))).toBe('notice');
    expect(slotViolation(later, at('2026-11-24T12:30:00Z'))).toBeNull();
  });
});

describe('eventInterval (período real de um evento do portal)', () => {
  const sec = (iso: string) => Date.parse(iso) / 1000;
  /** Evento como `calendar.accessibility.get` devolve: `TS` na parede de quem consulta, como se fosse UTC. */
  const portal = (from: string, to: string, userOffset: number, timezone: string) =>
    eventInterval({ fromTs: sec(from), toTs: sec(to), userOffset, timezone });
  const span = (from: string, to: string) => ({ start: Date.parse(from), end: Date.parse(to) });

  it.each([
    // Valores observados no portal de teste (consulta feita por um usuário de São Paulo, UTC-3).
    [
      'criado pela API, 14:20 em São Paulo',
      portal('2026-11-12T14:20:00Z', '2026-11-12T15:20:00Z', 0, 'America/Sao_Paulo'),
      span('2026-11-12T17:20:00Z', '2026-11-12T18:20:00Z'),
    ],
    [
      'criado à mão na tela do Calendário, 17:20 em São Paulo (bate com a atividade do CRM)',
      portal('2026-11-11T17:20:00Z', '2026-11-11T18:20:00Z', 0, 'America/Sao_Paulo'),
      span('2026-11-11T20:20:00Z', '2026-11-11T21:20:00Z'),
    ],
    [
      'evento em Nova York, 10:00 (= 15:00Z), visto de São Paulo',
      portal('2026-11-13T12:00:00Z', '2026-11-13T13:00:00Z', -7200, 'America/New_York'),
      span('2026-11-13T15:00:00Z', '2026-11-13T16:00:00Z'),
    ],
    [
      'exemplo da documentação do Bitrix24 (consulta em UTC, evento em Manágua)',
      eventInterval({
        fromTs: 1733158800,
        toTs: 1733162400,
        userOffset: -21600,
        timezone: 'America/Managua',
      }),
      span('2024-12-02T17:00:00Z', '2024-12-02T18:00:00Z'),
    ],
    [
      'dia do salto do horário de verão (03:30 EDT, depois do salto), visto de São Paulo',
      portal('2026-03-08T04:30:00Z', '2026-03-08T05:30:00Z', -3600, 'America/New_York'),
      span('2026-03-08T07:30:00Z', '2026-03-08T08:30:00Z'),
    ],
  ])('%s', (_caso, actual, expected) => {
    expect(actual).toEqual(expected);
  });

  it('a duração do evento é preservada', () => {
    const result = portal('2026-11-12T14:20:00Z', '2026-11-12T14:50:00Z', 0, 'America/Sao_Paulo')!;
    expect(result.end - result.start).toBe(30 * 60_000);
  });

  it('aceita números como texto, como a API devolve', () => {
    expect(
      eventInterval({
        fromTs: String(sec('2026-11-12T14:20:00Z')),
        toTs: String(sec('2026-11-12T15:20:00Z')),
        userOffset: '0',
        timezone: 'America/Sao_Paulo',
      }),
    ).toEqual(span('2026-11-12T17:20:00Z', '2026-11-12T18:20:00Z'));
  });

  it('sem deslocamento informado, vale zero', () => {
    expect(
      eventInterval({
        fromTs: sec('2026-11-12T14:20:00Z'),
        toTs: sec('2026-11-12T15:20:00Z'),
        timezone: 'America/Sao_Paulo',
      }),
    ).toEqual(span('2026-11-12T17:20:00Z', '2026-11-12T18:20:00Z'));
  });

  it.each([
    ['sem fuso', undefined],
    ['fuso inválido', 'Marte/Olimpo'],
  ])('%s: não há como corrigir, vale o timestamp como veio', (_caso, timezone) => {
    expect(
      eventInterval({
        fromTs: sec('2026-11-12T14:20:00Z'),
        toTs: sec('2026-11-12T15:20:00Z'),
        userOffset: -7200,
        timezone,
      }),
    ).toEqual(span('2026-11-12T14:20:00Z', '2026-11-12T15:20:00Z'));
  });

  it.each([
    ['início inválido', { fromTs: 'x', toTs: 10 }],
    ['fim inválido', { fromTs: 10, toTs: undefined }],
    ['fim antes do início', { fromTs: 20, toTs: 10 }],
  ])('%s: ignora o evento', (_caso, event) => {
    expect(eventInterval({ ...event, timezone: 'America/Sao_Paulo' })).toBeNull();
  });
});

describe('spokenTime e spokenWhen (como o agente fala com o cliente)', () => {
  it.each([
    ['09:00', '9h'],
    ['09:30', '9h30'],
    ['10:05', '10h05'],
    ['14:00', '14h'],
    ['00:00', '0h'],
    ['23:45', '23h45'],
  ])('hora %s vira "%s"', (hora, expected) => {
    expect(spokenTime(hora)).toBe(expected);
  });

  it.each([
    ['2026-11-12', '09:30', 'quinta-feira, 12 de novembro, às 9h30'],
    ['2026-11-12', '09:00', 'quinta-feira, 12 de novembro, às 9h'],
    ['2026-11-24', '14:00', 'terça-feira, 24 de novembro, às 14h'],
    ['2026-12-01', '10:00', 'terça-feira, 1 de dezembro, às 10h'],
    ['2026-11-21', '08:15', 'sábado, 21 de novembro, às 8h15'],
    ['2026-11-22', '16:00', 'domingo, 22 de novembro, às 16h'],
    ['2026-03-02', '11:00', 'segunda-feira, 2 de março, às 11h'],
    ['2026-11-12', '01:30', 'quinta-feira, 12 de novembro, à 1h30'],
  ])('%s %s vira "%s"', (date, hora, expected) => {
    expect(spokenWhen(date, hora)).toBe(expected);
  });

  it('cita o ano só quando não é o corrente', () => {
    expect(spokenWhen('2026-11-12', '09:30', 2026)).toBe('quinta-feira, 12 de novembro, às 9h30');
    expect(spokenWhen('2027-01-12', '09:30', 2026)).toBe(
      'terça-feira, 12 de janeiro de 2027, às 9h30',
    );
  });

  it('nunca traz a data no formato AAAA-MM-DD nem a hora no formato HH:mm', () => {
    for (const [date, hora] of [
      ['2026-11-12', '09:30'],
      ['2027-02-03', '17:00'],
    ] as const) {
      expect(spokenWhen(date, hora, 2026)).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/);
    }
  });
});
