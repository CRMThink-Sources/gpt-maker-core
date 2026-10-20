import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import type { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerError } from '../../src/modules/gptmaker/gptmaker.errors';
import { ReconciliationService } from '../../src/modules/reconciliation/reconciliation.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const {
  agent,
  aiModel,
  creditLedger,
  reconciliationAdjustment,
  tenant,
  usageDailyReal,
  usageDailyUnlinked,
  workspaceSyncFinding,
} = schema;
const DAY = '2026-10-03';

// Reconciliação com o consumo real do GPTMaker (spec usage-reconciliation; tarefas 14.1, 14.2, 14.5).
describe('reconciliação diária', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let ledger: LedgerService;
  let service: ReconciliationService;
  let modelId: string;
  let tenantId: string;
  let row: { id: string; tenantId: string; gptmakerAgentId: string };
  /** Resposta do `credits-spent` por agente do GPTMaker; `Error` = falha. */
  const spent = new Map<string, Array<{ model: string; credits: number; day?: number }> | Error>();

  const balance = () => ledger.balance(tenantId);
  const adjustments = () =>
    db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.tenantId, tenantId), eq(creditLedger.type, 'ADJUSTMENT')));
  const record = async () =>
    (
      await db
        .select()
        .from(reconciliationAdjustment)
        .where(
          and(eq(reconciliationAdjustment.agentId, row.id), eq(reconciliationAdjustment.day, DAY)),
        )
    )[0];

  /** Débito com data fixa (o ledger aceita INSERT; só bloqueia UPDATE e DELETE). */
  async function debit(at: string, amount: number) {
    await db.insert(creditLedger).values({
      tenantId,
      wallet: 'PLAN',
      type: 'DEBIT',
      amount: -amount,
      agentId: row.id,
      modelCode: 'GPT_5_MINI',
      unitCost: amount,
      refType: 'message',
      refId: randomUUID(),
      idempotencyKey: randomUUID(),
      createdBy: 'teste',
      createdAt: new Date(at),
    });
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
    const gptmaker = {
      getCreditsSpent: async (id: string, period: { year: number; month: number; day: number }) => {
        const reply = spent.get(id) ?? [];
        if (reply instanceof Error) throw reply;
        const data = reply.map((item) => ({
          credits: item.credits,
          model: item.model,
          year: period.year,
          month: period.month,
          day: item.day ?? period.day,
        }));
        return { total: data.reduce((sum, item) => sum + item.credits, 0), data };
      },
    } as unknown as GptMakerClient;
    const env = {
      RECONCILIATION_TIMEZONE: 'America/Sao_Paulo',
      RECONCILIATION_TOLERANCE_CREDITS: 2,
      RECONCILIATION_REVIEW_THRESHOLD_CREDITS: 100,
      RECONCILIATION_LOOKBACK_DAYS: 3,
    } as Env;
    service = new ReconciliationService(gptmaker, ledger, env, db, redis);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await redis.flushall();
    spent.clear();
    const code = randomBytes(4).toString('hex');
    const [t] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    tenantId = t!.id;
    const [a] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    row = { id: a!.id, tenantId, gptmakerAgentId: a!.gptmakerAgentId };
    await ledger.credit({
      tenantId,
      key: `grant:${tenantId}`,
      createdBy: 't',
      wallet: 'PLAN',
      type: 'GRANT',
      amount: 1000,
    });
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  it('consumo real maior: cobra a diferença; reexecução não duplica', async () => {
    await debit('2026-10-03T15:00:00Z', 6);
    spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 10 }]);

    expect(await service.reconcileAgentDay(row, DAY)).toMatchObject({
      real: 10,
      debited: 6,
      status: 'APPLIED',
      posted: -4,
    });
    expect((await adjustments()).filter((a) => a.refType === 'reconciliation')).toHaveLength(1);
    expect(await record()).toMatchObject({ realTotal: 10, debitedTotal: 6, adjustedTotal: -4 });

    expect((await service.reconcileAgentDay(row, DAY)).posted).toBe(0);
    expect((await adjustments()).filter((a) => a.refType === 'reconciliation')).toHaveLength(1);
  });

  it('consumo real menor: devolve; dado atrasado ajusta só a diferença', async () => {
    await debit('2026-10-03T15:00:00Z', 10);
    spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 4 }]);
    expect((await service.reconcileAgentDay(row, DAY)).posted).toBe(6);

    // O GPTMaker registrou mais consumo do dia depois.
    spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 7 }]);
    expect((await service.reconcileAgentDay(row, DAY)).posted).toBe(-3);
    expect(await record()).toMatchObject({ adjustedTotal: 3 });
    const posted = (await adjustments()).filter((a) => a.refType === 'reconciliation');
    expect(posted.reduce((sum, a) => sum + a.amount, 0)).toBe(3);
  });

  it('consumo por modelo gravado; outro dia na resposta é ignorado', async () => {
    spent.set(row.gptmakerAgentId, [
      { model: 'GPT_5_MINI', credits: 3 },
      { model: 'CLAUDE_4_5_HAIKU', credits: 6 },
      { model: 'GPT_5_MINI', credits: 99, day: 2 },
    ]);
    expect((await service.reconcileAgentDay(row, DAY)).real).toBe(9);
    const rows = await db.select().from(usageDailyReal).where(eq(usageDailyReal.agentId, row.id));
    expect(rows.map((r) => [r.modelCode, r.credits]).sort()).toEqual([
      ['CLAUDE_4_5_HAIKU', 6],
      ['GPT_5_MINI', 3],
    ]);
  });

  it('dentro da tolerância: sem ajuste', async () => {
    await debit('2026-10-03T15:00:00Z', 5);
    spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 7 }]);
    expect(await service.reconcileAgentDay(row, DAY)).toMatchObject({
      status: 'WITHIN_TOLERANCE',
      posted: 0,
    });
  });

  it('diferença acima do limite: revisão, nada lançado', async () => {
    spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 500 }]);
    expect(await service.reconcileAgentDay(row, DAY)).toMatchObject({
      status: 'REVIEW',
      posted: 0,
    });
    expect((await balance()).plan).toBe(1000);
  });

  it('débito das 23:30 de Brasília (02:30 UTC do dia seguinte) conta no dia de Brasília', async () => {
    await debit('2026-10-04T02:30:00Z', 4);
    spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 4 }]);
    expect(await service.reconcileAgentDay(row, DAY)).toMatchObject({ debited: 4, posted: 0 });
  });

  it('falha na coleta: pendência, os demais seguem, e a retentativa conclui', async () => {
    spent.set(row.gptmakerAgentId, new GptMakerError('UNAVAILABLE', 'agent.credits-spent', 'fora'));
    const outcomes = await service.reconcileDays([DAY]);
    expect(outcomes.find((o) => o.agentId === row.id)).toBeUndefined();
    expect(await redis.smembers('reconciliation:pending')).toContain(`${row.id}|${DAY}`);

    spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 8 }]);
    const retried = await service.retryPending();
    expect(retried.find((o) => o.agentId === row.id)).toMatchObject({ real: 8, posted: -8 });
    expect(await redis.smembers('reconciliation:pending')).toEqual([]);
  });

  it('agente removido que sumiu do GPTMaker (400): sai da fila sem retentar para sempre', async () => {
    await db
      .update(agent)
      .set({ status: 'DELETED', deletedAt: new Date() })
      .where(eq(agent.id, row.id));
    spent.set(
      row.gptmakerAgentId,
      new GptMakerError('VALIDATION', 'agent.credits-spent', 'HTTP 400', { status: 400 }),
    );
    const outcomes = await service.reconcileDays([DAY]);
    expect(outcomes.find((o) => o.agentId === row.id)).toBeUndefined();
    expect(await redis.smembers('reconciliation:pending')).not.toContain(`${row.id}|${DAY}`);
  });

  it('pendência que não para de falhar sai da fila 14 dias depois da primeira falha', async () => {
    spent.set(row.gptmakerAgentId, new GptMakerError('UNAVAILABLE', 'agent.credits-spent', 'fora'));
    await service.reconcileDays([DAY]);
    expect(await redis.smembers('reconciliation:pending')).toContain(`${row.id}|${DAY}`);
    const fifteenDaysAgo = Date.now() - 15 * 86_400_000;
    await redis.hset('reconciliation:pending:since', `${row.id}|${DAY}`, String(fifteenDaysAgo));
    await service.retryPending();
    expect(await redis.smembers('reconciliation:pending')).toEqual([]);
    expect(await redis.hlen('reconciliation:pending:since')).toBe(0);
  });

  it('pendência antiga (como a deixada antes da correção) é limpa na retentativa', async () => {
    await db
      .update(agent)
      .set({ status: 'DELETED', deletedAt: new Date() })
      .where(eq(agent.id, row.id));
    await redis.sadd('reconciliation:pending', `${row.id}|${DAY}`);
    spent.set(
      row.gptmakerAgentId,
      new GptMakerError('VALIDATION', 'agent.credits-spent', 'HTTP 400', { status: 400 }),
    );
    await service.retryPending();
    expect(await redis.smembers('reconciliation:pending')).toEqual([]);
  });

  it('agente ativo com 400 continua pendente (400 é genérico no GPTMaker)', async () => {
    spent.set(
      row.gptmakerAgentId,
      new GptMakerError('VALIDATION', 'agent.credits-spent', 'HTTP 400', { status: 400 }),
    );
    await service.reconcileDays([DAY]);
    expect((await redis.smembers('reconciliation:pending')).some((e) => e.startsWith(row.id))).toBe(
      true,
    );
  });

  describe('revisão pelo operador', () => {
    const operator = randomUUID();

    it('aprovar lança a diferença inteira; reexecução com os mesmos totais mantém a decisão', async () => {
      await debit('2026-10-03T15:00:00Z', 20);
      spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 520 }]);
      expect((await service.reconcileAgentDay(row, DAY)).status).toBe('REVIEW');

      const approved = await service.resolveReview(row.id, DAY, 'approve', operator);
      expect(approved).toMatchObject({
        status: 'APPROVED',
        adjustedTotal: -500,
        reviewedBy: operator,
      });
      const [posted] = (await adjustments()).filter((a) => a.refType === 'reconciliation');
      expect(posted).toMatchObject({ amount: -500, createdBy: `operator:${operator}` });

      expect(await service.reconcileAgentDay(row, DAY)).toMatchObject({
        status: 'APPROVED',
        posted: 0,
      });
      // Consumo novo do dia: decide de novo, sem desfazer o que foi aprovado.
      spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 530 }]);
      expect(await service.reconcileAgentDay(row, DAY)).toMatchObject({
        status: 'APPLIED',
        posted: -10,
      });
      expect(await record()).toMatchObject({ adjustedTotal: -510, reviewedBy: null });
    });

    it('descartar não lança nada e a reexecução mantém; decisão repetida é recusada', async () => {
      spent.set(row.gptmakerAgentId, [{ model: 'GPT_5_MINI', credits: 500 }]);
      await service.reconcileAgentDay(row, DAY);
      expect(await service.resolveReview(row.id, DAY, 'dismiss', operator)).toMatchObject({
        status: 'DISMISSED',
        adjustedTotal: 0,
      });
      expect(await service.reconcileAgentDay(row, DAY)).toMatchObject({
        status: 'DISMISSED',
        posted: 0,
      });
      expect(await adjustments()).toEqual([]);
      const again = await service
        .resolveReview(row.id, DAY, 'approve', operator)
        .catch((e: { code: string }) => e.code);
      expect(again).toBe('REVIEW_NOT_FOUND');
    });
  });

  it('agente sem vínculo: consumo gravado à parte, sem ledger; falha fica pendente', async () => {
    const orphan = `gm-orfao-${randomUUID()}`;
    await db.insert(workspaceSyncFinding).values({
      kind: 'ORPHAN',
      gptmakerAgentId: orphan,
      details: { name: 'Teste' },
    });
    spent.set(orphan, new GptMakerError('UNAVAILABLE', 'agent.credits-spent', 'fora'));
    await service.reconcileDays([DAY]);
    expect(await redis.smembers('reconciliation:pending-unlinked')).toEqual([`${orphan}|${DAY}`]);

    spent.set(orphan, [{ model: 'GPT_5_MINI', credits: 12 }]);
    await service.retryPending();
    const rows = await db
      .select()
      .from(usageDailyUnlinked)
      .where(eq(usageDailyUnlinked.gptmakerAgentId, orphan));
    expect(rows).toMatchObject([{ day: DAY, modelCode: 'GPT_5_MINI', credits: 12 }]);
    expect(await redis.smembers('reconciliation:pending-unlinked')).toEqual([]);
  });
});
