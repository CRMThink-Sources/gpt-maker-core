import { randomBytes, randomUUID } from 'node:crypto';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreditAlerts } from '../../src/modules/billing/credit-alerts';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import {
  UsageDebitConsumer,
  type UsageResponseEvent,
} from '../../src/modules/billing/usage-debit.consumer';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const { agent, aiModel, creditLedger, tenant } = schema;

/** Alertas de crédito têm teste próprio (credit-alerts). */
const noAlerts = { afterDebit: async () => null } as unknown as CreditAlerts;

// Débito por resposta entregue (spec credit-billing).
describe('débito das respostas', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let consumer: UsageDebitConsumer;
  let tenantId: string;
  let agentId: string;

  const event = (overrides: Partial<UsageResponseEvent> = {}): UsageResponseEvent => ({
    messageId: `${tenantId}:456:${Math.floor(Math.random() * 1_000_000)}`,
    tenantId,
    agentId,
    dialogId: 'chat9498',
    modelCode: 'GPT_5_MINI',
    replyMessageId: 5001,
    respondedAt: new Date().toISOString(),
    ...overrides,
  });
  const debitsOf = (messageId: string) =>
    db.select().from(creditLedger).where(eq(creditLedger.refId, messageId));

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    const redis = new Redis(redisContainer.getConnectionUrl());
    ledger = new LedgerService(db, redis);
    consumer = new UsageDebitConsumer(ledger, noAlerts, db);
    await db.insert(aiModel).values([
      { code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 2 },
      { code: 'CLAUDE_4_5_HAIKU', displayName: 'Haiku', creditsPerResponse: 4 },
    ]);
  });

  beforeEach(async () => {
    const code = randomBytes(4).toString('hex');
    const [owner] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    tenantId = owner!.id;
    const [model] = await db.select().from(aiModel).where(eq(aiModel.code, 'GPT_5_MINI'));
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId: model!.id,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    agentId = row!.id;
    await ledger.credit({
      tenantId,
      key: `seed:${tenantId}`,
      createdBy: 'teste',
      wallet: 'PLAN',
      type: 'GRANT',
      amount: 100,
    });
  });

  afterAll(async () => {
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('debita o custo vigente do modelo, guardando modelo, custo, agente e mensagem', async () => {
    const response = event();
    await expect(consumer.debit(response)).resolves.toBe('debited');
    expect(await debitsOf(response.messageId)).toMatchObject([
      {
        tenantId,
        wallet: 'PLAN',
        type: 'DEBIT',
        amount: -2,
        modelCode: 'GPT_5_MINI',
        unitCost: 2,
        agentId,
        refType: 'message',
        createdBy: 'system:usage',
      },
    ]);
    expect((await ledger.balance(tenantId)).total).toBe(98);
  });

  it('reprocessar a mesma mensagem não debita de novo', async () => {
    const response = event({ modelCode: 'CLAUDE_4_5_HAIKU' });
    await consumer.debit(response);
    await expect(consumer.debit(response)).resolves.toBe('duplicate');
    expect(await debitsOf(response.messageId)).toHaveLength(1);
    expect((await ledger.balance(tenantId)).total).toBe(96);
  });

  it('usa o custo do momento do processamento', async () => {
    await db.update(aiModel).set({ creditsPerResponse: 3 }).where(eq(aiModel.code, 'GPT_5_MINI'));
    try {
      const response = event();
      await consumer.debit(response);
      expect(await debitsOf(response.messageId)).toMatchObject([{ amount: -3, unitCost: 3 }]);
    } finally {
      await db.update(aiModel).set({ creditsPerResponse: 2 }).where(eq(aiModel.code, 'GPT_5_MINI'));
    }
  });

  it('modelo removido depois da resposta: usa o custo do removido', async () => {
    await db.insert(aiModel).values({
      code: 'GEMINI_OLD',
      displayName: 'Antigo',
      creditsPerResponse: 7,
      deletedAt: new Date(),
    });
    const response = event({ modelCode: 'GEMINI_OLD' });
    await consumer.debit(response);
    expect(await debitsOf(response.messageId)).toMatchObject([{ amount: -7 }]);
  });

  it('modelo fora do catálogo: sem débito', async () => {
    const response = event({ modelCode: 'NAO_EXISTE' });
    await expect(consumer.debit(response)).resolves.toBe('unknown-model');
    expect(await debitsOf(response.messageId)).toEqual([]);
  });

  it('evento fora do formato é descartado; falha no ledger volta para a fila', async () => {
    const dropped = await consumer.onMessage({ modelCode: 'x' } as UsageResponseEvent);
    expect(dropped).toBeInstanceOf(Nack);
    expect((dropped as Nack).requeue).toBe(false);

    const failing = new UsageDebitConsumer(
      {
        debit: async () => {
          throw new Error('banco fora');
        },
      } as unknown as LedgerService,
      noAlerts,
      db,
    );
    const requeued = await failing.onMessage(event());
    expect((requeued as Nack).requeue).toBe(true);
  });
});
