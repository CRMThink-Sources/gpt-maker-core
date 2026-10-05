import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { TRIGGER_MAX_PER_AGENT, type CreateTriggerInput } from '@gptmaker/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../src/modules/agents/agent.repository';
import { TriggerService } from '../../src/modules/triggers/trigger.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';

const { agent, aiModel, tenant, trigger, triggerAction } = schema;

// Cadastro de gatilhos (spec agent-triggers).
describe('gatilhos do agente', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: TriggerService;
  let tenantId: string;
  let otherTenantId: string;
  let agentId: string;
  let modelId: string;

  const lead = {
    type: 'CREATE_LEAD',
    config: { fields: { TITLE: 'Lead de {{contact.name}}' } },
  } as const;
  const webhook = {
    type: 'OUTBOUND_WEBHOOK',
    config: { url: 'https://hooks.exemplo.com/a' },
  } as const;
  const comment = { type: 'TIMELINE_COMMENT', config: { text: 'Atendimento encerrado' } } as const;
  const input = (overrides: Partial<CreateTriggerInput> = {}): CreateTriggerInput => ({
    name: 'Lead ao fim do atendimento',
    event: 'onFinishInteraction',
    actions: [lead, webhook],
    ...overrides,
  });

  async function newTenant() {
    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    return row!.id;
  }

  async function newAgent(owner: string) {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId: owner,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: randomUUID(),
      })
      .returning();
    return row!.id;
  }

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    service = new TriggerService(new AgentRepository(db), db);
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    modelId = model!.id;
    tenantId = await newTenant();
    otherTenantId = await newTenant();
  });

  beforeEach(async () => {
    agentId = await newAgent(tenantId);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('cria ativo, com as ações na ordem e o segredo do webhook uma vez só', async () => {
    const { trigger: created, newSecrets } = await service.create(tenantId, agentId, input());

    expect(created).toMatchObject({
      agentId,
      name: 'Lead ao fim do atendimento',
      event: 'onFinishInteraction',
      active: true,
      actions: [
        { type: 'CREATE_LEAD', config: lead.config, hasSecret: false },
        { type: 'OUTBOUND_WEBHOOK', config: webhook.config, hasSecret: true },
      ],
    });
    const webhookId = created.actions[1]!.id;
    expect(Object.keys(newSecrets)).toEqual([webhookId]);
    expect(newSecrets[webhookId]).toMatch(/^[\w-]{43}$/);

    // Cifrado em repouso; a listagem não traz o valor.
    const [raw] = await db
      .execute<{ secret: string }>(sql`select secret from trigger_action where id = ${webhookId}`)
      .then((r) => r.rows);
    expect(raw!.secret).not.toBe(newSecrets[webhookId]);
    const [listed] = await service.list(tenantId, agentId);
    expect(JSON.stringify(listed)).not.toContain(newSecrets[webhookId]);
  });

  it('lista só os do agente e não removidos; agente de outro tenant é 404', async () => {
    await service.create(tenantId, agentId, input({ name: 'A' }));
    const { trigger: second } = await service.create(tenantId, agentId, input({ name: 'B' }));
    await service.remove(tenantId, agentId, second.id);
    expect((await service.list(tenantId, agentId)).map((t) => t.name)).toEqual(['A']);

    await expect(service.list(otherTenantId, agentId)).rejects.toMatchObject({
      code: 'AGENT_NOT_FOUND',
    });
    await expect(service.create(otherTenantId, agentId, input())).rejects.toMatchObject({
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('desativa e reativa', async () => {
    const { trigger: created } = await service.create(tenantId, agentId, input());
    const off = await service.update(tenantId, agentId, created.id, { active: false });
    expect(off.trigger.active).toBe(false);
    expect(off.trigger.actions).toHaveLength(2);
    expect(
      (await service.update(tenantId, agentId, created.id, { active: true })).trigger.active,
    ).toBe(true);
  });

  it('edita as ações: mantém pelo id (com o segredo), reordena, remove e acrescenta', async () => {
    const { trigger: created, newSecrets } = await service.create(tenantId, agentId, input());
    const [leadAction, webhookAction] = created.actions;

    const { trigger: edited, newSecrets: added } = await service.update(
      tenantId,
      agentId,
      created.id,
      {
        name: 'Novo nome',
        actions: [
          {
            id: webhookAction!.id,
            type: 'OUTBOUND_WEBHOOK',
            config: { url: 'https://hooks.exemplo.com/b' },
          },
          comment,
        ],
      },
    );

    expect(edited.name).toBe('Novo nome');
    expect(edited.actions).toMatchObject([
      { id: webhookAction!.id, config: { url: 'https://hooks.exemplo.com/b' }, hasSecret: true },
      { type: 'TIMELINE_COMMENT' },
    ]);
    expect(added).toEqual({});
    // Segredo do webhook mantido.
    const [kept] = await db
      .select()
      .from(triggerAction)
      .where(eq(triggerAction.id, webhookAction!.id));
    expect(kept!.secret).toBe(newSecrets[webhookAction!.id]);
    // A ação retirada fica para o histórico.
    const [removed] = await db
      .select()
      .from(triggerAction)
      .where(eq(triggerAction.id, leadAction!.id));
    expect(removed!.deletedAt).not.toBeNull();
  });

  it('webhook novo na edição devolve o segredo dele', async () => {
    const { trigger: created } = await service.create(
      tenantId,
      agentId,
      input({ actions: [lead] }),
    );
    const { trigger: edited, newSecrets } = await service.update(tenantId, agentId, created.id, {
      actions: [{ id: created.actions[0]!.id, ...lead }, webhook],
    });
    expect(Object.keys(newSecrets)).toEqual([edited.actions[1]!.id]);
  });

  it('recusa ação de outro gatilho, troca de tipo e gatilho inexistente', async () => {
    const { trigger: first } = await service.create(tenantId, agentId, input());
    const { trigger: second } = await service.create(tenantId, agentId, input());

    await expect(
      service.update(tenantId, agentId, second.id, {
        actions: [{ id: first.actions[0]!.id, ...lead }],
      }),
    ).rejects.toMatchObject({ code: 'TRIGGER_ACTION_NOT_FOUND' });
    await expect(
      service.update(tenantId, agentId, first.id, {
        actions: [{ id: first.actions[0]!.id, ...comment }],
      }),
    ).rejects.toMatchObject({ code: 'TRIGGER_ACTION_TYPE_CHANGED' });
    await expect(
      service.update(tenantId, agentId, randomUUID(), { active: false }),
    ).rejects.toMatchObject({ code: 'TRIGGER_NOT_FOUND' });
    await expect(
      service.create(tenantId, agentId, input({ actions: [{ id: randomUUID(), ...lead }] })),
    ).rejects.toMatchObject({ code: 'TRIGGER_ACTION_NOT_FOUND' });
  });

  it('removido: some da lista, para de disparar e não pode ser editado', async () => {
    const { trigger: created } = await service.create(tenantId, agentId, input());
    await service.remove(tenantId, agentId, created.id);
    const [row] = await db.select().from(trigger).where(eq(trigger.id, created.id));
    expect(row).toMatchObject({ active: false });
    expect(row!.deletedAt).not.toBeNull();
    await expect(
      service.update(tenantId, agentId, created.id, { name: 'x' }),
    ).rejects.toMatchObject({ code: 'TRIGGER_NOT_FOUND' });
  });

  it('limite de gatilhos por agente', async () => {
    await db.insert(trigger).values(
      Array.from({ length: TRIGGER_MAX_PER_AGENT }, (_, i) => ({
        tenantId,
        agentId,
        name: `g${i}`,
        event: 'onNewMessage' as const,
      })),
    );
    await expect(service.create(tenantId, agentId, input())).rejects.toMatchObject({
      code: 'TRIGGER_LIMIT',
    });
  });

  it('valida a configuração de cada tipo de ação', async () => {
    await expect(
      service.create(
        tenantId,
        agentId,
        input({ actions: [{ type: 'CREATE_LEAD', config: { fields: {} } }] }),
      ),
    ).rejects.toThrow('TITLE');
    await expect(
      service.create(
        tenantId,
        agentId,
        input({ actions: [{ type: 'OUTBOUND_WEBHOOK', config: { url: 'ftp://x' } }] }),
      ),
    ).rejects.toThrow();
    await expect(service.create(tenantId, agentId, input({ actions: [] }))).rejects.toThrow();
  });
});
