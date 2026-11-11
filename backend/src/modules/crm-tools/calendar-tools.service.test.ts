import type { BusinessHours, WeekDay } from '@gptmaker/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import type { Env } from '../../config/env';
import type { Database } from '../../shared/database/database.module';
import { BitrixError } from '../bitrix';
import type { CalendarConfigRow } from './calendar-config.repository';
import { CalendarToolsService } from './calendar-tools.service';
import type { CrmCaller } from './crm-access.guard';

const caller: CrmCaller = { tenantId: 'tenant-a', agentId: 'agent-1', installationId: 101 };
const SP = 'America/Sao_Paulo';
/** Terça-feira 2026-11-24, 07:00 em São Paulo (UTC-3). */
const NOW = Date.parse('2026-11-24T10:00:00Z');

const fakeDb = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Database;

function hoursOf(days: Partial<Record<WeekDay, Array<[string, string]>>>): BusinessHours {
  const day = (key: WeekDay) => (days[key] ?? []).map(([start, end]) => ({ start, end }));
  return {
    timezone: SP,
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

interface PortalEvent {
  ACCESSIBILITY: string;
  DATE_FROM_TS_UTC: string;
  DATE_TO_TS_UTC: string;
}
/** Evento de `from` a `to` (UTC) com a disponibilidade dada. */
const event = (accessibility: string, fromIso: string, toIso: string): PortalEvent => ({
  ACCESSIBILITY: accessibility,
  DATE_FROM_TS_UTC: String(Date.parse(fromIso) / 1000),
  DATE_TO_TS_UTC: String(Date.parse(toIso) / 1000),
});

function config(overrides: Partial<CalendarConfigRow> = {}): CalendarConfigRow {
  return {
    agentId: caller.agentId,
    tenantId: caller.tenantId,
    mode: 'FIXED_USER',
    userIds: [508],
    slotMinutes: 30,
    minNoticeMinutes: 0,
    maxDaysAhead: 1,
    lastScopeErrorAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(
  options: {
    row?: CalendarConfigRow | null;
    hours?: BusinessHours | null;
    /** Usuários ativos do portal: id → nome. */
    users?: Record<number, string>;
    events?: Record<number, PortalEvent[]>;
    responsible?: { found: false } | { found: true; userId: number | null };
    failWith?: { method: string; error: Error };
    ratePerMinute?: number;
  } = {},
) {
  const users = options.users ?? { 508: 'Ana Lima', 418: 'Bruno Reis' };
  const events = options.events ?? {};
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const bitrix = {
    call: vi.fn(async (_installation: number, method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (options.failWith?.method === method) throw options.failWith.error;
      if (method === 'user.get') {
        const wanted = (params.FILTER as { ID: number[] }).ID;
        return {
          result: wanted
            .filter((id) => id in users)
            .map((id) => ({
              ID: String(id),
              NAME: users[id]!.split(' ')[0],
              LAST_NAME: users[id]!.split(' ')[1],
            })),
        };
      }
      if (method === 'calendar.accessibility.get') {
        const wanted = params.users as number[];
        return { result: Object.fromEntries(wanted.map((id) => [String(id), events[id] ?? []])) };
      }
      throw new Error(`método inesperado: ${method}`);
    }),
  };
  const crm = { clientResponsible: vi.fn(async () => options.responsible ?? { found: false }) };
  const scope = {
    markScopeMissing: vi.fn(async () => {}),
    clearScopeMissing: vi.fn(async () => {}),
  };
  const row = options.row === null ? undefined : (options.row ?? config());
  const configs = { find: vi.fn(async () => row) };
  const agents = {
    getById: vi.fn(async () => ({
      businessHours:
        options.hours === undefined ? hoursOf({ tue: [['09:00', '12:00']] }) : options.hours,
    })),
  };
  const redis = new FakeRedis();
  const service = new CalendarToolsService(
    crm as never,
    bitrix as never,
    scope as never,
    configs as never,
    agents as never,
    fakeDb,
    redis.asRedis(),
    { CRM_TOOLS_RATE_PER_MINUTE: options.ratePerMinute ?? 60 } as Env,
  );
  service.clock = () => NOW;
  const portalCalls = (method: string) => calls.filter((call) => call.method === method);
  return { service, bitrix, crm, scope, calls, portalCalls };
}

const hoursOnly = (body: Record<string, unknown>) =>
  (body.horarios as Array<Record<string, string>>).map(
    (slot) => `${slot.data} ${slot.hora_inicio}-${slot.hora_fim}`,
  );

describe('CalendarToolsService.freeSlots', () => {
  it('sem configuração de agenda: responde que não está configurada e não consulta o Bitrix24', async () => {
    const { service, bitrix } = setup({ row: null });
    const result = await service.freeSlots(caller);
    expect(result.outcome).toBe('not_found');
    expect(result.body.erro).toContain('não está configurada');
    expect(bitrix.call).not.toHaveBeenCalled();
  });

  it('usuário fixo: devolve os horários livres, a duração, o fuso e quem atende', async () => {
    const { service, portalCalls } = setup({
      // 10:00–11:00 locais, ocupado.
      events: { 508: [event('busy', '2026-11-24T13:00:00Z', '2026-11-24T14:00:00Z')] },
    });
    const result = await service.freeSlots(caller);

    expect(result.outcome).toBe('ok');
    expect(result.count).toBe(4);
    expect(hoursOnly(result.body)).toEqual([
      '2026-11-24 09:00-09:30',
      '2026-11-24 09:30-10:00',
      '2026-11-24 11:00-11:30',
      '2026-11-24 11:30-12:00',
    ]);
    expect(result.body).toMatchObject({
      fuso_horario: SP,
      duracao_minutos: 30,
      periodo: { de: '2026-11-24', ate: '2026-11-25' },
    });
    expect(
      (result.body.horarios as Array<{ com: string; dia_da_semana: string }>)[0],
    ).toMatchObject({
      com: 'Ana Lima',
      dia_da_semana: 'terça-feira',
    });
    expect(result.body.orientacao).toContain('agendar_compromisso');
    // Só datas na API do Bitrix24, com um dia de folga de cada lado; filtro de usuário ativo.
    expect(portalCalls('calendar.accessibility.get')[0]!.params).toEqual({
      users: [508],
      from: '2026-11-23',
      to: '2026-11-26',
    });
    expect(portalCalls('user.get')[0]!.params).toEqual({ FILTER: { ID: [508], ACTIVE: true } });
  });

  it('evento marcado como livre ou provisório não bloqueia o horário', async () => {
    const { service } = setup({
      events: {
        508: [
          event('free', '2026-11-24T13:00:00Z', '2026-11-24T14:00:00Z'),
          event('quest', '2026-11-24T14:00:00Z', '2026-11-24T15:00:00Z'),
        ],
      },
    });
    const result = await service.freeSlots(caller);
    expect(result.count).toBe(6);
  });

  it('evento "ausente" bloqueia como ocupado', async () => {
    const { service } = setup({
      events: { 508: [event('absent', '2026-11-24T12:00:00Z', '2026-11-24T15:00:00Z')] },
    });
    const result = await service.freeSlots(caller);
    expect(result.count).toBe(0);
    expect(result.body.mensagem).toContain('Não há horários disponíveis');
  });

  describe('responsável do cliente no CRM', () => {
    const row = () => config({ mode: 'CLIENT_OWNER', userIds: [] });

    it('usa a agenda do responsável do cliente da conversa', async () => {
      const { service, crm, portalCalls } = setup({
        row: row(),
        responsible: { found: true, userId: 418 },
      });
      const result = await service.freeSlots(caller, { cliente: 'ref-maria' });
      expect(crm.clientResponsible).toHaveBeenCalledWith(caller, 'ref-maria');
      expect(portalCalls('calendar.accessibility.get')[0]!.params.users).toEqual([418]);
      expect(result.count).toBe(6);
      expect((result.body.horarios as Array<{ com: string }>)[0]!.com).toBe('Bruno Reis');
    });

    it('cliente sem responsável: não há agenda e nada é consultado no calendário', async () => {
      const { service, portalCalls } = setup({
        row: row(),
        responsible: { found: true, userId: null },
      });
      const result = await service.freeSlots(caller, { cliente: 'ref-maria' });
      expect(result.outcome).toBe('not_found');
      expect(result.body.erro).toContain('Não há agenda');
      expect(portalCalls('calendar.accessibility.get')).toEqual([]);
    });

    it('responsável inativo ou inexistente no portal: não há agenda, sem escolher outra', async () => {
      const { service, portalCalls } = setup({
        row: row(),
        users: { 508: 'Ana Lima' },
        responsible: { found: true, userId: 418 },
      });
      const result = await service.freeSlots(caller, { cliente: 'ref-maria' });
      expect(result.body.erro).toContain('Não há agenda');
      expect(portalCalls('calendar.accessibility.get')).toEqual([]);
    });

    it('referência inválida ou de outro tenant: cliente não encontrado, sem consultar o Bitrix24', async () => {
      const { service, bitrix } = setup({ row: row(), responsible: { found: false } });
      const result = await service.freeSlots(caller, { cliente: 'forjada' });
      expect(result.outcome).toBe('not_found');
      expect(result.body.erro).toContain('Cliente não encontrado');
      expect(bitrix.call).not.toHaveBeenCalled();
    });

    it('nos outros modos a referência do cliente é ignorada', async () => {
      const { service, crm } = setup();
      await service.freeSlots(caller, { cliente: 'qualquer' });
      expect(crm.clientResponsible).not.toHaveBeenCalled();
    });
  });

  describe('lista de usuários', () => {
    const row = () => config({ mode: 'USER_LIST', userIds: [508, 418] });

    it('o horário é livre se algum estiver livre, e vale o primeiro da lista', async () => {
      const { service, portalCalls } = setup({
        row: row(),
        // Ana (508) ocupada das 09:00 às 09:30 locais.
        events: { 508: [event('busy', '2026-11-24T12:00:00Z', '2026-11-24T12:30:00Z')] },
      });
      const result = await service.freeSlots(caller);
      expect(portalCalls('calendar.accessibility.get')[0]!.params.users).toEqual([508, 418]);
      const [first, second] = result.body.horarios as Array<{ hora_inicio: string; com: string }>;
      expect(first).toMatchObject({ hora_inicio: '09:00', com: 'Bruno Reis' });
      expect(second).toMatchObject({ hora_inicio: '09:30', com: 'Ana Lima' });
    });

    it('usuário inativo da lista é ignorado', async () => {
      const { service, portalCalls } = setup({ row: row(), users: { 508: 'Ana Lima' } });
      const result = await service.freeSlots(caller);
      expect(portalCalls('calendar.accessibility.get')[0]!.params.users).toEqual([508]);
      expect(result.count).toBe(6);
    });

    it('todos ocupados no horário: ele não aparece', async () => {
      const both = event('busy', '2026-11-24T12:00:00Z', '2026-11-24T12:30:00Z');
      const { service } = setup({ row: row(), events: { 508: [both], 418: [both] } });
      const result = await service.freeSlots(caller);
      expect(hoursOnly(result.body)[0]).toBe('2026-11-24 09:30-10:00');
    });
  });

  describe('escopo calendar', () => {
    it('sem o escopo: responde que o calendário não está liberado e marca o aviso do painel', async () => {
      const { service, scope } = setup({
        failWith: {
          method: 'calendar.accessibility.get',
          error: new BitrixError(
            'API_ERROR',
            'calendar.accessibility.get',
            'insufficient_scope',
            '',
          ),
        },
      });
      const result = await service.freeSlots(caller);
      expect(result.outcome).toBe('unavailable');
      expect(result.body.erro).toContain('não está liberado');
      expect(result.body.erro).toContain('a equipe vai retornar');
      expect(scope.markScopeMissing).toHaveBeenCalledWith('tenant-a', 'agent-1');
    });

    it('depois de reautorizar, a primeira chamada que funciona limpa o aviso', async () => {
      const { service, scope } = setup({ row: config({ lastScopeErrorAt: new Date() }) });
      await service.freeSlots(caller);
      expect(scope.clearScopeMissing).toHaveBeenCalledWith('tenant-a', 'agent-1');
    });

    it('sem aviso pendente, nada é gravado a cada chamada', async () => {
      const { service, scope } = setup();
      await service.freeSlots(caller);
      expect(scope.clearScopeMissing).not.toHaveBeenCalled();
      expect(scope.markScopeMissing).not.toHaveBeenCalled();
    });

    it('outro erro de permissão do Bitrix24 não marca falta de escopo', async () => {
      const { service, scope } = setup({
        failWith: {
          method: 'calendar.accessibility.get',
          error: new BitrixError('API_ERROR', 'calendar.accessibility.get', 'ACCESS_DENIED', ''),
        },
      });
      const result = await service.freeSlots(caller);
      expect(result.outcome).toBe('unavailable');
      expect(scope.markScopeMissing).not.toHaveBeenCalled();
    });
  });

  describe('data pedida', () => {
    it.each([
      ['depois da janela', '2026-12-25'],
      ['antes de hoje', '2026-11-01'],
      ['formato inválido', 'amanhã'],
      ['data que não existe', '2026-02-31'],
    ])('%s: informa o período permitido e não consulta o Bitrix24', async (_caso, aPartirDe) => {
      const { service, bitrix } = setup();
      const result = await service.freeSlots(caller, { aPartirDe });
      expect(result.outcome).toBe('not_found');
      expect(result.body).toMatchObject({
        erro: 'Data fora do período em que há agenda.',
        periodo_permitido: { de: '2026-11-24', ate: '2026-11-25' },
      });
      expect(bitrix.call).not.toHaveBeenCalled();
    });

    it('a partir de uma data dentro da janela, só entram horários dela em diante', async () => {
      const { service } = setup({
        hours: hoursOf({ tue: [['09:00', '10:00']], wed: [['09:00', '10:00']] }),
      });
      const result = await service.freeSlots(caller, { aPartirDe: '2026-11-25' });
      expect(hoursOnly(result.body)).toEqual(['2026-11-25 09:00-09:30', '2026-11-25 09:30-10:00']);
    });
  });

  it('sem horários na janela: responde sem erro e orienta a avisar que a equipe retorna', async () => {
    const { service } = setup({ hours: hoursOf({ mon: [['09:00', '12:00']] }) });
    const result = await service.freeSlots(caller);
    expect(result.outcome).toBe('ok');
    expect(result.count).toBe(0);
    expect(result.body).toMatchObject({ horarios: [] });
    expect(result.body.mensagem).toContain('a equipe vai retornar');
  });

  it('agente sem horário de funcionamento: expediente padrão de segunda a sexta, 09:00–18:00', async () => {
    const { service } = setup({ hours: null });
    const result = await service.freeSlots(caller);
    expect(result.body.fuso_horario).toBe(SP);
    expect(hoursOnly(result.body)[0]).toBe('2026-11-24 09:00-09:30');
    expect(result.count).toBe(10);
  });

  it('Bitrix24 fora do ar: responde indisponibilidade temporária', async () => {
    const { service } = setup({
      failWith: {
        method: 'user.get',
        error: new BitrixError('UNAVAILABLE', 'user.get', 'NETWORK_ERROR', 'fora'),
      },
    });
    const result = await service.freeSlots(caller);
    expect(result.outcome).toBe('unavailable');
    expect(result.body.erro).toContain('temporariamente indisponíveis');
  });

  it('respeita o limite de chamadas por agente', async () => {
    const { service, bitrix } = setup({ ratePerMinute: 2 });
    await service.freeSlots(caller);
    await service.freeSlots(caller);
    bitrix.call.mockClear();
    const third = await service.freeSlots(caller);
    expect(third.outcome).toBe('rate_limited');
    expect(bitrix.call).not.toHaveBeenCalled();
  });
});
