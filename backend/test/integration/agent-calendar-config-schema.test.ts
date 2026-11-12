import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agent, agentCalendarConfig, aiModel, tenant } = schema;

/** Migração `agent_calendar_config` (spec agent-calendar-scheduling, tarefa 3.2): padrões e restrições. */
describe('schema da agenda do agente', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  async function setup() {
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
    const [model] = await db
      .insert(aiModel)
      .values({ code: `M_${code}`, displayName: 'Modelo', creditsPerResponse: 1 })
      .returning();
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner!.id,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Bot',
        type: 'SALE',
        communicationType: 'NORMAL',
        modelId: model!.id,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return { owner: owner!, agent: row! };
  }

  const config = (
    base: { owner: { id: string }; agent: { id: string } },
    values: Partial<typeof agentCalendarConfig.$inferInsert> & {
      mode: 'FIXED_USER' | 'CLIENT_OWNER' | 'USER_LIST';
    },
  ) =>
    db
      .insert(agentCalendarConfig)
      .values({ agentId: base.agent.id, tenantId: base.owner.id, ...values });

  it('aplica a migração em banco limpo com os padrões esperados', async () => {
    const base = await setup();
    const [row] = await config(base, { mode: 'FIXED_USER', userIds: [12] }).returning();
    expect(row).toMatchObject({
      mode: 'FIXED_USER',
      userIds: [12],
      slotMinutes: 30,
      minNoticeMinutes: 60,
      maxDaysAhead: 7,
      lastScopeErrorAt: null,
    });
  });

  it('agentes existentes ficam sem agenda configurada', async () => {
    const base = await setup();
    const rows = await db.select().from(agentCalendarConfig);
    expect(rows.filter((row) => row.agentId === base.agent.id)).toEqual([]);
  });

  it('há no máximo uma agenda por agente', async () => {
    const base = await setup();
    await config(base, { mode: 'CLIENT_OWNER' });
    await expect(config(base, { mode: 'CLIENT_OWNER' })).rejects.toThrow();
  });

  it('o agente precisa existir e o tenant também', async () => {
    const base = await setup();
    await expect(
      db
        .insert(agentCalendarConfig)
        .values({ agentId: randomUUID(), tenantId: base.owner.id, mode: 'CLIENT_OWNER' }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(agentCalendarConfig)
        .values({ agentId: base.agent.id, tenantId: randomUUID(), mode: 'CLIENT_OWNER' }),
    ).rejects.toThrow();
  });

  it.each([
    ['usuário fixo com 2 usuários', { mode: 'FIXED_USER', userIds: [1, 2] }],
    ['usuário fixo sem usuário', { mode: 'FIXED_USER', userIds: [] }],
    ['responsável do cliente com usuário', { mode: 'CLIENT_OWNER', userIds: [1] }],
    ['lista vazia', { mode: 'USER_LIST', userIds: [] }],
    ['lista com 11 usuários', { mode: 'USER_LIST', userIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }],
    ['duração de 10 minutos', { mode: 'CLIENT_OWNER', slotMinutes: 10 }],
    ['duração de 250 minutos', { mode: 'CLIENT_OWNER', slotMinutes: 250 }],
    ['duração fora do múltiplo de 5', { mode: 'CLIENT_OWNER', slotMinutes: 32 }],
    ['antecedência negativa', { mode: 'CLIENT_OWNER', minNoticeMinutes: -1 }],
    ['antecedência acima de 24 h', { mode: 'CLIENT_OWNER', minNoticeMinutes: 1441 }],
    ['janela de 0 dia', { mode: 'CLIENT_OWNER', maxDaysAhead: 0 }],
    ['janela de 31 dias', { mode: 'CLIENT_OWNER', maxDaysAhead: 31 }],
  ] as const)('o banco recusa %s', async (_caso, values) => {
    const base = await setup();
    await expect(
      config(base, {
        ...values,
        userIds: [...((values as { userIds?: readonly number[] }).userIds ?? [])],
      }),
    ).rejects.toThrow();
  });

  it('aceita os limites: lista de 10 usuários, 15 e 240 minutos, 0 e 1440, 1 e 30 dias', async () => {
    const base = await setup();
    const [row] = await config(base, {
      mode: 'USER_LIST',
      userIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      slotMinutes: 240,
      minNoticeMinutes: 1440,
      maxDaysAhead: 30,
    }).returning();
    expect(row).toMatchObject({ slotMinutes: 240, minNoticeMinutes: 1440, maxDaysAhead: 30 });

    const other = await setup();
    await expect(
      config(other, {
        mode: 'CLIENT_OWNER',
        slotMinutes: 15,
        minNoticeMinutes: 0,
        maxDaysAhead: 1,
      }),
    ).resolves.toBeDefined();
  });
});
