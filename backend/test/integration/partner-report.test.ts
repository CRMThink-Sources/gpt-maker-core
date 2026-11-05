import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { PartnerReportService } from '../../src/modules/backoffice/partner-report.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import type { PlatformApiClient } from '../../src/shared/platform/platform-api.client';
import { testPool } from '../support/postgres';

const {
  agent,
  aiModel,
  creditLedger,
  paymentEvent,
  reconciliationAdjustment,
  tenant,
  usageDailyReal,
  usageDailyUnlinked,
  workspaceSyncFinding,
} = schema;

const PLANS = [
  { id: 9, name: 'Starter', amount: 9900, type: 'subscription', trial: false },
  { id: 11, name: 'Pro', amount: 19900, type: 'subscription', trial: false },
  { id: 7, name: 'Trial', amount: 0, type: 'subscription', trial: true },
  { id: 13, name: 'Pacote 1000', amount: 4900, type: 'one_time', trial: false },
];

// Relatório mensal do partner (spec usage-reconciliation; tarefas 14.4 e 15.7).
describe('relatório do partner', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let plansFail = false;
  const env = {
    RECONCILIATION_TIMEZONE: 'America/Sao_Paulo',
    GPTMAKER_CREDIT_COST_CENTS: 2.5,
  } as Env;
  let service: PartnerReportService;
  let acme: { id: string; domain: string };
  let ana: string;
  let removed: string;

  async function event(tenantId: string, type: string, occurredAt: string, extra: object) {
    await db.insert(paymentEvent).values({
      eventId: randomUUID(),
      type,
      installationId: '1',
      tenantId,
      status: 'PROCESSED',
      receivedAt: new Date(occurredAt),
      payload: { eventId: randomUUID(), type, occurredAt, ...extra },
    });
  }

  async function debit(agentId: string, at: string, amount: number) {
    await db.insert(creditLedger).values({
      tenantId: acme.id,
      wallet: 'PLAN',
      type: 'DEBIT',
      amount: -amount,
      agentId,
      modelCode: 'GPT_5_MINI',
      unitCost: 1,
      refType: 'message',
      refId: randomUUID(),
      idempotencyKey: randomUUID(),
      createdBy: 'teste',
      createdAt: new Date(at),
    });
  }

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    const platform = {
      listPlans: async () => {
        if (plansFail) throw new Error('fora');
        return PLANS;
      },
    } as unknown as PlatformApiClient;
    service = new PartnerReportService(platform, env, db);

    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    const code = randomBytes(3).toString('hex');
    const [t] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    acme = { id: t!.id, domain: t!.domain };
    const newAgent = async (name: string, status: 'ACTIVE' | 'DELETED') => {
      const [row] = await db
        .insert(agent)
        .values({
          tenantId: acme.id,
          gptmakerAgentId: `gm-${randomUUID()}`,
          name,
          type: 'SUPPORT',
          communicationType: 'NORMAL',
          modelId: model!.id,
          status,
          webhookTokenHash: randomUUID(),
        })
        .returning();
      return row!.id;
    };
    ana = await newAgent('Ana', 'ACTIVE');
    removed = await newAgent('Antigo', 'DELETED');

    // Outubro: Ana consumiu 300 em dois dias; o removido, 50.
    await db.insert(usageDailyReal).values([
      { agentId: ana, tenantId: acme.id, day: '2026-10-01', modelCode: 'GPT_5_MINI', credits: 120 },
      { agentId: ana, tenantId: acme.id, day: '2026-10-02', modelCode: 'GPT_5_MINI', credits: 180 },
      { agentId: removed, tenantId: acme.id, day: '2026-10-01', modelCode: 'X', credits: 50 },
      // Setembro e novembro ficam de fora.
      { agentId: ana, tenantId: acme.id, day: '2026-09-30', modelCode: 'GPT_5_MINI', credits: 999 },
    ]);
    await db.insert(reconciliationAdjustment).values([
      {
        agentId: ana,
        tenantId: acme.id,
        day: '2026-10-01',
        realTotal: 120,
        debitedTotal: 110,
        adjustedTotal: -10,
      },
      {
        agentId: ana,
        tenantId: acme.id,
        day: '2026-10-02',
        realTotal: 180,
        debitedTotal: 180,
        adjustedTotal: 0,
        status: 'WITHIN_TOLERANCE',
      },
      {
        agentId: removed,
        tenantId: acme.id,
        day: '2026-10-01',
        realTotal: 50,
        debitedTotal: 300,
        adjustedTotal: 0,
        status: 'REVIEW',
      },
    ]);
    await debit(ana, '2026-10-01T15:00:00Z', 110);
    await debit(ana, '2026-10-02T15:00:00Z', 180);
    // 23:30 de 30/09 em Brasília (02:30 UTC de 01/10): setembro.
    await debit(ana, '2026-10-01T02:30:00Z', 7);
    await debit(removed, '2026-10-01T15:00:00Z', 300);

    await db.insert(usageDailyUnlinked).values({
      gptmakerAgentId: 'gm-orfao',
      day: '2026-10-02',
      modelCode: 'GPT_5_MINI',
      credits: 40,
    });
    await db.insert(workspaceSyncFinding).values({
      kind: 'ORPHAN',
      gptmakerAgentId: 'gm-orfao',
      details: { name: 'Teste' },
    });

    const sub = (planId: number) => ({ subscription: { id: 1, planId, status: 'active' } });
    await event(acme.id, 'subscription.activated', '2026-10-01T13:00:00Z', {
      ...sub(9),
      data: {},
    });
    await event(acme.id, 'subscription.plan_changed', '2026-10-15T13:00:00Z', {
      ...sub(11),
      data: { previousPlanId: 9, planId: 11, effective: 'immediate', remainingFraction: 0.5 },
    });
    await event(acme.id, 'purchase.paid', '2026-10-05T13:00:00Z', {
      ...sub(11),
      data: { purchaseId: 1, planId: 13, quantity: 1, chargeId: 'ch_1', amount: 4900 },
    });
    // Reembolso parcial e depois total da mesma cobrança: conta o acumulado.
    for (const amountRefunded of [1000, 4900]) {
      await event(acme.id, 'charge.refunded', '2026-10-06T13:00:00Z', {
        ...sub(11),
        data: { chargeId: 'ch_1', source: 'purchase', amount: 4900, amountRefunded },
      });
    }
    // 23:00 de 31/10 em Brasília é 02:00 UTC de 01/11: ainda outubro.
    await event(acme.id, 'purchase.paid', '2026-11-01T02:00:00Z', {
      ...sub(11),
      data: { purchaseId: 2, planId: 13, quantity: 1, chargeId: 'ch_2', amount: 4900 },
    });
    // Novembro em Brasília: fora.
    await event(acme.id, 'subscription.renewed', '2026-11-01T13:00:00Z', {
      ...sub(11),
      data: { invoiceId: 'in_1', previousPeriodEnd: '2026-11-01T13:00:00Z' },
    });
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('consumo, cobrança e receita do mês por portal e agente, com órfãos e margem', async () => {
    const report = await service.report('2026-10', new Date('2026-10-04T15:00:00Z'));
    expect(report).toMatchObject({
      month: '2026-10',
      daysInPeriod: 3,
      daysReconciled: 2,
      creditCostCents: 2.5,
      platformError: false,
      pendingReviews: 1,
    });
    // Receita: Starter 9900 + upgrade (19900 - 9900) × 0,5 + 2 pacotes - reembolso de 4900.
    const revenue = { subscriptions: 14900, packages: 9800, refunds: 4900, total: 19800 };
    const [row] = report.tenants;
    expect(row).toMatchObject({
      tenant: acme,
      consumed: 350,
      debited: 590,
      adjusted: -10,
      charged: 600,
      revenue,
      costCents: 875,
      marginCents: 19800 - 875,
    });
    expect(row!.agents).toEqual([
      {
        agentId: ana,
        name: 'Ana',
        removed: false,
        consumed: 300,
        debited: 290,
        adjusted: -10,
        charged: 300,
      },
      {
        agentId: removed,
        name: 'Antigo',
        removed: true,
        consumed: 50,
        debited: 300,
        adjusted: 0,
        charged: 300,
      },
    ]);
    expect(report.unlinked).toEqual([{ gptmakerAgentId: 'gm-orfao', name: 'Teste', consumed: 40 }]);
    expect(report.totals).toMatchObject({
      consumed: 390,
      unlinked: 40,
      charged: 600,
      revenue,
      costCents: 975,
      marginCents: 19800 - 975,
    });
  });

  it('sem a plataforma: assinaturas sem estimativa, valores dos eventos mantidos', async () => {
    plansFail = true;
    try {
      const report = await service.report('2026-10', new Date('2026-12-01T12:00:00Z'));
      expect(report.platformError).toBe(true);
      expect(report.totals.revenue).toEqual({
        subscriptions: 0,
        packages: 9800,
        refunds: 4900,
        total: 4900,
      });
      expect(report.daysInPeriod).toBe(31);
    } finally {
      plansFail = false;
    }
  });
});
