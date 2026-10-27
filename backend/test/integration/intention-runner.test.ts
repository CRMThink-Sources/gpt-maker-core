import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PendingHandoffs } from '../../src/modules/channel/pending-handoff';
import { IntentionRunner } from '../../src/modules/intentions/intention-runner';
import type { ActionContext } from '../../src/modules/triggers/actions/action-executor';
import { ActionError } from '../../src/modules/triggers/actions/action-error';
import type { TriggerActionExecutor } from '../../src/modules/triggers';
import { configureFieldCipher, fieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agent, agentIntention, aiModel, intentionExecution, tenant } = schema;
const TOKEN = 'token-da-intencao-1234567890';

// Intenção "Ação no Bitrix24" chamada pelo GPTMaker (spec agent-intentions; tarefa 17.8).
describe('intenção com ações no Bitrix24', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let runner: IntentionRunner;
  let tenantId: string;
  let intentionId: string;
  let calls: Array<{ type: string; context: ActionContext }>;
  let failOn: string | null;

  const body = (extra: Record<string, unknown> = {}) => ({
    fields: { nome: 'Maria', pedido: '123' },
    chat: `public-api-gm-x-${tenantId}:chat9498`,
    contact: { name: 'Maria Silva', phone: '{{contact_phone}}' },
    ...extra,
  });

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const executor = {
      execute: async (action: { type: string }, context: ActionContext) => {
        calls.push({ type: action.type, context });
        if (failOn === action.type)
          throw new ActionError('crm.timeline.comment.add recusou', { transient: false });
        return action.type === 'CREATE_LEAD' ? { leadId: 77 } : { commentId: 5 };
      },
    } as unknown as TriggerActionExecutor;
    runner = new IntentionRunner(executor, new PendingHandoffs(redis), db, redis);
  });

  beforeEach(async () => {
    calls = [];
    failOn = null;
    await redis.flushall();
    const code = randomBytes(3).toString('hex');
    const [t] = await db
      .insert(tenant)
      .values({ installationId: '42', memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .onConflictDoNothing()
      .returning();
    tenantId =
      t?.id ?? (await db.select().from(tenant).where(eq(tenant.installationId, '42')))[0]!.id;
    await db.update(tenant).set({ status: 'ACTIVE' }).where(eq(tenant.id, tenantId));
    const [model] = await db
      .insert(aiModel)
      .values({ code: `M_${code}`, displayName: 'M', creditsPerResponse: 1 })
      .returning();
    const [a] = await db
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
    const [i] = await db
      .insert(agentIntention)
      .values({
        tenantId,
        agentId: a!.id,
        kind: 'BITRIX',
        name: 'Registrar pedido',
        whenToUse: 'Quando o cliente fizer um pedido',
        httpMethod: 'POST',
        url: '',
        fields: [
          { name: 'Nome', jsonName: 'nome', description: 'nome', type: 'STRING', required: true },
          { name: 'Pedido', jsonName: 'pedido', description: 'n', type: 'STRING', required: true },
        ],
        actions: [
          { type: 'CREATE_LEAD', config: { fields: { TITLE: 'Pedido {{fields.pedido}}' } } },
          { type: 'TIMELINE_COMMENT', config: { text: '{{fields.nome}} pediu {{fields.pedido}}' } },
        ],
        tokenEncrypted: fieldCipher().encrypt(TOKEN),
      })
      .returning();
    intentionId = i!.id;
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  const executions = () =>
    db.select().from(intentionExecution).where(eq(intentionExecution.intentionId, intentionId));

  it('token errado ou ausente: não executa nada', async () => {
    expect(await runner.run(intentionId, 'outro', body())).toEqual({ kind: 'unauthorized' });
    expect(await runner.run(intentionId, undefined, body())).toEqual({ kind: 'unauthorized' });
    expect(await runner.run('nao-e-uuid', TOKEN, body())).toEqual({ kind: 'unauthorized' });
    expect(calls).toEqual([]);
  });

  it('executa as ações em ordem com os campos, o diálogo do chat e o contato preenchido', async () => {
    const outcome = await runner.run(intentionId, TOKEN, body());
    expect(outcome).toEqual({
      kind: 'reply',
      reply: {
        ok: true,
        message: 'Feito: lead criado; comentário registrado no CRM.',
        results: [
          { type: 'CREATE_LEAD', ok: true, result: { leadId: 77 } },
          { type: 'TIMELINE_COMMENT', ok: true, result: { commentId: 5 } },
        ],
      },
    });
    expect(calls.map((c) => c.type)).toEqual(['CREATE_LEAD', 'TIMELINE_COMMENT']);
    const { context } = calls[0]!;
    expect(context).toMatchObject({ installationId: 42, dialogId: 'chat9498' });
    expect(context.template).toMatchObject({
      fields: { nome: 'Maria', pedido: '123' },
      // Variável não preenchida pelo GPTMaker vira vazio.
      contact: { name: 'Maria Silva', phone: null },
      dialog: { id: 'chat9498' },
    });
    expect(await executions()).toEqual([
      expect.objectContaining({ status: 'SUCCESS', dialogId: 'chat9498' }),
    ]);
  });

  it('conversa de teste do app: ações simuladas, nada executado no portal', async () => {
    const outcome = await runner.run(
      intentionId,
      TOKEN,
      body({ chat: `public-api-gm-x-${tenantId}:t-0a1b2c3d4e` }),
    );
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: {
        ok: true,
        message: expect.stringContaining('Seriam: lead criado; comentário registrado no CRM'),
      },
    });
    expect(calls).toEqual([]);
    expect(await executions()).toEqual([expect.objectContaining({ status: 'SUCCESS' })]);
  });

  it('chamada repetida devolve o mesmo resultado sem executar de novo', async () => {
    await runner.run(intentionId, TOKEN, body());
    const again = await runner.run(intentionId, TOKEN, body());
    expect(again).toMatchObject({ kind: 'reply', reply: { ok: true } });
    expect(calls).toHaveLength(2);
  });

  it('intenção editada: a mesma chamada executa de novo', async () => {
    await runner.run(intentionId, TOKEN, body());
    await db
      .update(agentIntention)
      .set({ updatedAt: new Date(Date.now() + 1000) })
      .where(eq(agentIntention.id, intentionId));
    await runner.run(intentionId, TOKEN, body());
    expect(calls).toHaveLength(4);
    expect(await executions()).toHaveLength(2);
  });

  it('ação que falha: resultado parcial e texto para o agente; sem chat, diálogo nulo', async () => {
    failOn = 'TIMELINE_COMMENT';
    const outcome = await runner.run(intentionId, TOKEN, body({ chat: '{{chat_id}}' }));
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: {
        ok: false,
        message: expect.stringContaining('Feito em parte: lead criado'),
      },
    });
    expect(calls[0]!.context.dialogId).toBeNull();
    expect(await executions()).toEqual([expect.objectContaining({ status: 'FAILED' })]);
  });

  it('transferência: agendada para depois da resposta; sem conversa identificada, falha', async () => {
    await db
      .update(agentIntention)
      .set({
        actions: [
          { type: 'CREATE_LEAD', config: { fields: { TITLE: 'Pedido {{fields.pedido}}' } } },
          { type: 'TRANSFER_TO_HUMAN', config: { target: 'USER', userId: 9 } },
        ],
      })
      .where(eq(agentIntention.id, intentionId));
    const outcome = await runner.run(intentionId, TOKEN, body());
    expect(outcome).toMatchObject({
      reply: { ok: true, message: expect.stringContaining('atendido por uma pessoa') },
    });
    expect(calls.map((c) => c.type)).toEqual(['CREATE_LEAD']);
    expect(await new PendingHandoffs(redis).peek(tenantId, 'chat9498')).toMatchObject({
      userId: 9,
    });

    const noChat = await runner.run(
      intentionId,
      TOKEN,
      body({ chat: '{{chat_id}}', fields: { nome: 'Outro', pedido: '9' } }),
    );
    expect(noChat).toMatchObject({
      reply: { ok: false, results: [{ ok: true }, { type: 'TRANSFER_TO_HUMAN', ok: false }] },
    });
  });

  it('intenção desativada ou portal suspenso: recusa sem executar', async () => {
    await db
      .update(agentIntention)
      .set({ active: false })
      .where(eq(agentIntention.id, intentionId));
    expect(await runner.run(intentionId, TOKEN, body())).toMatchObject({
      reply: { ok: false, message: expect.stringContaining('desativada') },
    });
    await db.update(agentIntention).set({ active: true }).where(eq(agentIntention.id, intentionId));
    await db.update(tenant).set({ status: 'SUSPENDED' }).where(eq(tenant.id, tenantId));
    expect(await runner.run(intentionId, TOKEN, body())).toMatchObject({
      reply: { ok: false, message: expect.stringContaining('CRM') },
    });
    expect(calls).toEqual([]);
    expect((await executions()).map((e) => e.status)).toEqual(['REJECTED', 'REJECTED']);
  });
});
