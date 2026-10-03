import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { OperatorService } from '../../src/modules/backoffice/operator.service';
import { PlanRightsService } from '../../src/modules/backoffice/plan-rights.service';
import { ModelCatalogService } from '../../src/modules/models/model-catalog.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import { DomainError } from '../../src/shared/http/api-exception.filter';
import { PlatformApiClient } from '../../src/shared/platform/platform-api.client';
import * as schema from '../../src/shared/database/schema/index';

const { aiModel, auditLog, planAllowedModel, planEntitlement, subscriptionState, tenant } = schema;

const PLATFORM_PLANS = [
  {
    id: 9,
    productId: 5,
    productName: 'GPTMaker',
    name: 'Trial',
    amount: 0,
    interval: 'monthly',
    type: 'subscription',
    trial: true,
  },
  {
    id: 11,
    productId: 5,
    productName: 'GPTMaker',
    name: 'ThinkFlow 5000',
    amount: 10000,
    interval: 'monthly',
    type: 'subscription',
    trial: false,
  },
  {
    id: 13,
    productId: 5,
    productName: 'GPTMaker',
    name: 'ThinkFlow 10000',
    amount: 200000,
    interval: 'monthly',
    type: 'subscription',
    trial: false,
  },
  {
    id: 7,
    productId: 7,
    productName: 'Créditos',
    name: '1000 Créditos',
    amount: 5000,
    interval: null,
    type: 'one_time',
    trial: false,
  },
];

// Direitos dos planos no backoffice (spec admin-backoffice, "Gestão de direitos dos planos"; 15.2).
describe('backoffice: direitos dos planos', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: PlanRightsService;
  let actor: string;
  let platformUp: boolean;
  let mini: string;
  let sol: string;
  let inactive: string;

  async function rejection(promise: Promise<unknown>): Promise<DomainError> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    db = drizzle(pool, { schema });
    const platform = new PlatformApiClient(
      { baseUrl: 'https://platform.test', apiKey: 'k', timeoutMs: 1000, maxAttempts: 1 },
      async () =>
        platformUp
          ? new Response(JSON.stringify({ items: PLATFORM_PLANS }), { status: 200 })
          : new Response('{}', { status: 503 }),
    );
    service = new PlanRightsService(
      platform,
      new ModelCatalogService(db, undefined as never),
      new AuditService(db),
      db,
    );
    const models = await db
      .insert(aiModel)
      .values([
        { code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1, isDefault: true },
        { code: 'GPT_5_6_SOL', displayName: 'GPT-5.6 Sol', creditsPerResponse: 14 },
        { code: 'OLD', displayName: 'Antigo', creditsPerResponse: 3, active: false },
      ])
      .returning();
    [mini, sol, inactive] = models.map((m) => m.id) as [string, string, string];
    actor = (
      await new OperatorService(db).create({ email: 'ana@empresa.com', name: 'Ana', role: 'ADMIN' })
    ).operator.id;
  });

  beforeEach(async () => {
    platformUp = true;
    await db.delete(planAllowedModel);
    await db.delete(planEntitlement);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('lista os planos da plataforma com e sem direitos, e os assinantes', async () => {
    await db
      .insert(planEntitlement)
      .values({
        planSpaId: '11',
        planType: 'subscription',
        creditsPerCycle: 5000,
        updatedBy: 'manual',
      });
    const code = randomBytes(4).toString('hex');
    const [t] = await db
      .insert(tenant)
      .values({ installationId: code, memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    await db
      .insert(subscriptionState)
      .values({
        tenantId: t!.id,
        subscriptionId: '1',
        status: 'active',
        modality: 'stripe',
        planId: '11',
        version: 1,
      });

    const view = await service.list();
    expect(view.platformError).toBe(false);
    expect(view.plans.map((p) => [p.id, p.rights?.creditsPerCycle ?? null, p.subscribers])).toEqual(
      [
        [7, null, 0],
        [9, null, 0],
        [11, 5000, 1],
        [13, null, 0],
      ],
    );
    expect(view.plans.find((p) => p.id === 11)?.rights?.updatedBy).toBe('manual');
    expect(view.models.map((m) => m.code).sort()).toEqual(['GPT_5_6_SOL', 'GPT_5_MINI', 'OLD']);
  });

  it('grava créditos, limites e modelos; registra auditoria com o nome do operador', async () => {
    const saved = await service.update(
      13,
      {
        type: 'subscription',
        active: true,
        creditsPerCycle: 10000,
        creditsPerPackage: 999,
        maxTrainings: 50,
        maxDocumentStorageMb: null,
        allowedModelIds: [sol],
      },
      actor,
    );
    expect(saved.rights).toMatchObject({
      creditsPerCycle: 10000,
      creditsPerPackage: null,
      maxTrainings: 50,
      maxDocumentStorageMb: null,
      allowedModelIds: [sol],
      updatedBy: 'Ana',
    });
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.entityId, '13'));
    expect(audit).toMatchObject({ action: 'plan.rights_updated', actorId: actor });
  });

  it('modelo inativo: recusa sem gravar nada', async () => {
    const error = await rejection(
      service.update(
        13,
        {
          type: 'subscription',
          active: true,
          creditsPerCycle: 10000,
          creditsPerPackage: null,
          maxTrainings: null,
          maxDocumentStorageMb: null,
          allowedModelIds: [inactive],
        },
        actor,
      ),
    );
    expect(error.code).toBe('MODEL_NOT_AVAILABLE');
    expect(
      await db.select().from(planEntitlement).where(eq(planEntitlement.planSpaId, '13')),
    ).toEqual([]);
  });

  it('tipo diferente do SPA: recusado', async () => {
    const error = await rejection(
      service.update(
        7,
        {
          type: 'subscription',
          active: true,
          creditsPerCycle: 10,
          creditsPerPackage: null,
          maxTrainings: null,
          maxDocumentStorageMb: null,
          allowedModelIds: [],
        },
        actor,
      ),
    );
    expect(error.code).toBe('PLAN_TYPE_MISMATCH');
  });

  it('pacote: só os créditos do pacote, sem modelos nem limites', async () => {
    const saved = await service.update(
      7,
      {
        type: 'one_time',
        active: true,
        creditsPerCycle: 5,
        creditsPerPackage: 1000,
        maxTrainings: 3,
        maxDocumentStorageMb: 3,
        allowedModelIds: [mini],
      },
      actor,
    );
    expect(saved.rights).toMatchObject({
      creditsPerCycle: null,
      creditsPerPackage: 1000,
      maxTrainings: null,
      allowedModelIds: [],
    });
  });

  it('plataforma fora: direitos cadastrados continuam visíveis, marcados fora da plataforma', async () => {
    await db
      .insert(planEntitlement)
      .values({ planSpaId: '11', planType: 'subscription', creditsPerCycle: 5000 });
    platformUp = false;
    const view = await service.list();
    expect(view.platformError).toBe(true);
    expect(view.plans).toEqual([expect.objectContaining({ id: 11, onPlatform: false })]);
  });
});
