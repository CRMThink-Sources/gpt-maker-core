import { randomBytes, randomUUID } from 'node:crypto';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { and, eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { Env } from '../../src/config/env';
import { balanceCacheKey, BalanceReader } from '../../src/modules/billing/balance.reader';
import type { ConversationService } from '../../src/modules/channel/conversation.service';
import { HumanAttendance, humanFlagKey } from '../../src/modules/channel/human-attendance';
import { InboundConsumer } from '../../src/modules/channel/inbound.consumer';
import { InboundGate } from '../../src/modules/channel/inbound-gate';
import type { InboundMessage } from '../../src/modules/channel/inbound-message';
import type { InboundRetry } from '../../src/modules/channel/inbound-retry';
import type { NoCreditHandler } from '../../src/modules/channel/no-credit.handler';
import type { ReplyPublisher } from '../../src/modules/channel/reply-publisher';
import { GptMakerError } from '../../src/modules/gptmaker/gptmaker.errors';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const { agent, aiModel, dialogState, messageLog, tenant, tenantBalance } = schema;

// Checagens do worker antes do GPTMaker (design D5): agente/portal ativos, humano e saldo.
describe('gate das mensagens do chatbot', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let gate: InboundGate;
  let modelId: string;

  /** Redis que sempre falha: leituras e escritas caem no banco. */
  const brokenRedis = {
    get: async () => {
      throw new Error('redis fora');
    },
    set: async () => {
      throw new Error('redis fora');
    },
  } as unknown as Redis;

  async function newTenant(status: (typeof tenant.$inferInsert)['status'] = 'ACTIVE') {
    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: `m-${code}`,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
        status,
      })
      .returning();
    return row!;
  }

  async function newAgent(tenantId: string, status: (typeof agent.$inferInsert)['status']) {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
        status,
      })
      .returning();
    return row!;
  }

  async function setBalance(tenantId: string, trial: number, plan: number, extra: number) {
    await db
      .insert(tenantBalance)
      .values({ tenantId, trialBalance: trial, planBalance: plan, extraBalance: extra })
      .onConflictDoUpdate({
        target: tenantBalance.tenantId,
        set: { trialBalance: trial, planBalance: plan, extraBalance: extra },
      });
  }

  /** Tenant ativo com agente ativo e saldo; cada teste muda o que precisa. */
  async function scenario(
    options: {
      tenantStatus?: (typeof tenant.$inferInsert)['status'];
      agentStatus?: (typeof agent.$inferInsert)['status'];
      balance?: [number, number, number] | null;
    } = {},
  ) {
    const owner = await newTenant(options.tenantStatus);
    const bot = await newAgent(owner.id, options.agentStatus ?? 'ACTIVE');
    if (options.balance !== null) await setBalance(owner.id, ...(options.balance ?? [0, 10, 0]));
    const message: InboundMessage = {
      tenantId: owner.id,
      agentId: bot.id,
      botId: 456,
      dialogId: `chat${Math.floor(Math.random() * 1_000_000)}`,
      chatId: 5,
      messageId: Math.floor(Math.random() * 1_000_000),
      text: 'Oi',
      params: null,
      user: { id: 12, name: 'Maria', connector: true },
      chat: {
        type: 'openChannel',
        entityType: 'LINES',
        entityId: '',
        entityData1: '',
        entityData2: '',
        entityData3: '',
      },
      language: 'br',
      receivedAt: new Date().toISOString(),
    };
    return { owner, bot, message };
  }

  async function startHuman(message: InboundMessage) {
    await db.insert(dialogState).values({
      tenantId: message.tenantId,
      dialogId: message.dialogId,
      agentId: message.agentId,
      humanActive: true,
      humanStartedAt: new Date(),
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
    gate = new InboundGate(db, new HumanAttendance(db, redis), new BalanceReader(db, redis));
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await redis?.quit();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  describe('decisão', () => {
    it('agente e portal ativos, sem humano e com saldo ⇒ encaminha', async () => {
      const { owner, bot, message } = await scenario();
      await expect(gate.check(message)).resolves.toEqual({
        kind: 'forward',
        target: {
          gptmakerAgentId: bot.gptmakerAgentId,
          installationId: Number(owner.installationId),
          modelCode: 'GPT_5_MINI',
        },
      });
    });

    it.each(['INACTIVE', 'DELETED', 'OUT_OF_SYNC'] as const)(
      'agente %s ⇒ descarta',
      async (status) => {
        const { message } = await scenario({ agentStatus: status });
        await expect(gate.check(message)).resolves.toEqual({
          kind: 'skip-inactive',
          reason: 'agent',
        });
      },
    );

    it('agente de outro tenant ⇒ descarta', async () => {
      const { message } = await scenario();
      const other = await newTenant();
      await expect(gate.check({ ...message, tenantId: other.id })).resolves.toEqual({
        kind: 'skip-inactive',
        reason: 'agent',
      });
    });

    it.each(['AUTH_ERROR', 'SUSPENDED', 'UNINSTALLED'] as const)(
      'portal %s ⇒ descarta',
      async (status) => {
        const { message } = await scenario({ tenantStatus: status });
        await expect(gate.check(message)).resolves.toEqual({
          kind: 'skip-inactive',
          reason: 'tenant',
        });
      },
    );

    it('operador atendendo ⇒ descarta antes de olhar o saldo', async () => {
      const { message } = await scenario({ balance: [0, 0, 0] });
      await startHuman(message);
      await expect(gate.check(message)).resolves.toEqual({ kind: 'skip-human' });
    });

    it.each([
      ['zerado', [0, 0, 0]],
      ['negativo', [0, -3, 2]],
    ] as const)('saldo %s ⇒ sem crédito', async (_name, balance) => {
      const { message } = await scenario({ balance: [...balance] });
      await expect(gate.check(message)).resolves.toMatchObject({ kind: 'no-credit' });
    });

    it('sem linha de saldo ⇒ sem crédito', async () => {
      const { owner, message } = await scenario({ balance: null });
      await expect(gate.check(message)).resolves.toEqual({
        kind: 'no-credit',
        balance: 0,
        installationId: Number(owner.installationId),
      });
    });

    it('soma as três carteiras', async () => {
      const { message } = await scenario({ balance: [0, -5, 6] });
      await expect(gate.check(message)).resolves.toMatchObject({ kind: 'forward' });
    });
  });

  describe('saldo (Redis com reserva no banco)', () => {
    it('lê do banco e espelha no Redis; depois usa o espelho', async () => {
      const { owner } = await scenario({ balance: [5, 3, 2] });
      const reader = new BalanceReader(db, redis);
      await expect(reader.total(owner.id)).resolves.toBe(10);
      expect(await redis.get(balanceCacheKey(owner.id))).toBe('10');
      expect(await redis.ttl(balanceCacheKey(owner.id))).toBeGreaterThan(0);

      // O ledger (11.1) grava o espelho; a leitura confia nele.
      await redis.set(balanceCacheKey(owner.id), '0');
      await expect(reader.total(owner.id)).resolves.toBe(0);
    });

    it('ignora espelho inválido', async () => {
      const { owner } = await scenario({ balance: [0, 7, 0] });
      await redis.set(balanceCacheKey(owner.id), 'abc');
      await expect(new BalanceReader(db, redis).total(owner.id)).resolves.toBe(7);
    });

    it('com o Redis fora, lê do banco', async () => {
      const { owner } = await scenario({ balance: [0, 4, 0] });
      await expect(new BalanceReader(db, brokenRedis).total(owner.id)).resolves.toBe(4);
    });
  });

  describe('atendimento humano (Redis com reserva no banco)', () => {
    it('lê do banco, guarda a flag e usa a flag depois', async () => {
      const { message } = await scenario();
      await startHuman(message);
      const human = new HumanAttendance(db, redis);
      await expect(human.isActive(message.tenantId, message.dialogId)).resolves.toBe(true);
      expect(await redis.get(humanFlagKey(message.tenantId, message.dialogId))).toBe('1');

      // Encerramento (9.8) regrava a flag.
      await redis.set(humanFlagKey(message.tenantId, message.dialogId), '0');
      await expect(human.isActive(message.tenantId, message.dialogId)).resolves.toBe(false);
    });

    it('diálogo sem estado ⇒ sem humano, também guardado', async () => {
      const { message } = await scenario();
      const human = new HumanAttendance(db, redis);
      await expect(human.isActive(message.tenantId, message.dialogId)).resolves.toBe(false);
      expect(await redis.get(humanFlagKey(message.tenantId, message.dialogId))).toBe('0');
    });

    it('com o Redis fora, lê do banco', async () => {
      const { message } = await scenario();
      await startHuman(message);
      await expect(
        new HumanAttendance(db, brokenRedis).isActive(message.tenantId, message.dialogId),
      ).resolves.toBe(true);
    });
  });

  describe('worker', () => {
    const retried: Array<{ attempt: number; error: unknown }> = [];
    const deadLettered: Array<{ attempt: number; error: unknown }> = [];
    let publishFails = false;
    const retry = {
      retryOrDeadLetter: async (_message: InboundMessage, attempt: number, error: unknown) => {
        if (publishFails) throw new Error('rabbit fora');
        retried.push({ attempt, error });
        return { kind: 'retry', attempt: attempt + 1, delayMs: 10 };
      },
      deadLetter: async (_message: InboundMessage, attempt: number, error: unknown) => {
        deadLettered.push({ attempt, error });
        return { kind: 'dead-letter', attempts: attempt + 1 };
      },
    } as unknown as InboundRetry;
    const env = { APP_ROLE: 'api', CHANNEL_INBOUND_PARTITIONS: 1 } as Env;
    const asked: InboundMessage[] = [];
    const conversation = {
      ask: async (message: InboundMessage) => {
        asked.push(message);
        return { message: 'Olá!' };
      },
    } as unknown as ConversationService;
    const published: InboundMessage[] = [];
    const replies = {
      publish: async (message: InboundMessage) => {
        published.push(message);
        return 'sent';
      },
    } as unknown as ReplyPublisher;
    const blocked: InboundMessage[] = [];
    const noCredit = {
      handle: async (message: InboundMessage) => {
        blocked.push(message);
        return 'notified';
      },
    } as unknown as NoCreditHandler;
    const consumerWith = (g: InboundGate) =>
      new InboundConsumer({} as AmqpConnection, g, retry, conversation, replies, noCredit, db, env);

    const logOf = async (message: InboundMessage) =>
      db
        .select()
        .from(messageLog)
        .where(
          and(
            eq(messageLog.tenantId, message.tenantId),
            eq(messageLog.bitrixMessageId, String(message.messageId)),
          ),
        );

    beforeEach(() => {
      retried.length = 0;
      deadLettered.length = 0;
      asked.length = 0;
      published.length = 0;
      blocked.length = 0;
      publishFails = false;
    });

    it('registra as descartadas no message_log, uma vez por mensagem', async () => {
      const { message } = await scenario({ agentStatus: 'INACTIVE' });
      const consumer = consumerWith(gate);
      await consumer.process(message, 0);
      await consumer.process(message, 0);
      expect(await logOf(message)).toMatchObject([
        { direction: 'IN', status: 'SKIPPED_INACTIVE', attempts: 1, dialogId: message.dialogId },
      ]);
    });

    it('atendimento humano vira SKIPPED_HUMAN', async () => {
      const { message } = await scenario();
      await startHuman(message);
      await consumerWith(gate).process(message, 0);
      expect(await logOf(message)).toMatchObject([{ status: 'SKIPPED_HUMAN' }]);
    });

    it('liberada vai ao GPTMaker; sem saldo vai ao aviso de falta de créditos', async () => {
      const ok = await scenario();
      const broke = await scenario({ balance: [0, 0, 0] });
      await consumerWith(gate).process(ok.message, 0);
      await consumerWith(gate).process(broke.message, 0);
      expect(asked.map((m) => m.messageId)).toEqual([ok.message.messageId]);
      expect(published.map((m) => m.messageId)).toEqual([ok.message.messageId]);
      expect(blocked.map((m) => m.messageId)).toEqual([broke.message.messageId]);
    });

    it('falha no gate vai para a retentativa com a tentativa atual', async () => {
      const { message } = await scenario();
      const failing = { check: async () => Promise.reject(new Error('banco fora')) };
      await expect(
        consumerWith(failing as unknown as InboundGate).process(message, 2),
      ).resolves.toBeUndefined();
      expect(retried).toMatchObject([{ attempt: 2, error: { message: 'banco fora' } }]);
    });

    it('erro permanente do GPTMaker vai direto para a DLQ', async () => {
      const { message } = await scenario();
      const rejecting = {
        ask: async () => {
          throw new GptMakerError('VALIDATION', 'agent.conversation', 'prompt inválido');
        },
      } as unknown as ConversationService;
      await new InboundConsumer(
        {} as AmqpConnection,
        gate,
        retry,
        rejecting,
        replies,
        noCredit,
        db,
        env,
      ).process(message, 0);
      expect(retried).toEqual([]);
      expect(deadLettered).toMatchObject([{ attempt: 0, error: { kind: 'VALIDATION' } }]);
    });

    it('sem conseguir reagendar, devolve à fila', async () => {
      const { message } = await scenario();
      publishFails = true;
      const failing = { check: async () => Promise.reject(new Error('banco fora')) };
      const result = await consumerWith(failing as unknown as InboundGate).process(message, 0);
      expect(result).toBeInstanceOf(Nack);
      expect((result as Nack).requeue).toBe(true);
    });

    it('mensagem fora do formato é descartada sem reenfileirar', async () => {
      const result = await consumerWith(gate).onMessage({ text: 'oi' } as never);
      expect(result).toBeInstanceOf(Nack);
      expect((result as Nack).requeue).toBe(false);
    });

    it('lê a tentativa do cabeçalho da entrega', async () => {
      const { message } = await scenario();
      const failing = { check: async () => Promise.reject(new Error('x')) };
      await consumerWith(failing as unknown as InboundGate).onMessage(message, { 'x-attempt': 1 });
      expect(retried).toMatchObject([{ attempt: 1 }]);
    });
  });
});
