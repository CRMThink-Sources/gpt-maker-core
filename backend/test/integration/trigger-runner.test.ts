import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { ActionError } from '../../src/modules/triggers/actions/action-error';
import type {
  ActionContext,
  ExecutableAction,
  TriggerActionExecutor,
} from '../../src/modules/triggers/actions/action-executor';
import { TRIGGER_MAX_ATTEMPTS, TriggerRunner } from '../../src/modules/triggers/trigger-runner';
import { TriggerService } from '../../src/modules/triggers/trigger.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { agent, agentEvent, aiModel, tenant, trigger, triggerExecution } = schema;
const MINUTE = 60_000;

// Execução assíncrona e auditável dos gatilhos (spec agent-triggers).
describe('execução dos gatilhos', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let runner: TriggerRunner;
  let triggers: TriggerService;
  let tenantId: string;
  let installationId: number;
  let agentId: string;
  let modelId: string;

  /** Ações simuladas: cada chamada consome a próxima resposta do roteiro (padrão: sucesso). */
  const calls: Array<{ action: ExecutableAction; context: ActionContext }> = [];
  let script: Array<'ok' | 'transient' | 'permanent'> = [];
  const executor = {
    execute: async (action: ExecutableAction, context: ActionContext) => {
      calls.push({ action, context });
      const next = script.shift() ?? 'ok';
      if (next === 'transient') throw new ActionError('Bitrix fora do ar', { transient: true });
      if (next === 'permanent') throw new ActionError('ACCESS_DENIED', { transient: false });
      return { ok: true, type: action.type };
    },
  } as unknown as TriggerActionExecutor;

  const comment = (text: string) => ({ type: 'TIMELINE_COMMENT' as const, config: { text } });

  async function newEvent(
    event: (typeof agentEvent.$inferInsert)['event'] = 'onFinishInteraction',
    payload: unknown = { name: 'Maria', interactionId: 'I1' },
  ) {
    const [row] = await db
      .insert(agentEvent)
      .values({ tenantId, agentId, event, dialogId: 'chat9498', payload })
      .returning();
    return row!.id;
  }

  const executionsOf = (agentEventId: string) =>
    db.select().from(triggerExecution).where(eq(triggerExecution.agentEventId, agentEventId));

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    runner = new TriggerRunner(executor, db);
    triggers = new TriggerService(new AgentRepository(db), db);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
  });

  beforeEach(async () => {
    calls.length = 0;
    script = [];
    const code = randomBytes(3).toString('hex');
    installationId = Math.floor(Math.random() * 1_000_000);
    const [owner] = await db
      .insert(tenant)
      .values({
        installationId: String(installationId),
        memberId: code,
        domain: `${code}.b24.com`,
        tenantCode: code,
      })
      .returning();
    tenantId = owner!.id;
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
      })
      .returning();
    agentId = row!.id;
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('roda as ações dos gatilhos ativos do evento, na ordem, com o contexto do evento', async () => {
    await triggers.create(tenantId, agentId, {
      name: 'fim',
      event: 'onFinishInteraction',
      actions: [comment('primeira {{contact.name}}'), comment('segunda')],
    });
    const off = await triggers.create(tenantId, agentId, {
      name: 'desligado',
      event: 'onFinishInteraction',
      active: false,
      actions: [comment('não roda')],
    });
    await triggers.create(tenantId, agentId, {
      name: 'outro evento',
      event: 'onNewMessage',
      actions: [comment('não roda')],
    });
    expect(off.trigger.active).toBe(false);

    const eventId = await newEvent();
    await expect(runner.evaluate(eventId)).resolves.toEqual(['success', 'success']);

    expect(calls.map((c) => (c.action.config as { text: string }).text)).toEqual([
      'primeira {{contact.name}}',
      'segunda',
    ]);
    expect(calls[0]!.context).toMatchObject({
      installationId,
      agentEventId: eventId,
      dialogId: 'chat9498',
      template: { contact: { name: 'Maria' }, agent: { name: 'Ana' }, interaction: { id: 'I1' } },
    });
    const executions = await executionsOf(eventId);
    expect(executions).toHaveLength(2);
    expect(executions.every((e) => e.status === 'SUCCESS' && e.attempts === 1)).toBe(true);
    expect(executions[0]!.result).toMatchObject({ ok: true });
  });

  it('reentrega do evento não repete a ação', async () => {
    await triggers.create(tenantId, agentId, {
      name: 'g',
      event: 'onFinishInteraction',
      actions: [comment('x')],
    });
    const eventId = await newEvent();
    await runner.evaluate(eventId);
    await expect(runner.evaluate(eventId)).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
    expect(await executionsOf(eventId)).toHaveLength(1);
  });

  it('falha transitória: espera crescente até esgotar e fica FAILED com o erro', async () => {
    await triggers.create(tenantId, agentId, {
      name: 'g',
      event: 'onFinishInteraction',
      actions: [comment('x')],
    });
    const eventId = await newEvent();
    const start = new Date('2026-10-01T12:00:00Z');
    script = Array(TRIGGER_MAX_ATTEMPTS).fill('transient');

    await expect(runner.evaluate(eventId, start)).resolves.toEqual(['retry']);
    let [execution] = await executionsOf(eventId);
    expect(execution).toMatchObject({ status: 'PENDING', attempts: 1, error: 'Bitrix fora do ar' });
    expect(execution!.nextAttemptAt!.getTime() - start.getTime()).toBe(MINUTE);

    // Antes da hora, a varredura não pega.
    await expect(runner.runDue(new Date(start.getTime() + 30_000))).resolves.toBe(0);

    // 1 min, 5 min, 15 min, 1 h depois de cada tentativa.
    let now = start.getTime();
    for (const wait of [1, 5, 15, 60]) {
      now += wait * MINUTE;
      await expect(runner.runDue(new Date(now))).resolves.toBe(1);
    }
    [execution] = await executionsOf(eventId);
    expect(execution).toMatchObject({
      status: 'FAILED',
      attempts: TRIGGER_MAX_ATTEMPTS,
      error: 'Bitrix fora do ar',
      nextAttemptAt: null,
    });
    expect(execution!.finishedAt).not.toBeNull();
    expect(calls).toHaveLength(TRIGGER_MAX_ATTEMPTS);
  });

  it('falha transitória que depois passa', async () => {
    await triggers.create(tenantId, agentId, {
      name: 'g',
      event: 'onFinishInteraction',
      actions: [comment('x')],
    });
    const eventId = await newEvent();
    const start = new Date('2026-10-01T12:00:00Z');
    script = ['transient'];
    await runner.evaluate(eventId, start);
    await runner.runDue(new Date(start.getTime() + MINUTE));
    const [execution] = await executionsOf(eventId);
    expect(execution).toMatchObject({ status: 'SUCCESS', attempts: 2, error: null });
  });

  it('falha definitiva: FAILED na hora, sem retentativa', async () => {
    await triggers.create(tenantId, agentId, {
      name: 'g',
      event: 'onFinishInteraction',
      actions: [comment('a'), comment('b')],
    });
    const eventId = await newEvent();
    script = ['permanent'];
    // A segunda ação roda mesmo com a primeira falhando.
    await expect(runner.evaluate(eventId)).resolves.toEqual(['failed', 'success']);
  });

  it('gatilho desativado antes da retentativa: não roda', async () => {
    const { trigger: created } = await triggers.create(tenantId, agentId, {
      name: 'g',
      event: 'onFinishInteraction',
      actions: [comment('x')],
    });
    const eventId = await newEvent();
    const start = new Date('2026-10-01T12:00:00Z');
    script = ['transient'];
    await runner.evaluate(eventId, start);
    await triggers.update(tenantId, agentId, created.id, { active: false });

    await runner.runDue(new Date(start.getTime() + MINUTE));
    const [execution] = await executionsOf(eventId);
    expect(execution).toMatchObject({ status: 'FAILED', error: 'gatilho desativado ou removido' });
    expect(calls).toHaveLength(1);
  });

  it('portal sem credencial tenta de novo; desinstalado falha', async () => {
    await triggers.create(tenantId, agentId, {
      name: 'g',
      event: 'onFinishInteraction',
      actions: [comment('x')],
    });
    await db.update(tenant).set({ status: 'AUTH_ERROR' }).where(eq(tenant.id, tenantId));
    const first = await newEvent();
    await expect(runner.evaluate(first)).resolves.toEqual(['retry']);

    await db.update(tenant).set({ status: 'UNINSTALLED' }).where(eq(tenant.id, tenantId));
    const second = await newEvent();
    await expect(runner.evaluate(second)).resolves.toEqual(['failed']);
    expect(calls).toHaveLength(0);
  });

  it('a mesma execução não roda duas vezes ao mesmo tempo', async () => {
    await triggers.create(tenantId, agentId, {
      name: 'g',
      event: 'onFinishInteraction',
      actions: [comment('x')],
    });
    const eventId = await newEvent();
    const now = new Date();
    // Pendente criada direto, sem rodar; duas tentativas disparadas juntas.
    const [row] = await db
      .select({ triggerId: trigger.id, actionId: schema.triggerAction.id })
      .from(trigger)
      .innerJoin(schema.triggerAction, eq(schema.triggerAction.triggerId, trigger.id))
      .where(eq(trigger.agentId, agentId));
    const [execution] = await db
      .insert(triggerExecution)
      .values({
        tenantId,
        triggerId: row!.triggerId,
        actionId: row!.actionId,
        agentEventId: eventId,
        nextAttemptAt: now,
      })
      .returning();
    const outcomes = await Promise.all([
      runner.run(execution!.id, now),
      runner.run(execution!.id, now),
    ]);
    expect(outcomes.sort()).toEqual(['skipped', 'success']);
    expect(calls).toHaveLength(1);
  });

  it('histórico do gatilho, mais recente primeiro', async () => {
    const { trigger: created } = await triggers.create(tenantId, agentId, {
      name: 'g',
      event: 'onFinishInteraction',
      actions: [comment('x')],
    });
    script = ['permanent'];
    await runner.evaluate(await newEvent());
    await runner.evaluate(await newEvent());

    const history = await triggers.executions(tenantId, agentId, created.id);
    expect(history).toHaveLength(2);
    expect(history.map((e) => e.status).sort()).toEqual(['FAILED', 'SUCCESS']);
    expect(history[0]).toMatchObject({
      actionType: 'TIMELINE_COMMENT',
      event: 'onFinishInteraction',
      dialogId: 'chat9498',
      nextAttemptAt: null,
    });
    await expect(triggers.executions(tenantId, agentId, randomUUID())).rejects.toMatchObject({
      code: 'TRIGGER_NOT_FOUND',
    });
  });
});
