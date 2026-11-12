import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/config/env';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { BitrixError } from '../../src/modules/bitrix';
import type { BitrixClient } from '../../src/modules/bitrix';
import { CalendarConfigController } from '../../src/modules/crm-tools/calendar-config.controller';
import { CalendarConfigRepository } from '../../src/modules/crm-tools/calendar-config.repository';
import { CalendarConfigService } from '../../src/modules/crm-tools/calendar-config.service';
import type { AppSession } from '../../src/modules/tenancy';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import type { Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agent, agentCalendarConfig, agentCrmAccess, aiModel, tenant } = schema;

/** Agenda do agente (spec agent-calendar-scheduling, "Configurar a agenda do agente"; tarefas 4.1 e 4.2). */
describe('configuração da agenda do agente', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: CalendarConfigService;
  let controller: CalendarConfigController;
  let modelId: string;
  /** Usuários ativos do portal simulado; qualquer outro id "não existe". */
  const activeUsers = new Set([508, 418, 12]);
  let bitrixDown = false;
  const userGet = vi.fn();

  const bitrix = {
    call: async (installationId: number, method: string, params: Record<string, unknown>) => {
      userGet(installationId, method, params);
      if (bitrixDown) throw new BitrixError('UNAVAILABLE', method, 'NETWORK_ERROR', 'fora');
      const ids = (params.FILTER as { ID: number[] }).ID;
      return { result: ids.filter((id) => activeUsers.has(id)).map((id) => ({ ID: String(id) })) };
    },
  } as unknown as BitrixClient;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    const database = db as unknown as Database;
    service = new CalendarConfigService(
      new AgentRepository(database),
      new CalendarConfigRepository(database),
      bitrix,
    );
    controller = new CalendarConfigController(service, { CRM_TOOLS_ENABLED: true } as Env);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  let installations = 1000;

  /** Tenant com um agente; `crm` define o estado do acesso ao CRM do agente (sem linha = nunca ativado). */
  async function setup(crm: 'CONNECTED' | 'DISABLED' | 'none' = 'CONNECTED') {
    // Cada tenant tem a própria instalação: prova que o `user.get` usa a da sessão.
    const installationId = ++installations;
    const code = randomBytes(4).toString('hex');
    const [owner] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner!.id,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Bot',
        type: 'SALE',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    if (crm !== 'none') {
      await db.insert(agentCrmAccess).values({
        agentId: row!.id,
        tenantId: owner!.id,
        status: crm,
      });
    }
    const portal = { tenantId: owner!.id, installationId };
    const session = {
      tenantId: owner!.id,
      installationId,
      canManage: true,
    } as unknown as AppSession;
    return { owner: owner!, agent: row!, portal, session };
  }

  const rowsOf = (agentId: string) =>
    db.select().from(agentCalendarConfig).where(eq(agentCalendarConfig.agentId, agentId));

  it('sem configuração: a agenda aparece como não configurada e informa o CRM', async () => {
    const t = await setup();
    await expect(service.view(t.portal.tenantId, t.agent.id)).resolves.toEqual({
      config: null,
      crmConnected: true,
      scopeMissing: false,
    });
    const none = await setup('none');
    await expect(service.view(none.portal.tenantId, none.agent.id)).resolves.toMatchObject({
      crmConnected: false,
    });
  });

  it('salva usuário fixo com os padrões, altera e remove', async () => {
    const t = await setup();
    const saved = await service.save(t.portal, t.agent.id, { mode: 'FIXED_USER', userIds: [508] });
    expect(saved).toMatchObject({
      config: {
        mode: 'FIXED_USER',
        userIds: [508],
        slotMinutes: 30,
        minNoticeMinutes: 60,
        maxDaysAhead: 7,
      },
      crmConnected: true,
    });

    const changed = await service.save(t.portal, t.agent.id, {
      mode: 'FIXED_USER',
      userIds: [418],
      slotMinutes: 45,
      maxDaysAhead: 14,
    });
    expect(changed.config).toMatchObject({ userIds: [418], slotMinutes: 45, maxDaysAhead: 14 });
    expect(await rowsOf(t.agent.id)).toHaveLength(1);

    const removed = await service.remove(t.portal.tenantId, t.agent.id);
    expect(removed.config).toBeNull();
    expect(await rowsOf(t.agent.id)).toEqual([]);
  });

  it('salva lista de usuários e responsável do cliente (este sem consultar o portal)', async () => {
    const t = await setup();
    userGet.mockClear();
    const list = await service.save(t.portal, t.agent.id, {
      mode: 'USER_LIST',
      userIds: [508, 418],
    });
    expect(list.config).toMatchObject({ mode: 'USER_LIST', userIds: [508, 418] });
    expect(userGet).toHaveBeenCalledTimes(1);
    expect(userGet.mock.calls[0]).toEqual([
      t.portal.installationId,
      'user.get',
      { FILTER: { ID: [508, 418], ACTIVE: true } },
    ]);

    userGet.mockClear();
    const owner = await service.save(t.portal, t.agent.id, { mode: 'CLIENT_OWNER' });
    expect(owner.config).toMatchObject({ mode: 'CLIENT_OWNER', userIds: [] });
    expect(userGet).not.toHaveBeenCalled();
  });

  it('recusa usuário inexistente ou inativo sem alterar o que estava salvo', async () => {
    const t = await setup();
    await service.save(t.portal, t.agent.id, { mode: 'FIXED_USER', userIds: [508] });

    await expect(
      service.save(t.portal, t.agent.id, { mode: 'USER_LIST', userIds: [508, 999, 777] }),
    ).rejects.toMatchObject({
      code: 'CALENDAR_USER_INVALID',
      status: 422,
      details: { userIds: [999, 777] },
    });
    const [kept] = await rowsOf(t.agent.id);
    expect(kept).toMatchObject({ mode: 'FIXED_USER', userIds: [508] });
  });

  it('portal fora do ar: responde 502 e não grava', async () => {
    const t = await setup();
    bitrixDown = true;
    try {
      await expect(
        service.save(t.portal, t.agent.id, { mode: 'FIXED_USER', userIds: [508] }),
      ).rejects.toMatchObject({ code: 'CALENDAR_PORTAL_UNAVAILABLE', status: 502 });
    } finally {
      bitrixDown = false;
    }
    expect(await rowsOf(t.agent.id)).toEqual([]);
  });

  it('exige o acesso ao CRM conectado', async () => {
    for (const state of ['DISABLED', 'none'] as const) {
      const t = await setup(state);
      await expect(
        service.save(t.portal, t.agent.id, { mode: 'CLIENT_OWNER' }),
      ).rejects.toMatchObject({ code: 'CALENDAR_CRM_REQUIRED', status: 409 });
      expect(await rowsOf(t.agent.id)).toEqual([]);
    }
  });

  it('recusa valores fora dos limites do contrato', async () => {
    const t = await setup();
    await expect(
      service.save(t.portal, t.agent.id, { mode: 'FIXED_USER', userIds: [508, 418] }),
    ).rejects.toThrow();
    await expect(
      service.save(t.portal, t.agent.id, { mode: 'FIXED_USER', userIds: [508], slotMinutes: 10 }),
    ).rejects.toThrow();
    expect(await rowsOf(t.agent.id)).toEqual([]);
  });

  it('o aviso de escopo ausente aparece e some quando uma chamada funciona', async () => {
    const t = await setup();
    await service.save(t.portal, t.agent.id, { mode: 'FIXED_USER', userIds: [508] });
    await service.markScopeMissing(t.portal.tenantId, t.agent.id);
    await expect(service.view(t.portal.tenantId, t.agent.id)).resolves.toMatchObject({
      scopeMissing: true,
    });
    // Salvar outra agenda não esconde o problema.
    const resaved = await service.save(t.portal, t.agent.id, {
      mode: 'FIXED_USER',
      userIds: [418],
    });
    expect(resaved.scopeMissing).toBe(true);
    await service.clearScopeMissing(t.portal.tenantId, t.agent.id);
    await expect(service.view(t.portal.tenantId, t.agent.id)).resolves.toMatchObject({
      scopeMissing: false,
    });
  });

  describe('isolamento entre tenants', () => {
    it('agente de outro tenant responde 404 e nada é lido nem gravado', async () => {
      const a = await setup();
      const b = await setup();
      await service.save(a.portal, a.agent.id, { mode: 'FIXED_USER', userIds: [508] });

      const notFound = { status: 404 };
      await expect(controller.view(b.session, a.agent.id)).rejects.toMatchObject(notFound);
      await expect(
        controller.save(b.session, a.agent.id, {
          mode: 'CLIENT_OWNER',
          userIds: [],
          slotMinutes: 30,
          minNoticeMinutes: 60,
          maxDaysAhead: 7,
        }),
      ).rejects.toMatchObject(notFound);
      await expect(controller.remove(b.session, a.agent.id)).rejects.toMatchObject(notFound);

      const [kept] = await rowsOf(a.agent.id);
      expect(kept).toMatchObject({ tenantId: a.owner.id, mode: 'FIXED_USER', userIds: [508] });
    });

    it('cada tenant vê só a configuração dos próprios agentes', async () => {
      const a = await setup();
      const b = await setup();
      await controller.save(a.session, a.agent.id, {
        mode: 'FIXED_USER',
        userIds: [508],
        slotMinutes: 30,
        minNoticeMinutes: 60,
        maxDaysAhead: 7,
      });
      await expect(controller.view(a.session, a.agent.id)).resolves.toMatchObject({
        config: { userIds: [508] },
      });
      await expect(controller.view(b.session, b.agent.id)).resolves.toMatchObject({ config: null });
    });

    it('o repositório não altera a linha de outro tenant, mesmo com o agente certo', async () => {
      const a = await setup();
      const b = await setup();
      const repository = new CalendarConfigRepository(db as unknown as Database);
      await repository.upsert(a.owner.id, a.agent.id, {
        mode: 'FIXED_USER',
        userIds: [508],
        slotMinutes: 30,
        minNoticeMinutes: 60,
        maxDaysAhead: 7,
      });
      await repository.remove(b.owner.id, a.agent.id);
      await repository.setScopeError(b.owner.id, a.agent.id, new Date());
      // Sobrescrever pelo tenant errado não atualiza a linha e não devolve nada.
      await expect(
        repository.upsert(b.owner.id, a.agent.id, {
          mode: 'USER_LIST',
          userIds: [418, 12],
          slotMinutes: 60,
          minNoticeMinutes: 0,
          maxDaysAhead: 30,
        }),
      ).resolves.toBeUndefined();
      const [row] = await rowsOf(a.agent.id);
      expect(row).toMatchObject({
        tenantId: a.owner.id,
        mode: 'FIXED_USER',
        userIds: [508],
        slotMinutes: 30,
        lastScopeErrorAt: null,
      });
    });

    it('a conferência dos usuários usa a instalação do tenant da sessão', async () => {
      const a = await setup();
      const b = await setup();
      expect(a.portal.installationId).not.toBe(b.portal.installationId);
      userGet.mockClear();
      await controller.save(b.session, b.agent.id, {
        mode: 'FIXED_USER',
        userIds: [508],
        slotMinutes: 30,
        minNoticeMinutes: 60,
        maxDaysAhead: 7,
      });
      expect(userGet.mock.calls.map(([installationId]) => installationId)).toEqual([
        b.portal.installationId,
      ]);
    });
  });

  it('só quem pode gerenciar altera a agenda: leitura é "read"; gravar e remover são "manage"', () => {
    const access = (handler: keyof CalendarConfigController) =>
      Reflect.getMetadata('app:access', CalendarConfigController.prototype[handler]);
    expect(access('view')).toBe('read');
    expect(access('save')).toBe('manage');
    expect(access('remove')).toBe('manage');
  });

  it('com o recurso desligado no ambiente, gravar e remover respondem 404', async () => {
    const t = await setup();
    const off = new CalendarConfigController(service, { CRM_TOOLS_ENABLED: false } as Env);
    expect(() =>
      off.save(t.session, t.agent.id, {
        mode: 'CLIENT_OWNER',
        userIds: [],
        slotMinutes: 30,
        minNoticeMinutes: 60,
        maxDaysAhead: 7,
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => off.remove(t.session, t.agent.id)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });
});
