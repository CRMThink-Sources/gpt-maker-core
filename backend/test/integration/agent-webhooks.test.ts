import { randomBytes, randomUUID } from 'node:crypto';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { hashWebhookToken, webhookUrlsFor } from '../../src/modules/agents/agent.service';
import { AgentWebhooksSync } from '../../src/modules/agents/agent-webhooks.sync';
import { GptMakerClient } from '../../src/modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../../src/modules/gptmaker/gptmaker.resilience';
import {
  AgentEventIntake,
  type AgentEventMessage,
} from '../../src/modules/triggers/agent-event.intake';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { EXCHANGES } from '../../src/shared/messaging/topology';
import { WireMock } from '../support/wiremock';
import { testPool } from '../support/postgres';

const { agent, agentEvent, aiModel, tenant } = schema;
const BASE = 'https://api.exemplo.com';

// Webhooks dos agentes (spec agent-triggers): recebimento e reconciliação no GPTMaker.
describe('webhooks dos agentes', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wiremock: WireMock;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let intake: AgentEventIntake;
  let sync: AgentWebhooksSync;
  let tenantId: string;
  let modelId: string;
  const published: Array<{ exchange: string; routingKey: string; body: AgentEventMessage }> = [];

  const amqp = {
    publish: async (exchange: string, routingKey: string, body: AgentEventMessage) => {
      published.push({ exchange, routingKey, body });
      return true;
    },
  } as unknown as AmqpConnection;

  async function newAgent(token: string, status: (typeof agent.$inferInsert)['status'] = 'ACTIVE') {
    const [row] = await db
      .insert(agent)
      .values({
        tenantId,
        gptmakerAgentId: `gm-${randomUUID()}`,
        name: 'Ana',
        type: 'SUPPORT',
        communicationType: 'NORMAL',
        modelId,
        webhookTokenHash: hashWebhookToken(token),
        status,
      })
      .returning();
    return row!;
  }

  beforeAll(async () => {
    [postgres, redisContainer, wiremock] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      WireMock.start(),
    ]);
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    redis = new Redis(redisContainer.getConnectionUrl());
    const gptmaker = new GptMakerClient(
      {
        baseUrl: `${wiremock.baseUrl}/v2`,
        token: 't',
        workspaceId: 'ws',
        timeoutMs: 5000,
        conversationTimeoutMs: 5000,
      },
      new GptMakerResilience({
        maxAttempts: 1,
        breakerThreshold: 50,
        halfOpenAfterMs: 1000,
        beforeAttempt: async () => {},
      }),
    );
    intake = new AgentEventIntake(amqp, db);
    sync = new AgentWebhooksSync(gptmaker, db, redis, {
      API_PUBLIC_URL: BASE,
      APP_ROLE: 'api',
    } as Env);

    const code = randomBytes(3).toString('hex');
    const [owner] = await db
      .insert(tenant)
      .values({ installationId: '77', memberId: code, domain: `${code}.b24.com`, tenantCode: code })
      .returning();
    const [model] = await db
      .insert(aiModel)
      .values({ code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 })
      .returning();
    tenantId = owner!.id;
    modelId = model!.id;
  });

  beforeEach(async () => {
    await wiremock.reset();
    await redis.flushall();
    await db.delete(agentEvent);
    await db.delete(agent);
    published.length = 0;
  });

  afterAll(async () => {
    await redis?.quit();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop(), wiremock?.stop()]);
  });

  describe('recebimento', () => {
    it('token do agente: grava o payload inteiro e publica pelo nome do evento', async () => {
      const row = await newAgent('tok-1');
      const payload = { contextId: `${tenantId}:chat9498`, message: 'quero falar com humano' };
      const outcome = await intake.receive('onTransfer', 'tok-1', payload);

      expect(outcome).toMatchObject({ kind: 'accepted' });
      const [stored] = await db.select().from(agentEvent);
      expect(stored).toMatchObject({
        tenantId,
        agentId: row.id,
        event: 'onTransfer',
        dialogId: 'chat9498',
        payload,
      });
      expect(published).toEqual([
        {
          exchange: EXCHANGES.triggersEvents,
          routingKey: 'onTransfer',
          body: {
            agentEventId: stored!.id,
            tenantId,
            agentId: row.id,
            event: 'onTransfer',
            dialogId: 'chat9498',
          },
        },
      ]);
    });

    it('conversa de teste do app: grava o evento, mas não dispara gatilhos', async () => {
      await newAgent('tok-1');
      const dialog = 't-0a1b2c3d4e';
      const outcome = await intake.receive('onFinishInteraction', 'tok-1', {
        contextId: `public-api-GM-${tenantId}:${dialog}`,
      });
      expect(outcome).toMatchObject({ kind: 'accepted' });
      const [stored] = await db.select().from(agentEvent);
      expect(stored).toMatchObject({ event: 'onFinishInteraction', dialogId: dialog });
      expect(published).toEqual([]);
    });

    it('token inválido ou ausente: nada gravado', async () => {
      await newAgent('tok-1');
      await expect(intake.receive('onTransfer', 'outro', {})).resolves.toEqual({
        kind: 'invalid-token',
      });
      await expect(intake.receive('onTransfer', undefined, {})).resolves.toEqual({
        kind: 'invalid-token',
      });
      expect(await db.select().from(agentEvent)).toEqual([]);
      expect(published).toEqual([]);
    });

    it('evento desconhecido', async () => {
      await newAgent('tok-1');
      await expect(intake.receive('onQualquer', 'tok-1', {})).resolves.toEqual({
        kind: 'unknown-event',
      });
    });

    it('sem contextId: grava sem diálogo', async () => {
      await newAgent('tok-1');
      await intake.receive('onNewMessage', 'tok-1', { raw: 'algo', contentType: 'text/plain' });
      const [stored] = await db.select().from(agentEvent);
      expect(stored).toMatchObject({ dialogId: null, payload: { raw: 'algo' } });
    });
  });

  describe('reconciliação no GPTMaker', () => {
    async function stubGet(gptmakerAgentId: string, webhooks: Record<string, string | null>) {
      await wiremock.stub({
        request: { method: 'GET', urlPath: `/v2/agent/${gptmakerAgentId}/webhooks` },
        response: { status: 200, jsonBody: webhooks },
      });
      await wiremock.stub({
        request: { method: 'PUT', urlPath: `/v2/agent/${gptmakerAgentId}/webhooks` },
        response: { status: 200, jsonBody: { success: true } },
      });
    }

    it('endereço antigo: token novo no GPTMaker e o hash dele no agente', async () => {
      const row = await newAgent('tok-velho');
      await stubGet(row.gptmakerAgentId, webhookUrlsFor('http://localhost:3001', 'tok-velho'));

      await expect(sync.reconcile()).resolves.toEqual({ checked: 1, updated: 1, failed: 0 });

      const [sent] = (await wiremock.bodies(
        'PUT',
        `/v2/agent/${row.gptmakerAgentId}/webhooks`,
      )) as Array<Record<string, string>>;
      expect(Object.keys(sent!)).toHaveLength(8);
      const token = decodeURIComponent(sent!.onTransfer!.split('?t=')[1]!);
      expect(sent!.onTransfer).toBe(
        `${BASE}/gptmaker/webhooks/onTransfer?t=${encodeURIComponent(token)}`,
      );
      expect(token).not.toBe('tok-velho');
      const [stored] = await db.select().from(agent).where(eq(agent.id, row.id));
      expect(stored!.webhookTokenHash).toBe(hashWebhookToken(token));
    });

    it('já em dia: só a leitura', async () => {
      const row = await newAgent('tok-1');
      await stubGet(row.gptmakerAgentId, webhookUrlsFor(BASE, 'tok-1'));
      await expect(sync.reconcile()).resolves.toEqual({ checked: 1, updated: 0, failed: 0 });
      expect(await wiremock.count('PUT', `/v2/agent/${row.gptmakerAgentId}/webhooks`)).toBe(0);
    });

    it('removidos e fora do GPTMaker ficam de fora; falha em um não para os outros', async () => {
      await newAgent('a', 'DELETED');
      await newAgent('b', 'OUT_OF_SYNC');
      const broken = await newAgent('c');
      await wiremock.stub({
        request: { method: 'GET', urlPath: `/v2/agent/${broken.gptmakerAgentId}/webhooks` },
        response: { status: 503, jsonBody: { error: 'fora' } },
      });
      const ok = await newAgent('d');
      await stubGet(ok.gptmakerAgentId, webhookUrlsFor(BASE, 'd'));

      await expect(sync.reconcile()).resolves.toEqual({ checked: 2, updated: 0, failed: 1 });
    });
  });
});
