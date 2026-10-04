import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { TenantsAdminService } from '../../src/modules/backoffice/tenants-admin.service';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import { TenantLifecycle } from '../../src/modules/tenancy/tenant-lifecycle';
import { TenantService, type Tenant } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import { DomainError } from '../../src/shared/http/api-exception.filter';
import * as schema from '../../src/shared/database/schema/index';

const { agent, aiModel, auditLog, creditLedger, messageLog, subscriptionState, tenant } = schema;

// Gestão de tenants no backoffice (spec admin-backoffice, "Gestão de tenants"; tarefa 15.4).
describe('backoffice: tenants', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let service: TenantsAdminService;
  let modelId: string;
  const accessChanged: Array<{ id: string; status: string }> = [];
  const actor = randomUUID();

  async function rejection(promise: Promise<unknown>): Promise<DomainError> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }

  async function newTenant(code = randomBytes(4).toString('hex')): Promise<Tenant> {
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    return row!;
  }

  async function newAgent(tenantId: string, status: 'ACTIVE' | 'INACTIVE' | 'DELETED' = 'ACTIVE') {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: `Agente ${status}`,
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        status,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return row!;
  }

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    ledger = new LedgerService(db, redis);
    const lifecycle = new TenantLifecycle();
    lifecycle.register({
      name: 'teste',
      onAccessChanged: async (row: Tenant) => {
        accessChanged.push({ id: row.id, status: row.status });
      },
    } as never);
    service = new TenantsAdminService(
      new TenantService(db),
      lifecycle,
      ledger,
      new AuditService(db),
      db,
    );
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(() => {
    accessChanged.length = 0;
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('lista com saldo, assinatura, agentes e busca; portal em uso primeiro', async () => {
    const quiet = await newTenant(`quieto${randomBytes(2).toString('hex')}`);
    const busy = await newTenant(`ativo${randomBytes(2).toString('hex')}`);
    const a = await newAgent(busy.id, 'ACTIVE');
    await newAgent(busy.id, 'INACTIVE');
    await newAgent(busy.id, 'DELETED');
    await ledger.credit({
      tenantId: busy.id,
      key: `g:${busy.id}`,
      createdBy: 't',
      wallet: 'PLAN',
      type: 'GRANT',
      amount: 5000,
    });
    await db.insert(subscriptionState).values({
      tenantId: busy.id,
      subscriptionId: '1',
      status: 'active',
      modality: 'stripe',
      planId: '11',
      version: 1,
    });
    await db.insert(messageLog).values({
      tenantId: busy.id,
      agentId: a.id,
      dialogId: 'chat1',
      bitrixMessageId: '1',
      direction: 'IN',
      status: 'RESPONDED',
    });

    const all = await service.list();
    const index = (id: string) => all.findIndex((t) => t.id === id);
    expect(index(busy.id)).toBeLessThan(index(quiet.id));
    expect(all.find((t) => t.id === busy.id)).toMatchObject({
      status: 'ACTIVE',
      subscription: { status: 'active', planId: '11', modality: 'stripe' },
      balance: { plan: 5000, total: 5000 },
      agents: { active: 1, total: 2 },
      lastMessageAt: expect.any(String),
    });
    expect(all.find((t) => t.id === quiet.id)).toMatchObject({
      subscription: null,
      agents: { active: 0, total: 0 },
      lastMessageAt: null,
    });

    expect((await service.list(busy.tenantCode)).map((t) => t.id)).toEqual([busy.id]);
    expect((await service.list('BITRIX24.COM')).length).toBeGreaterThanOrEqual(2);
  });

  it('detalhe: agentes não removidos, movimentações sem débitos e consumo de 7 dias', async () => {
    const row = await newTenant();
    const a = await newAgent(row.id);
    await newAgent(row.id, 'DELETED');
    await ledger.credit({
      tenantId: row.id,
      key: `g:${row.id}`,
      createdBy: 't',
      wallet: 'PLAN',
      type: 'GRANT',
      amount: 100,
    });
    await ledger.debit({
      tenantId: row.id,
      key: `m1:${row.id}`,
      createdBy: 't',
      amount: 3,
      modelCode: 'GPT_5_MINI',
      unitCost: 3,
      agentId: a.id,
      refType: 'message',
      refId: 'm1',
    });
    await ledger.debit({
      tenantId: row.id,
      key: `m2:${row.id}`,
      createdBy: 't',
      amount: 2,
      modelCode: 'GPT_5_MINI',
      unitCost: 2,
      agentId: a.id,
      refType: 'message',
      refId: 'm2',
    });

    const detail = await service.detail(row.id);
    expect(detail.agentList.map((x) => [x.name, x.model])).toEqual([
      ['Agente ACTIVE', 'GPT-5 Mini'],
    ]);
    expect(detail.entries.map((e) => [e.type, e.amount])).toEqual([['GRANT', 100]]);
    expect(detail.usage7d).toEqual({ responses: 2, credits: 5 });
    expect(detail.balance.total).toBe(95);

    expect((await rejection(service.detail(randomUUID()))).code).toBe('TENANT_NOT_FOUND');
  });

  it('suspender: status, motivo, aviso aos agentes e auditoria; repetir é conflito', async () => {
    const row = await newTenant();
    const detail = await service.suspend(row.id, 'Uso indevido reportado', actor);
    expect(detail).toMatchObject({
      status: 'SUSPENDED',
      suspendedReason: 'Uso indevido reportado',
    });
    expect(accessChanged).toEqual([{ id: row.id, status: 'SUSPENDED' }]);
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, row.id), eq(auditLog.action, 'tenant.suspended')));
    expect(audit).toMatchObject({ actorId: actor, reason: 'Uso indevido reportado' });

    expect((await rejection(service.suspend(row.id, 'de novo', actor))).code).toBe(
      'TENANT_STATUS_CONFLICT',
    );

    const back = await service.reactivate(row.id, actor);
    expect(back).toMatchObject({ status: 'ACTIVE', suspendedReason: null });
    expect(accessChanged.at(-1)).toEqual({ id: row.id, status: 'ACTIVE' });
    expect((await rejection(service.reactivate(row.id, actor))).code).toBe(
      'TENANT_STATUS_CONFLICT',
    );
  });

  it('portal desinstalado não é suspenso', async () => {
    const row = await newTenant();
    await db.update(tenant).set({ status: 'UNINSTALLED' }).where(eq(tenant.id, row.id));
    expect((await rejection(service.suspend(row.id, 'qualquer motivo', actor))).code).toBe(
      'TENANT_STATUS_CONFLICT',
    );
    expect(accessChanged).toEqual([]);
  });

  it('conceder créditos: TOPUP em EXTRA com autor e motivo; o mesmo pedido concede uma vez', async () => {
    const row = await newTenant();
    const input = { amount: 300, reason: 'Compensação por instabilidade', requestId: randomUUID() };
    expect((await service.grantCredits(row.id, input, actor)).balance).toMatchObject({
      extra: 300,
      total: 300,
    });
    expect((await service.grantCredits(row.id, input, actor)).balance.extra).toBe(300);

    const [entry] = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, row.id));
    expect(entry).toMatchObject({
      type: 'TOPUP',
      wallet: 'EXTRA',
      amount: 300,
      reason: 'Compensação por instabilidade',
      createdBy: `operator:${actor}`,
      refType: 'backoffice',
    });
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, row.id), eq(auditLog.action, 'tenant.credits_granted')));
    expect(audits).toHaveLength(1);
  });
});
