import { randomBytes } from 'node:crypto';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/config/env';
import { CalendarToolsService } from '../../src/modules/crm-tools/calendar-tools.service';
import type { CalendarConfigRow } from '../../src/modules/crm-tools/calendar-config.repository';
import type { CrmCaller } from '../../src/modules/crm-tools/crm-access.guard';
import { CRM_GUIDANCE_DEFAULTS } from '../../src/modules/crm-tools/crm-guidance.defaults';
import type { CrmGuidanceService } from '../../src/modules/crm-tools/crm-guidance.service';
import type { Database } from '../../src/shared/database/database.module';

const NOW = Date.parse('2026-11-24T10:00:00Z'); // terça, 07:00 em São Paulo
/** Ids de cliente únicos entre as instâncias: dois clientes diferentes nunca viram "a mesma chamada". */
let nextClient = 100;
const SLOT = '2026-11-24 09:00';
const hours = {
  timezone: 'America/Sao_Paulo',
  days: {
    mon: [],
    tue: [{ start: '09:00', end: '12:00' }],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
};

const fakeDb = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Database;

/** Calendário do portal simulado, compartilhado pelas "instâncias da API" (a ocupação é a verdade). */
class FakePortal {
  readonly created: Array<Record<string, unknown>> = [];
  private readonly busy: Array<{ owner: number; from: number; to: number }> = [];

  call = vi.fn(async (_installation: number, method: string, params: Record<string, unknown>) => {
    if (method === 'user.get') {
      const ids = (params.FILTER as { ID: number[] }).ID;
      return { result: ids.map((id) => ({ ID: String(id), NAME: `Usuário ${id}` })) };
    }
    if (method === 'calendar.accessibility.get') {
      const users = params.users as number[];
      return {
        result: Object.fromEntries(
          users.map((id) => [
            String(id),
            this.busy
              .filter((event) => event.owner === id)
              .map((event) => ({
                ACCESSIBILITY: 'busy',
                // Formato do portal: hora de parede de São Paulo escrita como UTC (ver eventInterval).
                DATE_FROM_TS_UTC: String((event.from - 3 * 3600_000) / 1000),
                DATE_TO_TS_UTC: String((event.to - 3 * 3600_000) / 1000),
                '~USER_OFFSET_FROM': 0,
                TZ_FROM: 'America/Sao_Paulo',
              })),
          ]),
        ),
      };
    }
    if (method === 'calendar.event.add') {
      // Resposta lenta de rede: alarga a janela em que dois agendamentos se atropelariam sem lock.
      await new Promise((resolve) => setTimeout(resolve, 60));
      this.created.push(params);
      const toMs = (local: unknown) => Date.parse(`${String(local).replace(' ', 'T')}-03:00`);
      this.busy.push({
        owner: Number(params.ownerId),
        from: toMs(params.from),
        to: toMs(params.to),
      });
      return { result: 1000 + this.created.length };
    }
    throw new Error(`método inesperado: ${method}`);
  });
}

/** Agendamento do agente com Redis real (design D4, tarefa 6.3 de agent-calendar-scheduling). */
describe('agendamento simultâneo da mesma agenda', () => {
  let container: StartedRedisContainer;
  const clients: Redis[] = [];
  let portal: FakePortal;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
  });

  afterAll(async () => {
    clients.forEach((client) => client.disconnect());
    await container?.stop();
  });

  beforeEach(async () => {
    portal = new FakePortal();
    const flusher = new Redis(container.getConnectionUrl());
    await flusher.flushall();
    flusher.disconnect();
  });

  const caller = (agentId = 'agent-1'): CrmCaller => ({
    tenantId: 'tenant-a',
    agentId,
    installationId: 101,
  });

  const config = (agentId: string, userIds: number[]): CalendarConfigRow => ({
    agentId,
    tenantId: 'tenant-a',
    mode: userIds.length === 1 ? 'FIXED_USER' : 'USER_LIST',
    userIds,
    slotMinutes: 30,
    minNoticeMinutes: 0,
    maxDaysAhead: 1,
    lastScopeErrorAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  /** Uma "instância da API": serviço próprio e conexão própria com o mesmo Redis. */
  function instance(
    configs: Record<string, number[]>,
    extra: { portal?: FakePortal; clientId?: number } = {},
  ) {
    const redis = new Redis(container.getConnectionUrl());
    clients.push(redis);
    const service = new CalendarToolsService(
      {
        calendarClient: async () => ({
          found: true as const,
          type: 'contact' as const,
          id: extra.clientId ?? ++nextClient,
          name: `Cliente ${extra.clientId ?? nextClient}`,
          userId: null,
        }),
      } as never,
      (extra.portal ?? portal) as never,
      { markScopeMissing: async () => {}, clearScopeMissing: async () => {} } as never,
      {
        find: async (_tenant: string, agent: string) => config(agent, configs[agent] ?? [508]),
      } as never,
      { getById: async () => ({ businessHours: hours }) } as never,
      fakeDb,
      redis,
      { CRM_TOOLS_RATE_PER_MINUTE: 1000 } as Env,
      { current: async () => CRM_GUIDANCE_DEFAULTS } as CrmGuidanceService,
    );
    service.clock = () => NOW;
    return service;
  }

  const book = (
    service: CalendarToolsService,
    agentId = 'agent-1',
    cliente = randomBytes(4).toString('hex'),
  ) => service.book(caller(agentId), { cliente, inicio: SLOT });

  it('duas instâncias disputando o mesmo horário: só um evento é criado', async () => {
    const a = instance({});
    const b = instance({});
    const [first, second] = await Promise.all([book(a), book(b)]);

    expect(portal.created).toHaveLength(1);
    expect([first.outcome, second.outcome].sort()).toEqual(['not_found', 'ok']);
    const loser = [first, second].find((result) => result.outcome === 'not_found')!;
    expect(loser.body.erro).toBe('Esse horário não está mais disponível.');
  });

  it('dez chamadas ao mesmo tempo em duas instâncias: um evento e nove recusas', async () => {
    const a = instance({});
    const b = instance({});
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => book(i % 2 === 0 ? a : b)),
    );
    expect(portal.created).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'not_found')).toHaveLength(9);
  });

  it('a mesma chamada repetida ao mesmo tempo em duas instâncias: um evento e a mesma resposta', async () => {
    const a = instance({});
    const b = instance({});
    const same = { cliente: 'maria', inicio: SLOT };
    // Mesmo cliente nas duas: o stub devolve ids diferentes, então fixa o cliente.
    const fixed = (service: CalendarToolsService) => {
      (
        service as unknown as { crm: { calendarClient: () => Promise<unknown> } }
      ).crm.calendarClient = async () => ({
        found: true,
        type: 'contact',
        id: 12,
        name: 'Maria Souza',
        userId: null,
      });
      return service.book(caller(), same);
    };
    const [first, second] = await Promise.all([fixed(a), fixed(b)]);
    expect(portal.created).toHaveLength(1);
    expect([first.outcome, second.outcome]).toEqual(['ok', 'ok']);
    expect(first.body).toEqual(second.body);
  });

  it('dois agentes que dividem o mesmo usuário também se serializam', async () => {
    const a = instance({ 'agent-1': [508], 'agent-2': [508] });
    const b = instance({ 'agent-1': [508], 'agent-2': [508] });
    const [first, second] = await Promise.all([book(a, 'agent-1'), book(b, 'agent-2')]);
    expect(portal.created).toHaveLength(1);
    expect([first.outcome, second.outcome].sort()).toEqual(['not_found', 'ok']);
  });

  it('agendas diferentes no mesmo horário não se bloqueiam', async () => {
    const a = instance({ 'agent-1': [508], 'agent-2': [418] });
    const b = instance({ 'agent-1': [508], 'agent-2': [418] });
    const [first, second] = await Promise.all([book(a, 'agent-1'), book(b, 'agent-2')]);
    expect([first.outcome, second.outcome]).toEqual(['ok', 'ok']);
    expect(portal.created.map((event) => event.ownerId).sort()).toEqual([418, 508]);
  });

  it('lista de usuários: dois clientes no mesmo horário vão para usuários diferentes', async () => {
    const a = instance({ 'agent-1': [508, 418] });
    const b = instance({ 'agent-1': [508, 418] });
    const [first, second] = await Promise.all([book(a), book(b)]);
    expect([first.outcome, second.outcome]).toEqual(['ok', 'ok']);
    expect(portal.created.map((event) => event.ownerId).sort()).toEqual([418, 508]);
  });

  it('o lock é liberado: um horário livre depois do primeiro agendamento ainda pode ser marcado', async () => {
    const a = instance({});
    await book(a);
    const later = await a.book(caller(), { cliente: 'outro', inicio: '2026-11-24 10:00' });
    expect(later.outcome).toBe('ok');
    expect(portal.created).toHaveLength(2);
  });

  it('mesmo agente, usuário, cliente e horário em dois tenants: nem a repetição nem o lock são compartilhados', async () => {
    const portalB = new FakePortal();
    const a = instance({}, { clientId: 12 });
    const b = instance({}, { portal: portalB, clientId: 12 });
    const input = { cliente: 'ref', inicio: SLOT };
    const [first, second] = await Promise.all([
      a.book(caller(), input),
      b.book({ ...caller(), tenantId: 'tenant-b' }, input),
    ]);

    // Cada tenant agenda no próprio portal: o segundo não é tratado como repetição do primeiro.
    expect([first.outcome, second.outcome]).toEqual(['ok', 'ok']);
    expect(portal.created).toHaveLength(1);
    expect(portalB.created).toHaveLength(1);

    const probe = new Redis(container.getConnectionUrl());
    clients.push(probe);
    expect(await probe.keys('calendar:booked:*')).toHaveLength(2);
    // Todos os locks foram liberados.
    expect(await probe.keys('lock:*')).toEqual([]);
  });

  it('a repetição de um tenant não responde por outro: o segundo tenant ainda agenda o mesmo horário', async () => {
    const portalB = new FakePortal();
    const a = instance({}, { clientId: 12 });
    const b = instance({}, { portal: portalB, clientId: 12 });
    const input = { cliente: 'ref', inicio: SLOT };
    expect((await a.book(caller(), input)).outcome).toBe('ok');
    expect((await b.book({ ...caller(), tenantId: 'tenant-b' }, input)).outcome).toBe('ok');
    expect(portalB.created).toHaveLength(1);
  });
});
