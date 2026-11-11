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

/** Cliente identificado na conversa (referência já verificada pelo `CrmToolsService`). */
const maria = (userId: number | null) => ({
  found: true as const,
  type: 'contact' as const,
  id: 12,
  name: 'Maria Souza',
  userId,
});

function setup(
  options: {
    row?: CalendarConfigRow | null;
    hours?: BusinessHours | null;
    /** Usuários ativos do portal: id → nome. */
    users?: Record<number, string>;
    events?: Record<number, PortalEvent[]>;
    client?: ReturnType<typeof maria> | { found: false };
    failWith?: { method: string; error: Error };
    /** Erro de `calendar.event.add` (pode ser trocado depois pelo teste). */
    failAdd?: Error;
    ratePerMinute?: number;
  } = {},
) {
  const users = options.users ?? { 508: 'Ana Lima', 418: 'Bruno Reis' };
  const events = options.events ?? {};
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  /** Eventos que o portal simulado recebeu em `calendar.event.add` (passam a ocupar a agenda). */
  const created: Array<Record<string, unknown>> = [];
  const state = { failAdd: options.failAdd };
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
      if (method === 'calendar.event.add') {
        // Dá a vez a outras chamadas, como uma resposta de rede.
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (state.failAdd) throw state.failAdd;
        created.push(params);
        const toMs = (local: unknown) => Date.parse(String(local).replace(' ', 'T') + '-03:00');
        const owner = Number(params.ownerId);
        (events[owner] ??= []).push({
          ACCESSIBILITY: 'busy',
          DATE_FROM_TS_UTC: String(toMs(params.from) / 1000),
          DATE_TO_TS_UTC: String(toMs(params.to) / 1000),
        });
        return { result: 279_590 + created.length };
      }
      throw new Error(`método inesperado: ${method}`);
    }),
  };
  const crm = { calendarClient: vi.fn(async () => options.client ?? maria(null)) };
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
  return { service, bitrix, crm, scope, calls, portalCalls, created, state, redis };
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
        client: maria(418),
      });
      const result = await service.freeSlots(caller, { cliente: 'ref-maria' });
      expect(crm.calendarClient).toHaveBeenCalledWith(caller, 'ref-maria');
      expect(portalCalls('calendar.accessibility.get')[0]!.params.users).toEqual([418]);
      expect(result.count).toBe(6);
      expect((result.body.horarios as Array<{ com: string }>)[0]!.com).toBe('Bruno Reis');
    });

    it('cliente sem responsável: não há agenda e nada é consultado no calendário', async () => {
      const { service, portalCalls } = setup({
        row: row(),
        client: maria(null),
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
        client: maria(418),
      });
      const result = await service.freeSlots(caller, { cliente: 'ref-maria' });
      expect(result.body.erro).toContain('Não há agenda');
      expect(portalCalls('calendar.accessibility.get')).toEqual([]);
    });

    it('referência inválida ou de outro tenant: cliente não encontrado, sem consultar o Bitrix24', async () => {
      const { service, bitrix } = setup({ row: row(), client: { found: false } });
      const result = await service.freeSlots(caller, { cliente: 'forjada' });
      expect(result.outcome).toBe('not_found');
      expect(result.body.erro).toContain('Cliente não encontrado');
      expect(bitrix.call).not.toHaveBeenCalled();
    });

    it('nos outros modos a referência do cliente é ignorada', async () => {
      const { service, crm } = setup();
      await service.freeSlots(caller, { cliente: 'qualquer' });
      expect(crm.calendarClient).not.toHaveBeenCalled();
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

describe('CalendarToolsService.book', () => {
  /** Terça 09:00 em São Paulo, dentro do expediente (09:00–12:00) e da janela de 1 dia. */
  const NINE = '2026-11-24 09:00';
  const ask = (overrides: Record<string, unknown> = {}) => ({
    cliente: 'ref-maria',
    inicio: NINE,
    ...overrides,
  });
  const keysOf = (redis: FakeRedis) =>
    [...redis.store.keys()].filter((k) => k.startsWith('calendar:booked:'));

  it('agenda no horário livre: um evento na agenda de quem atende, vinculado ao cliente', async () => {
    const { service, created } = setup({ client: maria(null) });
    const result = await service.book(caller, ask({ assunto: 'Visita técnica' }));

    expect(result.outcome).toBe('ok');
    expect(result.body).toMatchObject({
      agendado: true,
      data: '2026-11-24',
      dia_da_semana: 'terça-feira',
      hora_inicio: '09:00',
      hora_fim: '09:30',
      duracao_minutos: 30,
      fuso_horario: SP,
      com: 'Ana Lima',
      assunto: 'Visita técnica',
    });
    expect(created).toEqual([
      {
        type: 'user',
        ownerId: 508,
        auto_detect_section: 'Y',
        name: 'Agendamento: Maria Souza',
        description: 'Compromisso marcado pelo agente de IA.\nAssunto: Visita técnica',
        from: '2026-11-24 09:00:00',
        to: '2026-11-24 09:30:00',
        timezone_from: SP,
        timezone_to: SP,
        attendees: [508],
        accessibility: 'busy',
        importance: 'normal',
        is_meeting: 'N',
        crm_fields: ['C_12'],
      },
    ]);
  });

  it('a resposta e o evento não trazem identificadores internos nem dados além do nome', async () => {
    const { service, created } = setup({ client: maria(null) });
    const result = await service.book(caller, ask());
    // Só estes campos, em português; nada de ids do Bitrix24 (usuário 508, evento 279591).
    expect(Object.keys(result.body).sort()).toEqual(
      [
        'agendado',
        'com',
        'data',
        'dia_da_semana',
        'duracao_minutos',
        'fuso_horario',
        'hora_fim',
        'hora_inicio',
        'mensagem',
      ].sort(),
    );
    expect(JSON.stringify(result.body)).not.toMatch(/508|418|279\d{3}|ownerId|eventId/);
    const [event] = created;
    expect(String(event!.name).length).toBeLessThanOrEqual(100);
    expect(String(event!.description).length).toBeLessThanOrEqual(300);
    // Nada de telefone, e-mail ou conversa no evento: só o nome do cliente no título.
    expect(`${event!.name} ${event!.description}`).not.toMatch(/\d{4,}|@|\+55/);
  });

  it('o assunto livre do agente é limpo: uma linha, sem controle e com tamanho limitado', async () => {
    const { service, created } = setup({ client: maria(null) });
    await service.book(
      caller,
      ask({ assunto: `  Revisão\n\ndo\tcontrato\u0000${'x'.repeat(400)}  ` }),
    );
    const description = String(created[0]!.description);
    const subject = description.split('\nAssunto: ')[1]!;
    expect(subject).toMatch(/^Revisão do contrato /);
    expect([...subject].some((char) => char.charCodeAt(0) < 32)).toBe(false);
    expect(subject.length).toBeLessThanOrEqual(200);
    expect(description.length).toBeLessThanOrEqual(300);
  });

  it('o assunto não injeta marcação (BBCode, HTML, links) na descrição do evento', async () => {
    const { service, created } = setup({ client: maria(null) });
    await service.book(
      caller,
      ask({
        assunto: '[URL=http://phishing.exemplo]clique aqui[/URL] <b>urgente</b> <script>x</script>',
      }),
    );
    const subject = String(created[0]!.description).split('\nAssunto: ')[1]!;
    expect(subject).not.toMatch(/[[\]<>]/);
    expect(subject).toContain('clique aqui');
  });

  it('o dono da agenda vem só da configuração: campos de usuário no pedido do modelo são ignorados', async () => {
    const { service, created } = setup({ client: maria(null) });
    await service.book(caller, {
      ...ask(),
      ownerId: 999,
      usuario: 999,
      attendees: [999],
      crm_fields: ['D_1'],
      type: 'group',
    } as never);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: 'user',
      ownerId: 508,
      attendees: [508],
      crm_fields: ['C_12'],
    });
  });

  it('assunto vazio ou ausente não entra na descrição', async () => {
    const { service, created } = setup({ client: maria(null) });
    await service.book(caller, ask({ assunto: '   ' }));
    expect(created[0]!.description).toBe('Compromisso marcado pelo agente de IA.');
  });

  it('horário tomado entre a consulta e a confirmação: não cria e devolve até 3 alternativas próximas', async () => {
    const { service, created } = setup({
      client: maria(null),
      events: { 508: [event('busy', '2026-11-24T12:00:00Z', '2026-11-24T12:30:00Z')] },
    });
    const result = await service.book(caller, ask());

    expect(result.outcome).toBe('not_found');
    expect(result.body.erro).toBe('Esse horário não está mais disponível.');
    const alternatives = result.body.alternativas as Array<{ hora_inicio: string }>;
    expect(alternatives.map((slot) => slot.hora_inicio)).toEqual(['09:30', '10:00', '10:30']);
    expect(created).toEqual([]);
  });

  it('horário tomado e sem alternativa próxima: avisa que a equipe retorna', async () => {
    const { service } = setup({
      client: maria(null),
      events: { 508: [event('busy', '2026-11-24T12:00:00Z', '2026-11-24T15:00:00Z')] },
    });
    const result = await service.book(caller, ask());
    expect(result.body.alternativas).toEqual([]);
    expect(result.body.mensagem).toContain('a equipe vai retornar');
  });

  it.each([
    ['antes do expediente', '2026-11-24 08:00', 'fora do expediente'],
    ['depois do expediente', '2026-11-24 12:00', 'fora do expediente'],
    ['fora da grade de 30 minutos', '2026-11-24 09:15', 'fora do expediente'],
    ['compromisso que não cabe até o fim', '2026-11-24 11:45', 'fora do expediente'],
    ['dia que já passou', '2026-11-23 09:00', 'já passou'],
    ['depois da janela de busca', '2026-12-10 09:00', 'depois do período'],
    ['formato inválido', 'amanhã às 9', 'AAAA-MM-DD HH:mm'],
    ['hora inexistente', '2026-11-24 25:00', 'AAAA-MM-DD HH:mm'],
    ['sem informar', undefined, 'AAAA-MM-DD HH:mm'],
  ])('início fora das regras (%s): não cria e explica por quê', async (_caso, inicio, trecho) => {
    const { service, bitrix, crm } = setup({ client: maria(null) });
    const result = await service.book(caller, ask({ inicio }));
    expect(result.outcome).toBe('not_found');
    expect(String(result.body.erro)).toContain(trecho);
    expect(bitrix.call).not.toHaveBeenCalled();
    expect(crm.calendarClient).not.toHaveBeenCalled();
  });

  it('antes da antecedência mínima: não cria', async () => {
    const { service, created } = setup({
      client: maria(null),
      row: config({ minNoticeMinutes: 180 }), // agora 07:00; só a partir das 10:00
    });
    const result = await service.book(caller, ask());
    expect(String(result.body.erro)).toContain('antecedência mínima de 180 minutos');
    expect(created).toEqual([]);
  });

  it('referência de outro tenant ou adulterada: cliente não encontrado, nada é consultado nem criado', async () => {
    const { service, bitrix, created } = setup({ client: { found: false } });
    const result = await service.book(caller, ask({ cliente: 'de-outro-tenant' }));
    expect(result.outcome).toBe('not_found');
    expect(result.body.erro).toContain('Cliente não encontrado');
    expect(bitrix.call).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('chamada repetida: um só evento, e a segunda resposta confirma o agendamento já feito', async () => {
    const { service, created, bitrix } = setup({ client: maria(null) });
    const first = await service.book(caller, ask());
    bitrix.call.mockClear();
    const second = await service.book(caller, ask());

    expect(created).toHaveLength(1);
    expect(second.outcome).toBe('ok');
    expect(second.body).toEqual(first.body);
    // A repetição não consulta o portal nem recalcula a disponibilidade.
    expect(bitrix.call).not.toHaveBeenCalled();
  });

  it('duas chamadas iguais ao mesmo tempo: a segunda espera a primeira e recebe o mesmo agendamento', async () => {
    const { service, created } = setup({ client: maria(null) });
    const [a, b] = await Promise.all([service.book(caller, ask()), service.book(caller, ask())]);
    expect(created).toHaveLength(1);
    expect([a.outcome, b.outcome]).toEqual(['ok', 'ok']);
    expect(a.body).toEqual(b.body);
  });

  it('dois clientes querendo o mesmo horário ao mesmo tempo: só um agenda, o outro recebe alternativas', async () => {
    const { service, created, crm } = setup();
    crm.calendarClient
      .mockResolvedValueOnce({ ...maria(null), id: 12, name: 'Maria Souza' })
      .mockResolvedValueOnce({ ...maria(null), id: 13, name: 'João Alves' });
    const [a, b] = await Promise.all([
      service.book(caller, ask({ cliente: 'ref-a' })),
      service.book(caller, ask({ cliente: 'ref-b' })),
    ]);
    expect(created).toHaveLength(1);
    const outcomes = [a, b].map((r) => r.outcome).sort();
    expect(outcomes).toEqual(['not_found', 'ok']);
    const loser = [a, b].find((r) => r.outcome === 'not_found')!;
    expect(loser.body.erro).toBe('Esse horário não está mais disponível.');
  });

  it('falha do Bitrix24 ao criar: avisa, não guarda a chave de repetição e a nova tentativa cria uma vez', async () => {
    const { service, created, state, redis } = setup({
      client: maria(null),
      failAdd: new BitrixError('UNAVAILABLE', 'calendar.event.add', 'NETWORK_ERROR', 'fora'),
    });
    const failed = await service.book(caller, ask());
    expect(failed.outcome).toBe('unavailable');
    expect(failed.body.erro).toContain('Não foi possível agendar agora');
    expect(failed.body.erro).toContain('a equipe vai retornar');
    expect(created).toEqual([]);
    expect(keysOf(redis)).toEqual([]);

    state.failAdd = undefined;
    const retried = await service.book(caller, ask());
    expect(retried.outcome).toBe('ok');
    expect(created).toHaveLength(1);
    expect(keysOf(redis)).toHaveLength(1);
  });

  it('acesso negado na agenda do dono: responde sem permissão, sem criar em outra agenda nem repetir', async () => {
    const { service, portalCalls, redis, scope } = setup({
      client: maria(null),
      row: config({ mode: 'USER_LIST', userIds: [508, 418] }),
      failAdd: new BitrixError('API_ERROR', 'calendar.event.add', 'ACCESS_DENIED', 'sem acesso'),
    });
    const result = await service.book(caller, ask());
    expect(result.outcome).toBe('unavailable');
    expect(result.body.erro).toContain('não tem permissão para marcar na agenda de Ana Lima');
    expect(portalCalls('calendar.event.add')).toHaveLength(1);
    expect(keysOf(redis)).toEqual([]);
    expect(scope.markScopeMissing).not.toHaveBeenCalled();
  });

  it('sem o escopo calendar: avisa e marca o aviso do painel', async () => {
    const { service, scope, created } = setup({
      client: maria(null),
      failAdd: new BitrixError('API_ERROR', 'calendar.event.add', 'insufficient_scope', ''),
    });
    const result = await service.book(caller, ask());
    expect(result.outcome).toBe('unavailable');
    expect(result.body.erro).toContain('não está liberado');
    expect(scope.markScopeMissing).toHaveBeenCalledWith('tenant-a', 'agent-1');
    expect(created).toEqual([]);
  });

  it('criar com resposta sem número de evento é falha: não guarda a repetição', async () => {
    const { service, bitrix, redis } = setup({ client: maria(null) });
    const original = bitrix.call.getMockImplementation()!;
    bitrix.call.mockImplementation(async (installation, method, params) =>
      method === 'calendar.event.add' ? { result: 0 } : original(installation, method, params),
    );
    const result = await service.book(caller, ask());
    expect(result.outcome).toBe('unavailable');
    expect(keysOf(redis)).toEqual([]);
  });

  describe('de quem é a agenda', () => {
    it('lista de usuários: marca no primeiro livre da lista', async () => {
      const { service, created } = setup({
        client: maria(null),
        row: config({ mode: 'USER_LIST', userIds: [508, 418] }),
        events: { 508: [event('busy', '2026-11-24T12:00:00Z', '2026-11-24T12:30:00Z')] },
      });
      const result = await service.book(caller, ask());
      expect(created.map((c) => c.ownerId)).toEqual([418]);
      expect(result.body.com).toBe('Bruno Reis');
    });

    it('lista de usuários: com todos livres, vale o primeiro da ordem configurada', async () => {
      const { service, created } = setup({
        client: maria(null),
        row: config({ mode: 'USER_LIST', userIds: [418, 508] }),
      });
      await service.book(caller, ask());
      expect(created.map((c) => c.ownerId)).toEqual([418]);
    });

    it('responsável do cliente: marca na agenda dele', async () => {
      const { service, created } = setup({
        client: maria(418),
        row: config({ mode: 'CLIENT_OWNER', userIds: [] }),
      });
      const result = await service.book(caller, ask());
      expect(created.map((c) => c.ownerId)).toEqual([418]);
      expect(result.body.com).toBe('Bruno Reis');
    });

    it('responsável do cliente ausente: não há agenda e nada é criado', async () => {
      const { service, created, portalCalls } = setup({
        client: maria(null),
        row: config({ mode: 'CLIENT_OWNER', userIds: [] }),
      });
      const result = await service.book(caller, ask());
      expect(result.body.erro).toContain('Não há agenda');
      expect(created).toEqual([]);
      expect(portalCalls('calendar.accessibility.get')).toEqual([]);
    });
  });

  it('sem configuração de agenda: não consulta nem cria', async () => {
    const { service, bitrix } = setup({ row: null });
    const result = await service.book(caller, ask());
    expect(result.body.erro).toContain('não está configurada');
    expect(bitrix.call).not.toHaveBeenCalled();
  });

  it('a chave de repetição não guarda dados pessoais e expira em 15 minutos', async () => {
    const { service, redis } = setup({ client: maria(null) });
    await service.book(caller, ask());
    const [key] = keysOf(redis);
    expect(key).toMatch(/^calendar:booked:[0-9a-f]{64}$/);
    const entry = redis.store.get(key!)!;
    expect(entry.expiresAt! - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(entry.expiresAt! - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('as chamadas de agendamento somam no limite por agente das demais ferramentas', async () => {
    const { service, bitrix } = setup({ client: maria(null), ratePerMinute: 2 });
    await service.freeSlots(caller);
    await service.book(caller, ask());
    bitrix.call.mockClear();
    const third = await service.book(caller, ask({ inicio: '2026-11-24 10:00' }));
    expect(third.outcome).toBe('rate_limited');
    expect(bitrix.call).not.toHaveBeenCalled();
  });
});
