import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository, type NewAgent } from '../../src/modules/agents/agent.repository';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import { DomainError } from '../../src/shared/http/api-exception.filter';
import * as schema from '../../src/shared/database/schema/index';

const { agent, aiModel, tenant } = schema;

describe('repositório de agentes: isolamento entre tenants', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let agents: AgentRepository;
  let modelId: string;
  let tenantA: string;
  let tenantB: string;

  async function newTenant(): Promise<string> {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    return row!.id;
  }

  const values = (name = 'Bot'): NewAgent => ({
    gptmakerAgentId: `gm-${randomUUID()}`,
    name,
    type: 'SUPPORT',
    communicationType: 'NORMAL',
    modelId,
    webhookTokenHash: randomUUID(),
  });

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    agents = new AgentRepository(db);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await db.delete(agent);
    [tenantA, tenantB] = await Promise.all([newTenant(), newTenant()]);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('grava o agente no tenant do argumento, mesmo que os valores tragam outro', async () => {
    const forged = { ...values(), tenantId: tenantB } as NewAgent;
    const row = await agents.insert(tenantA, forged);
    expect(row.tenantId).toBe(tenantA);
  });

  it('lista só os agentes não removidos do próprio tenant', async () => {
    const first = await agents.insert(tenantA, values('Primeiro'));
    const second = await agents.insert(tenantA, values('Segundo'));
    const removed = await agents.insert(tenantA, values('Removido'));
    await agents.markDeleted(tenantA, removed.id);
    await agents.insert(tenantB, values('De outro tenant'));

    const listed = await agents.list(tenantA);
    expect(listed.map((row) => row.id)).toEqual([first.id, second.id]);
  });

  it('filtra a lista por status dentro do tenant', async () => {
    const active = await agents.insert(tenantA, values());
    const inactive = await agents.insert(tenantA, values());
    await agents.update(tenantA, inactive.id, { status: 'INACTIVE', inactiveReason: 'MANUAL' });
    await agents.insert(tenantB, { ...values(), status: 'INACTIVE' });

    expect((await agents.list(tenantA, { status: 'ACTIVE' })).map((row) => row.id)).toEqual([
      active.id,
    ]);
    expect((await agents.list(tenantA, { status: 'INACTIVE' })).map((row) => row.id)).toEqual([
      inactive.id,
    ]);
  });

  it('não encontra agente de outro tenant e responde 404 sem revelar que existe', async () => {
    const other = await agents.insert(tenantB, values());

    expect(await agents.findById(tenantA, other.id)).toBeUndefined();
    const error = await agents.getById(tenantA, other.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'AGENT_NOT_FOUND', status: 404 });
    // Mesma resposta de um id que não existe em lugar nenhum.
    const missing = await agents.getById(tenantA, randomUUID()).catch((e: unknown) => e);
    expect(missing).toMatchObject({ code: 'AGENT_NOT_FOUND', status: 404 });
  });

  it('trata id malformado como inexistente, sem erro do banco', async () => {
    expect(await agents.findById(tenantA, 'nao-e-uuid')).toBeUndefined();
    expect(await agents.update(tenantA, "1' or '1'='1", { name: 'x' })).toBeUndefined();
  });

  it('não altera nem remove agente de outro tenant', async () => {
    const other = await agents.insert(tenantB, values('Original'));

    expect(await agents.update(tenantA, other.id, { name: 'Invadido' })).toBeUndefined();
    expect(await agents.markDeleted(tenantA, other.id)).toBeUndefined();

    const [stored] = await db.select().from(agent).where(eq(agent.id, other.id));
    expect(stored).toMatchObject({ name: 'Original', status: 'ACTIVE', deletedAt: null });
  });

  it('remoção é soft delete e esconde o agente das leituras e alterações', async () => {
    const row = await agents.insert(tenantA, {
      ...values(),
      status: 'INACTIVE',
      inactiveReason: 'MANUAL',
    });

    const deleted = await agents.markDeleted(tenantA, row.id);
    expect(deleted).toMatchObject({ status: 'DELETED', inactiveReason: null });
    expect(deleted!.deletedAt).toBeInstanceOf(Date);

    expect(await agents.findById(tenantA, row.id)).toBeUndefined();
    expect(await agents.update(tenantA, row.id, { status: 'ACTIVE' })).toBeUndefined();
    const [stored] = await db.select().from(agent).where(eq(agent.id, row.id));
    expect(stored!.status).toBe('DELETED');
  });

  it('usa a transação do chamador', async () => {
    const row = await db.transaction(async (tx) => {
      const created = await agents.insert(tenantA, values(), tx);
      expect(await agents.findById(tenantA, created.id)).toBeUndefined(); // ainda não commitado
      return created;
    });
    expect(await agents.findById(tenantA, row.id)).toMatchObject({ id: row.id });
  });
});
