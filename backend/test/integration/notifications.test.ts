import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreditAlerts } from '../../src/modules/billing/credit-alerts';
import { LedgerService } from '../../src/modules/billing/ledger.service';
import { BitrixError } from '../../src/modules/bitrix/bitrix.errors';
import type { BitrixClient } from '../../src/modules/bitrix/bitrix.client';
import { NotificationService } from '../../src/modules/notifications/notification.service';
import { TenantService } from '../../src/modules/tenancy/tenant.service';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { notificationLog, portalAdmin, tenant } = schema;

/** Portal falso: usuários ativos, dono do token e falhas programadas por usuário. */
interface FakePortal {
  active: Set<string>;
  installer: string;
  fail: Map<string, BitrixError>;
  sent: Array<{ userId: string; message: string; tag: string }>;
}

// Avisos do app (spec credit-billing: alertas de consumo e destinatários de avisos).
describe('avisos do app', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let notifications: NotificationService;
  let ledger: LedgerService;
  let alerts: CreditAlerts;
  let tenantId: string;
  let portal: FakePortal;

  const logs = () =>
    db.select().from(notificationLog).where(eq(notificationLog.tenantId, tenantId));

  async function newTenant(): Promise<string> {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: String(Math.floor(Math.random() * 1_000_000)),
        memberId: code,
        domain: `${code}.b24.com`,
        tenantCode: code,
      })
      .returning();
    return row!.id;
  }

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
    const bitrix = {
      call: async (_installationId: number, method: string, params: Record<string, unknown>) => {
        if (method === 'user.current') return { result: { ID: portal.installer } };
        if (method === 'user.get') {
          const ids = (params.FILTER as { ID: string[] }).ID;
          return {
            result: ids.filter((id) => portal.active.has(id)).map((ID) => ({ ID, ACTIVE: true })),
          };
        }
        if (method === 'im.notify.system.add') {
          const userId = String(params.USER_ID);
          const failure = portal.fail.get(userId);
          if (failure) throw failure;
          portal.sent.push({ userId, message: String(params.MESSAGE), tag: String(params.TAG) });
          return { result: portal.sent.length };
        }
        throw new Error(`método inesperado ${method}`);
      },
    } as unknown as BitrixClient;
    notifications = new NotificationService(bitrix, new TenantService(db), db, redis);
    ledger = new LedgerService(db, redis);
    alerts = new CreditAlerts(notifications, db);
  });

  beforeEach(async () => {
    tenantId = await newTenant();
    portal = {
      active: new Set(['1', '2', '3', '508']),
      installer: '508',
      fail: new Map(),
      sent: [],
    };
  });

  afterAll(async () => {
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  describe('envio', () => {
    it('mesma chave não repete; vai aos destinatários ativos, com a tag do aviso', async () => {
      await notifications.setRecipients(tenantId, ['2', '3', '9'], 'admin');
      const input = { tenantId, type: 'CREDIT_80' as const, dedupeKey: 'g1', message: 'oi' };
      expect(await notifications.notify(input)).toBe(true);
      expect(await notifications.notify(input)).toBe(false);

      await notifications.dispatchPending();
      expect(portal.sent.map((s) => s.userId)).toEqual(['2', '3']);
      expect(portal.sent[0]!.tag).toBe('GPTMAKER|CREDIT_80|g1');
      const [log] = await logs();
      expect(log).toMatchObject({ status: 'SENT', sentTo: ['2', '3'] });

      await notifications.dispatchPending();
      expect(portal.sent).toHaveLength(2);
    });

    it('sem destinatários (ou todos desativados): administradores vistos e quem instalou', async () => {
      await db.insert(portalAdmin).values([
        { tenantId, bitrixUserId: '1' },
        { tenantId, bitrixUserId: '7' },
      ]);
      await notifications.setRecipients(tenantId, ['9'], 'admin');
      await notifications.notify({ tenantId, type: 'CREDIT_ZERO', dedupeKey: 'g1', message: 'x' });
      await notifications.dispatchPending();
      expect(portal.sent.map((s) => s.userId).sort()).toEqual(['1', '508']);
    });

    it('falha transitória: nova tentativa depois, sem reenviar a quem já recebeu', async () => {
      await notifications.setRecipients(tenantId, ['1', '2'], 'admin');
      portal.fail.set('2', new BitrixError('UNAVAILABLE', 'im.notify.system.add', 'X', 'fora'));
      await notifications.notify({
        tenantId,
        type: 'PAYMENT_FAILED',
        dedupeKey: 's',
        message: 'x',
      });
      await notifications.dispatchPending();
      const [pending] = await logs();
      expect(pending).toMatchObject({ status: 'PENDING', attempts: 1, sentTo: ['1'] });
      expect(pending!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      portal.fail.clear();
      await notifications.dispatchPending(new Date(Date.now() + 120_000));
      expect(portal.sent.map((s) => s.userId)).toEqual(['1', '2']);
      expect((await logs())[0]).toMatchObject({ status: 'SENT', sentTo: ['1', '2'] });
    });

    it('aviso recém-gravado sai mesmo com o relógio do Node uma fração atrás do banco', async () => {
      await notifications.setRecipients(tenantId, ['1'], 'admin');
      await notifications.notify({ tenantId, type: 'CREDIT_80', dedupeKey: 'r', message: 'x' });
      // `next_attempt_at` = now() do banco, em microssegundos; o Node fica até 1 ms atrás.
      await notifications.dispatchPending(new Date(Date.now() - 1000));
      expect((await logs())[0]).toMatchObject({ status: 'SENT', sentTo: ['1'] });
    });

    it('recusa para um usuário não impede os demais', async () => {
      await notifications.setRecipients(tenantId, ['1', '2'], 'admin');
      portal.fail.set('1', new BitrixError('API_ERROR', 'im.notify.system.add', 'ACCESS', 'x'));
      await notifications.notify({ tenantId, type: 'CREDIT_80', dedupeKey: 'g', message: 'x' });
      await notifications.dispatchPending();
      expect((await logs())[0]).toMatchObject({ status: 'SENT', sentTo: ['2'] });
    });

    it('app desinstalado: não envia', async () => {
      await db.update(tenant).set({ status: 'UNINSTALLED' }).where(eq(tenant.id, tenantId));
      await notifications.notify({ tenantId, type: 'CREDIT_80', dedupeKey: 'g', message: 'x' });
      await notifications.dispatchPending();
      expect(portal.sent).toEqual([]);
      expect((await logs())[0]).toMatchObject({ status: 'FAILED' });
    });

    it('aviso de teste sai na hora', async () => {
      await notifications.setRecipients(tenantId, ['3'], 'admin');
      expect(await notifications.sendTest(tenantId, '508')).toEqual({
        status: 'SENT',
        sentTo: ['3'],
      });
    });

    it('destinatários: a lista é substituída inteira', async () => {
      await notifications.setRecipients(tenantId, ['1', '2', '2'], 'admin');
      expect(await notifications.recipients(tenantId)).toEqual(['1', '2']);
      await notifications.setRecipients(tenantId, [], 'admin');
      expect(await notifications.recipients(tenantId)).toEqual([]);
    });
  });

  describe('alertas de crédito', () => {
    const op = (key: string) => ({ tenantId, key, createdBy: 't' });
    const debit = async (key: string, amount: number) => {
      const result = await ledger.debit({ ...op(key), amount, modelCode: 'M', unitCost: amount });
      return alerts.afterDebit(tenantId, result.balance);
    };

    it('80% e zerado uma vez por ciclo; ciclo novo avisa de novo', async () => {
      await ledger.credit({ ...op('grant-1'), wallet: 'PLAN', type: 'GRANT', amount: 100 });
      expect(await debit('m1', 79)).toBeNull();
      expect(await debit('m2', 1)).toBe('CREDIT_80');
      expect(await debit('m3', 5)).toBe('CREDIT_80');
      expect(await debit('m4', 15)).toBe('CREDIT_ZERO');
      expect(await debit('m5', 1)).toBe('CREDIT_ZERO');
      expect((await logs()).map((l) => l.type).sort()).toEqual(['CREDIT_80', 'CREDIT_ZERO']);
      expect((await logs()).find((l) => l.type === 'CREDIT_80')!.message).toContain('80%');

      await ledger.credit({ ...op('grant-2'), wallet: 'PLAN', type: 'GRANT', amount: 100 });
      await debit('m6', 85);
      expect((await logs()).filter((l) => l.type === 'CREDIT_80')).toHaveLength(2);
    });

    it('sem GRANT (nenhum ciclo): não avisa', async () => {
      await ledger.credit({ ...op('pacote'), wallet: 'EXTRA', type: 'TOPUP', amount: 10 });
      expect(await debit('m1', 10)).toBeNull();
      expect(await logs()).toEqual([]);
    });
  });

  it('chave por tenant: o mesmo aviso em dois portais vale para os dois', async () => {
    const other = await newTenant();
    const key = randomUUID();
    expect(
      await notifications.notify({ tenantId, type: 'TEST', dedupeKey: key, message: 'x' }),
    ).toBe(true);
    expect(
      await notifications.notify({ tenantId: other, type: 'TEST', dedupeKey: key, message: 'x' }),
    ).toBe(true);
  });
});
