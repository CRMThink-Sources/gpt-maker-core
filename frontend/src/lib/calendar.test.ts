import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './platform-session';
import {
  calendarErrorMessage,
  describeCalendar,
  draftOf,
  getCalendarConfig,
  inputOf,
  removeCalendarConfig,
  saveCalendarConfig,
  toNameMap,
} from './calendar';

const config = (patch: Record<string, unknown> = {}) =>
  ({
    mode: 'FIXED_USER',
    userIds: [508],
    slotMinutes: 30,
    minNoticeMinutes: 60,
    maxDaysAhead: 7,
    ...patch,
  }) as never;

describe('draftOf', () => {
  it('sem agenda salva, abre com usuário fixo e os padrões do produto', () => {
    expect(draftOf(null)).toEqual({
      mode: 'FIXED_USER',
      userIds: [],
      slotMinutes: '30',
      minNoticeMinutes: '60',
      maxDaysAhead: '7',
    });
  });

  it('com agenda salva, devolve os valores dela (números como texto, para poder digitar)', () => {
    expect(
      draftOf(
        config({ mode: 'USER_LIST', userIds: [418, 508], slotMinutes: 45, maxDaysAhead: 14 }),
      ),
    ).toEqual({
      mode: 'USER_LIST',
      userIds: [418, 508],
      slotMinutes: '45',
      minNoticeMinutes: '60',
      maxDaysAhead: '14',
    });
  });
});

describe('inputOf', () => {
  const draft = {
    mode: 'USER_LIST' as const,
    userIds: [1, 2],
    slotMinutes: '45',
    minNoticeMinutes: '0',
    maxDaysAhead: '30',
  };

  it('monta o corpo da API com números', () => {
    expect(inputOf(draft)).toEqual({
      mode: 'USER_LIST',
      userIds: [1, 2],
      slotMinutes: 45,
      minNoticeMinutes: 0,
      maxDaysAhead: 30,
    });
  });

  it('responsável do cliente nunca leva usuários', () => {
    expect(inputOf({ ...draft, mode: 'CLIENT_OWNER' })?.userIds).toEqual([]);
  });

  it.each([
    ['duração vazia', { slotMinutes: '' }],
    ['antecedência só com espaços', { minNoticeMinutes: '   ' }],
    ['janela que não é número', { maxDaysAhead: 'sete' }],
  ])('número não preenchido (%s): devolve null', (_caso, patch) => {
    expect(inputOf({ ...draft, ...patch })).toBeNull();
  });

  it('zero é um número válido (antecedência 0)', () => {
    expect(inputOf({ ...draft, minNoticeMinutes: '0' })?.minNoticeMinutes).toBe(0);
  });
});

describe('describeCalendar', () => {
  it.each([
    [0, 'sem antecedência'],
    [30, '30 minutos'],
    [60, '1 hora'],
    [90, '90 minutos'],
    [120, '2 horas'],
    [1440, '24 horas'],
  ])('antecedência de %i minutos aparece como "%s"', (minutes, text) => {
    expect(describeCalendar(config({ minNoticeMinutes: minutes }), {}).rules).toContain(
      `antecedência mínima: ${text}`,
    );
  });

  it('janela no singular e no plural', () => {
    expect(describeCalendar(config({ maxDaysAhead: 1 }), {}).rules).toContain('até 1 dia à frente');
    expect(describeCalendar(config({ maxDaysAhead: 7 }), {}).rules).toContain(
      'até 7 dias à frente',
    );
  });

  it('usa o nome do usuário, ou o número quando o nome não veio', () => {
    expect(
      describeCalendar(config({ mode: 'USER_LIST', userIds: [508, 418] }), { 508: 'Ana Lima' })
        .owner,
    ).toBe('Ana Lima, usuário #418');
  });

  it('responsável do cliente não cita usuário', () => {
    expect(describeCalendar(config({ mode: 'CLIENT_OWNER', userIds: [] }), {}).owner).toBe(
      'o responsável pelo cliente no CRM',
    );
  });
});

describe('cliente de API', () => {
  const calls: Array<[string, unknown]> = [];
  const api = (async (path: string, init?: unknown) => {
    calls.push([path, init]);
    return { config: null, crmConnected: true, scopeMissing: false };
  }) as never;

  it('usa a rota do agente, com o id escapado, e o método certo', async () => {
    await getCalendarConfig(api, 'a/b');
    await saveCalendarConfig(api, 'a/b', { mode: 'CLIENT_OWNER' });
    await removeCalendarConfig(api, 'a/b');
    expect(calls).toEqual([
      ['/app/agents/a%2Fb/calendar', undefined],
      [
        '/app/agents/a%2Fb/calendar',
        { method: 'PUT', body: JSON.stringify({ mode: 'CLIENT_OWNER' }) },
      ],
      ['/app/agents/a%2Fb/calendar', { method: 'DELETE' }],
    ]);
  });
});

describe('calendarErrorMessage', () => {
  it.each([
    ['CALENDAR_CRM_REQUIRED', /Ligue o acesso ao CRM/],
    ['CALENDAR_USER_INVALID', /não existem no Bitrix24 ou estão inativos/],
    ['CALENDAR_PORTAL_UNAVAILABLE', /O Bitrix24 não respondeu agora/],
  ])('erro %s vira mensagem em português', (code, text) => {
    expect(
      calendarErrorMessage(new ApiRequestError(422, code, 'texto do servidor'), 'padrão'),
    ).toMatch(text);
  });

  it('erro desconhecido usa o texto padrão', () => {
    expect(calendarErrorMessage(new Error('x'), 'Não foi possível salvar.')).toBe(
      'Não foi possível salvar.',
    );
  });
});

describe('toNameMap', () => {
  it('converte os ids em texto do portal para números', () => {
    expect(toNameMap({ '508': 'Ana Lima', '418': 'Bruno Reis' })).toEqual({
      508: 'Ana Lima',
      418: 'Bruno Reis',
    });
    expect(toNameMap({})).toEqual({});
  });
});
