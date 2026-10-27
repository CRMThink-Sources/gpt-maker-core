import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FailuresService } from '../../src/modules/backoffice/failures.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const {
  agent,
  agentEvent,
  aiModel,
  messageLog,
  notificationLog,
  paymentEvent,
  paymentsOutbox,
  tenant,
  training,
  trigger,
  triggerAction,
  triggerExecution,
} = schema;

const NOW = new Date('2026-10-04T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

// Erros por portal no backoffice (tarefa 15.7).
describe('backoffice: falhas por portal', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: FailuresService;
  let busy: { id: string; domain: string };
  let quiet: { id: string; domain: string };

  async function newTenant() {
    const code = randomBytes(3).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    return { id: row!.id, domain: row!.domain };
  }

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    service = new FailuresService(db);

    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    busy = await newTenant();
    quiet = await newTenant();
    const [ana] = await db
      .insert(agent)
      .values({
        tenantId: busy.id,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId: model!.id,
        webhookTokenHash: randomUUID(),
      })
      .returning();

    const message = (status: 'FAILED' | 'RESPONDED', at: Date, tenantId = busy.id) => ({
      tenantId,
      agentId: ana!.id,
      dialogId: 'chat7',
      bitrixMessageId: randomUUID(),
      direction: 'IN' as const,
      status,
      attempts: 4,
      error: 'GPTMaker fora',
      createdAt: at,
      updatedAt: at,
    });
    await db.insert(messageLog).values([
      message('FAILED', ago(1)),
      message('FAILED', ago(2)),
      message('RESPONDED', ago(1)),
      // Fora da janela de 30 dias.
      message('FAILED', ago(40)),
    ]);

    const [t] = await db
      .insert(trigger)
      .values({ tenantId: busy.id, agentId: ana!.id, name: 'Lead novo', event: 'onTransfer' })
      .returning();
    const [action] = await db
      .insert(triggerAction)
      .values({ triggerId: t!.id, position: 0, type: 'CREATE_LEAD', config: {} })
      .returning();
    const [event] = await db
      .insert(agentEvent)
      .values({ tenantId: busy.id, agentId: ana!.id, event: 'onTransfer', payload: {} })
      .returning();
    await db.insert(triggerExecution).values({
      tenantId: busy.id,
      triggerId: t!.id,
      actionId: action!.id,
      agentEventId: event!.id,
      status: 'FAILED',
      attempts: 3,
      error: 'crm.lead.add recusou',
      createdAt: ago(3),
    });

    await db.insert(training).values({
      tenantId: busy.id,
      agentId: ana!.id,
      type: 'DOCUMENT',
      documentName: 'manual.pdf',
      status: 'FAILED',
      error: 'arquivo ilegível',
      updatedAt: ago(4),
    });
    await db.insert(paymentEvent).values({
      eventId: randomUUID(),
      type: 'purchase.paid',
      installationId: '1',
      tenantId: busy.id,
      payload: {},
      status: 'FAILED',
      attempts: 5,
      error: 'plano sem direitos',
      receivedAt: ago(5),
    });
    await db.insert(paymentsOutbox).values({
      tenantId: busy.id,
      operation: 'item.create',
      aggregateRef: randomUUID(),
      payload: {},
      status: 'FAILED',
      attempts: 10,
      lastError: 'plataforma 500',
      createdAt: ago(6),
    });
    await db.insert(notificationLog).values({
      tenantId: quiet.id,
      type: 'CREDIT_ZERO',
      dedupeKey: 'k',
      message: 'm',
      status: 'FAILED',
      attempts: 10,
      lastError: 'im.notify recusou',
      createdAt: ago(1),
    });
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('ranking dos últimos 7 dias por portal, com as fontes', async () => {
    expect(await service.ranking(ago(7))).toEqual([
      {
        tenant: busy,
        total: 6,
        bySource: {
          message: 2,
          trigger: 1,
          training: 1,
          platform_event: 1,
          platform_outbox: 1,
        },
        lastAt: ago(1).toISOString(),
      },
      { tenant: quiet, total: 1, bySource: { notification: 1 }, lastAt: ago(1).toISOString() },
    ]);
  });

  it('falhas do portal nos últimos 30 dias, mais recentes primeiro', async () => {
    const { items } = await service.ofTenant(busy.id, NOW);
    expect(items.map((i) => [i.source, i.subject])).toEqual([
      ['message', 'Ana · diálogo chat7'],
      ['message', 'Ana · diálogo chat7'],
      ['trigger', 'Lead novo'],
      ['training', 'Ana · documento manual.pdf'],
      ['platform_event', 'purchase.paid'],
      ['platform_outbox', 'item.create'],
    ]);
    expect(items[2]).toMatchObject({ error: 'crm.lead.add recusou', attempts: 3 });
    expect((await service.ofTenant(quiet.id, NOW)).items).toEqual([
      expect.objectContaining({ source: 'notification', subject: 'CREDIT_ZERO' }),
    ]);
  });
});
