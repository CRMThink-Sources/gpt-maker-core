import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { FunctionTemplateDraft } from '@gptmaker/contracts';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { ZodValidationPipe } from 'nestjs-zod';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../../src/config/config.module';
import type { Env } from '../../src/config/env';
import { FunctionCatalog } from '../../src/modules/agent-functions/function-catalog.service';
import { FunctionSandbox } from '../../src/modules/agent-functions/function-sandbox';
import { AdminAuthController } from '../../src/modules/backoffice/admin-auth.controller';
import { AdminAuthGuard } from '../../src/modules/backoffice/admin-auth.guard';
import { AdminAuthService } from '../../src/modules/backoffice/admin-auth.service';
import { AuditService } from '../../src/modules/backoffice/audit.service';
import { totpCode } from '../../src/modules/backoffice/credentials';
import {
  FunctionBlocksAdminController,
  FunctionsAdminController,
} from '../../src/modules/backoffice/functions-admin.controller';
import { FunctionsAdminService } from '../../src/modules/backoffice/functions-admin.service';
import { OperatorService } from '../../src/modules/backoffice/operator.service';
import { contextMiddleware } from '../../src/shared/context/context.middleware';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import { DB } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { ApiExceptionFilter } from '../../src/shared/http/api-exception.filter';
import { REDIS } from '../../src/shared/redis/redis.module';

const {
  agent,
  agentFunctionBlock,
  agentFunctionConfig,
  agentFunctionTemplate,
  agentFunctionTemplateVersion,
  aiModel,
  auditLog,
  tenant,
} = schema;

const H = { 'X-Backoffice': '1' };
const currentStep = () => Math.floor(Date.now() / 30_000);

/** Template mínimo: um campo, uma escolha e o trecho do bloco de dúvida. */
const draft = (overrides: Partial<FunctionTemplateDraft> = {}): FunctionTemplateDraft => ({
  agentType: 'SUPPORT',
  settings: { enabledHumanTransfer: true },
  profile: { jobName: '{{empresa.nome}}', jobDescription: '', jobSite: '' },
  blocks: ['duvida'],
  crmAccess: false,
  fields: [
    {
      kind: 'TEXT',
      id: 'empresa.nome',
      label: 'Empresa',
      required: true,
      maxLength: 100,
      multiline: false,
    },
    {
      kind: 'CHOICE',
      id: 'suporte.tom',
      label: 'Tom',
      required: true,
      options: [
        { value: 'formal', label: 'Formal', snippet: 'Use linguagem formal.' },
        { value: 'leve', label: 'Leve', snippet: 'Use linguagem leve.' },
      ],
    },
  ],
  behavior: 'Você atende pela {{empresa.nome}}.\n{{suporte.tom}}\n{{bloco.duvida}}',
  intentions: [],
  ...overrides,
});

const BLOCK = {
  fields: [],
  behavior: 'Se não souber, use a ação Registrar dúvida.',
  intentions: [
    {
      key: 'registrar_duvida',
      name: 'Registrar dúvida',
      whenToUse: 'Quando a informação não estiver na base.',
      fields: [{ name: 'Pergunta', description: '', type: 'STRING', required: true }],
      actions: [{ type: 'TIMELINE_COMMENT', config: { text: 'Dúvida: {{fields.pergunta}}' } }],
      responseMode: 'INSTRUCTIONS',
      instructions: 'Diga que vai verificar.',
    },
  ],
};

// Templates de função no backoffice (specs agent-function-templates e admin-backoffice; 3.1, 3.2).
describe('backoffice: templates de função', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let app: INestApplication;
  let operators: OperatorService;
  let admin: { id: string; cookie: string };
  let code: string;

  async function signIn(role: 'ADMIN' | 'SUPPORT') {
    const email = `op-${randomBytes(3).toString('hex')}@empresa.com`;
    const created = await operators.create({ email, name: `Op ${role}`, role });
    const first = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .set(H)
      .send({ email, password: created.temporaryPassword })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/admin/auth/totp')
      .set(H)
      .send({ challenge: first.body.challenge, code: totpCode(first.body.secret, currentStep()) })
      .expect(200);
    return { id: created.operator.id, cookie: String(second.headers['set-cookie']).split(';')[0]! };
  }

  const http = (cookie = admin.cookie) => ({
    get: (path: string) => request(app.getHttpServer()).get(path).set(H).set('Cookie', cookie),
    post: (path: string, body: object = {}) =>
      request(app.getHttpServer()).post(path).set(H).set('Cookie', cookie).send(body),
    put: (path: string, body: object) =>
      request(app.getHttpServer()).put(path).set(H).set('Cookie', cookie).send(body),
    delete: (path: string) =>
      request(app.getHttpServer()).delete(path).set(H).set('Cookie', cookie),
  });

  async function createBlock(publish = true) {
    await http()
      .post('/admin/function-blocks', { code: 'duvida', name: 'Dúvida', draft: BLOCK })
      .expect(201);
    if (publish) await http().post('/admin/function-blocks/duvida/publish').expect(200);
  }

  async function createTemplate(content = draft()) {
    await http()
      .post('/admin/functions', {
        code,
        name: 'Suporte',
        description: 'Resolve dúvidas',
        draft: content,
      })
      .expect(201);
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
    const env = {
      BACKOFFICE_SESSION_IDLE_MINUTES: 120,
      BACKOFFICE_SESSION_MAX_HOURS: 12,
      BACKOFFICE_TRUSTED_DEVICE_DAYS: 30,
      BACKOFFICE_COOKIE_SECURE: false,
      BACKOFFICE_TOTP_ISSUER: 'ThinkFlow AI Backoffice',
    } as Env;
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuthController, FunctionsAdminController, FunctionBlocksAdminController],
      providers: [
        AdminAuthService,
        AdminAuthGuard,
        AuditService,
        OperatorService,
        FunctionCatalog,
        FunctionsAdminService,
        // O sandbox tem teste próprio; aqui só a rota e a auditoria.
        {
          provide: FunctionSandbox,
          useValue: { publish: async () => ({ gptmakerAgentId: 'gm-sandbox', compiled: {} }) },
        },
        { provide: ENV, useValue: env },
        { provide: DB, useValue: db },
        { provide: REDIS, useValue: redis },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(contextMiddleware);
    await app.init();
    operators = moduleRef.get(OperatorService);
  }, 120_000);

  beforeEach(async () => {
    await redis.flushall();
    await db.delete(auditLog);
    await db.delete(agentFunctionConfig);
    await db.delete(agent);
    await db.delete(agentFunctionTemplateVersion);
    await db.delete(agentFunctionTemplate);
    await db.delete(agentFunctionBlock);
    admin = await signIn('ADMIN');
    code = `SUP_${randomBytes(3).toString('hex').toUpperCase()}`;
  });

  afterAll(async () => {
    await app?.close();
    redis?.disconnect();
    await pool?.end();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
  });

  describe('acesso', () => {
    it('sem sessão do backoffice: recusado', async () => {
      await request(app.getHttpServer()).get('/admin/functions').set(H).expect(401);
      await request(app.getHttpServer())
        .post('/admin/function-blocks')
        .set(H)
        .send({ code: 'x', name: 'x', draft: BLOCK })
        .expect(401);
    });

    it('SUPPORT consulta, mas não altera', async () => {
      const support = await signIn('SUPPORT');
      await http(support.cookie).get('/admin/functions').expect(200);
      await http(support.cookie).get('/admin/function-blocks').expect(200);
      await http(support.cookie)
        .post('/admin/function-blocks', { code: 'duvida', name: 'Dúvida', draft: BLOCK })
        .expect(403);
      await http(support.cookie)
        .post('/admin/functions', { code, name: 'S', description: 'd', draft: draft() })
        .expect(403);
    });
  });

  describe('blocos', () => {
    it('rascunho, publicação e auditoria', async () => {
      await createBlock(false);
      const saved = await http()
        .put('/admin/function-blocks/duvida/draft', {
          draft: { ...BLOCK, behavior: 'Registre a dúvida.' },
        })
        .expect(200);
      expect(saved.body).toMatchObject({ content: null, publishedAt: null });

      const published = await http().post('/admin/function-blocks/duvida/publish').expect(200);
      expect(published.body.content.behavior).toBe('Registre a dúvida.');

      const actions = await db.select({ action: auditLog.action }).from(auditLog);
      expect(
        actions.map((row) => row.action).filter((a) => a.startsWith('function-block')),
      ).toEqual(['function-block.create', 'function-block.draft', 'function-block.publish']);
    });

    it('código repetido: recusado', async () => {
      await createBlock();
      const res = await http()
        .post('/admin/function-blocks', { code: 'duvida', name: 'Outro', draft: BLOCK })
        .expect(409);
      expect(res.body.error.code).toBe('FUNCTION_BLOCK_EXISTS');
    });

    it('excluir: recusado em uso; depois some, o código fica reservado e as versões seguem', async () => {
      await createBlock();
      await createTemplate();
      await http().post(`/admin/functions/${code}/publish`).expect(200);

      const inUse = await http().delete('/admin/function-blocks/duvida').expect(409);
      expect(inUse.body.error).toMatchObject({
        code: 'FUNCTION_BLOCK_IN_USE',
        details: { usedBy: [code] },
      });

      await http()
        .put(`/admin/functions/${code}/draft`, {
          draft: draft({
            blocks: [],
            behavior: 'Você atende pela {{empresa.nome}}.\n{{suporte.tom}}',
          }),
        })
        .expect(200);
      await http().delete('/admin/function-blocks/duvida').expect(204);

      const list = await http().get('/admin/function-blocks').expect(200);
      expect(list.body).toEqual([]);
      await http().get('/admin/function-blocks/duvida').expect(404);
      const again = await http()
        .post('/admin/function-blocks', { code: 'duvida', name: 'Outro', draft: BLOCK })
        .expect(409);
      expect(again.body.error.code).toBe('FUNCTION_BLOCK_EXISTS');
      // A versão publicada guarda o bloco já expandido.
      const v1 = await http().get(`/admin/functions/${code}/versions/1`).expect(200);
      expect(v1.body.content.intentions.map((i: { key: string }) => i.key)).toEqual([
        'registrar_duvida',
      ]);

      const actions = await db.select({ action: auditLog.action }).from(auditLog);
      expect(actions.map((row) => row.action)).toContain('function-block.delete');
    });

    it('SUPPORT não exclui', async () => {
      await createBlock();
      const support = await signIn('SUPPORT');
      await http(support.cookie).delete('/admin/function-blocks/duvida').expect(403);
    });
  });

  describe('templates', () => {
    it('publicar nova versão não altera as anteriores nem os agentes', async () => {
      await createBlock();
      await createTemplate();
      const v1 = await http().post(`/admin/functions/${code}/publish`).expect(200);
      expect(v1.body.latestVersion).toBe(1);

      // Um agente publicado na versão 1.
      const suffix = randomBytes(3).toString('hex');
      const [owner] = await db
        .insert(tenant)
        .values({
          installationId: suffix,
          memberId: suffix,
          domain: `${suffix}.b24.com`,
          tenantCode: suffix,
        })
        .returning();
      const [model] = await db
        .insert(aiModel)
        .values({ code: `M_${suffix}`, displayName: 'M', creditsPerResponse: 1 })
        .returning();
      const [row] = await db
        .insert(agent)
        .values({
          tenantId: owner!.id,
          gptmakerAgentId: `gm-${randomUUID()}`,
          name: 'Bot',
          type: 'SUPPORT',
          communicationType: 'NORMAL',
          modelId: model!.id,
          webhookTokenHash: randomUUID(),
        })
        .returning();
      const [template] = await db
        .select()
        .from(agentFunctionTemplate)
        .where(eq(agentFunctionTemplate.code, code));
      const [version1] = await db
        .select()
        .from(agentFunctionTemplateVersion)
        .where(eq(agentFunctionTemplateVersion.templateId, template!.id));
      await db.insert(agentFunctionConfig).values({
        agentId: row!.id,
        tenantId: owner!.id,
        templateId: template!.id,
        versionId: version1!.id,
      });

      await http()
        .put(`/admin/functions/${code}/draft`, {
          draft: draft({ behavior: 'Você atende pela {{empresa.nome}}.\n{{suporte.tom}}' }),
        })
        .expect(200);
      const v2 = await http().post(`/admin/functions/${code}/publish`).expect(200);
      expect(v2.body.latestVersion).toBe(2);
      expect(
        v2.body.versions.map((v: { version: number; agents: number }) => [v.version, v.agents]),
      ).toEqual([
        [2, 0],
        [1, 1],
      ]);
      expect(v2.body.agents).toBe(1);

      const first = await http().get(`/admin/functions/${code}/versions/1`).expect(200);
      expect(first.body.content.behavior).toContain('Registrar dúvida');
      expect(first.body.content.intentions.map((i: { key: string }) => i.key)).toEqual([
        'registrar_duvida',
      ]);
      expect('blocks' in first.body.content).toBe(false);
      const [config] = await db
        .select()
        .from(agentFunctionConfig)
        .where(eq(agentFunctionConfig.agentId, row!.id));
      expect(config!.versionId).toBe(version1!.id);

      const diff = await http().get(`/admin/functions/${code}/versions/1/diff/2`).expect(200);
      expect(diff.body.behavior).toContainEqual({
        op: 'remove',
        text: 'Se não souber, use a ação Registrar dúvida.',
      });
    });

    it('rollback publica o conteúdo antigo como nova versão', async () => {
      await createBlock();
      await createTemplate();
      const published = await http().post(`/admin/functions/${code}/publish`).expect(200);
      await http()
        .put(`/admin/functions/${code}/draft`, {
          draft: draft({ behavior: 'Outro texto {{empresa.nome}} {{suporte.tom}}' }),
        })
        .expect(200);
      await http().post(`/admin/functions/${code}/publish`).expect(200);

      const restored = await http().post(`/admin/functions/${code}/versions/1/restore`).expect(200);
      expect(restored.body.latestVersion).toBe(3);
      const [v1, v3] = await Promise.all([
        http().get(`/admin/functions/${code}/versions/1`),
        http().get(`/admin/functions/${code}/versions/3`),
      ]);
      expect(v3.body.content).toEqual(v1.body.content);
      expect(restored.body.versions).toHaveLength(3);
      // O rascunho volta ao da v1, com o bloco: publicar de novo não traz a v2 de volta.
      expect(restored.body.draft).toEqual(published.body.draft);
      await http().post(`/admin/functions/${code}/publish`).expect(200);
      const v4 = await http().get(`/admin/functions/${code}/versions/4`);
      expect(v4.body.content).toEqual(v1.body.content);

      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'function.restore'));
      expect(audit!.after).toMatchObject({ version: 3, restoredFrom: 1, draftRestored: true });
    });

    it('rollback mantém o rascunho quando o bloco mudou depois da versão', async () => {
      await createBlock();
      await createTemplate();
      await http().post(`/admin/functions/${code}/publish`).expect(200);
      await http()
        .put('/admin/function-blocks/duvida/draft', {
          draft: { ...BLOCK, behavior: 'Registre a dúvida.' },
        })
        .expect(200);
      await http().post('/admin/function-blocks/duvida/publish').expect(200);
      const edited = await http()
        .put(`/admin/functions/${code}/draft`, {
          draft: draft({
            behavior: 'Outro texto {{empresa.nome}} {{suporte.tom}} {{bloco.duvida}}',
          }),
        })
        .expect(200);

      // A v1 tem o texto antigo do bloco: remontar perderia o {{bloco.duvida}} do rascunho.
      const restored = await http().post(`/admin/functions/${code}/versions/1/restore`).expect(200);
      expect(restored.body.latestVersion).toBe(2);
      expect(restored.body.draft).toEqual(edited.body.draft);
      const [audit] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'function.restore'));
      expect(audit!.after).toMatchObject({ draftRestored: false });
    });

    it('pior caso acima do limite: recusado com a contribuição de cada campo', async () => {
      await createBlock();
      const big = draft();
      big.fields[0] = { ...big.fields[0]!, maxLength: 3000 } as (typeof big.fields)[number];
      await createTemplate(big);

      const res = await http().post(`/admin/functions/${code}/publish`).expect(422);
      expect(res.body.error.code).toBe('FUNCTION_TEMPLATE_INVALID');
      expect(res.body.error.details.errors[0]).toMatch(
        /^pior caso do comportamento com \d+ caracteres/,
      );
      expect(res.body.error.details.budget.markers['empresa.nome']).toBe(3000);
      expect((await http().get(`/admin/functions/${code}`)).body.latestVersion).toBeNull();
    });

    it('marcador de campo inexistente e bloco não publicado: recusado', async () => {
      await createBlock(false);
      await createTemplate(
        draft({ behavior: '{{empresa.nome}} {{suporte.tom}} {{suporte.nada}} {{bloco.duvida}}' }),
      );

      const res = await http().post(`/admin/functions/${code}/publish`).expect(422);
      expect(res.body.error.details.errors).toEqual(
        expect.arrayContaining([
          'bloco não publicado: duvida',
          'marcador sem campo em comportamento: {{suporte.nada}}',
        ]),
      );
    });

    it('rascunho inválido: recusado na gravação', async () => {
      await createBlock();
      await createTemplate();
      await http()
        .put(`/admin/functions/${code}/draft`, { draft: { ...draft(), fields: [] } })
        .expect(400);
    });

    it('sandbox: só ADMIN, com auditoria', async () => {
      await createBlock();
      await createTemplate();
      const support = await signIn('SUPPORT');
      await http(support.cookie).post(`/admin/functions/${code}/sandbox`, {}).expect(403);
      const res = await http()
        .post(`/admin/functions/${code}/sandbox`, { answers: {} })
        .expect(200);
      expect(res.body.gptmakerAgentId).toBe('gm-sandbox');
      const actions = (await db.select({ action: auditLog.action }).from(auditLog)).map(
        (r) => r.action,
      );
      expect(actions).toContain('function.sandbox');
    });

    it('inativar, reativar e excluir sem agentes; código fica reservado', async () => {
      await createBlock();
      await createTemplate();
      const off = await http().post(`/admin/functions/${code}/inactivate`).expect(200);
      expect(off.body.active).toBe(false);
      const on = await http().post(`/admin/functions/${code}/activate`).expect(200);
      expect(on.body.active).toBe(true);

      await http().delete(`/admin/functions/${code}`).expect(204);
      await http().get(`/admin/functions/${code}`).expect(404);
      const list = await http().get('/admin/functions').expect(200);
      expect(list.body.map((row: { code: string }) => row.code)).not.toContain(code);
      const again = await http()
        .post('/admin/functions', { code, name: 'X', description: 'X', draft: draft() })
        .expect(409);
      expect(again.body.error.code).toBe('FUNCTION_EXISTS');

      const actions = (await db.select({ action: auditLog.action }).from(auditLog)).map(
        (r) => r.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining(['function.inactivate', 'function.activate', 'function.delete']),
      );
    });

    it('restringir a portais: só ADMIN, valida o portal e audita', async () => {
      await createBlock();
      await createTemplate();
      const hex = randomBytes(3).toString('hex');
      const [portal] = await db
        .insert(tenant)
        .values({ installationId: hex, memberId: hex, domain: `${hex}.b24.com`, tenantCode: hex })
        .returning();

      const support = await signIn('SUPPORT');
      await http(support.cookie)
        .put(`/admin/functions/${code}/tenants`, { tenantIds: [portal!.id] })
        .expect(403);

      const restricted = await http()
        .put(`/admin/functions/${code}/tenants`, { tenantIds: [portal!.id] })
        .expect(200);
      expect(restricted.body.tenants).toEqual([{ id: portal!.id, domain: portal!.domain }]);
      const list = await http().get('/admin/functions').expect(200);
      expect(list.body.find((row: { code: string }) => row.code === code).tenants).toHaveLength(1);

      const unknown = await http()
        .put(`/admin/functions/${code}/tenants`, { tenantIds: [randomUUID()] })
        .expect(422);
      expect(unknown.body.error.code).toBe('TENANT_NOT_FOUND');

      const all = await http()
        .put(`/admin/functions/${code}/tenants`, { tenantIds: [] })
        .expect(200);
      expect(all.body.tenants).toEqual([]);
      const actions = (await db.select({ action: auditLog.action }).from(auditLog)).map(
        (r) => r.action,
      );
      expect(actions).toContain('function.tenants');
    });

    it('nova função a partir de outra: cópia independente, sem versões', async () => {
      await createBlock();
      await createTemplate();
      await http().post(`/admin/functions/${code}/publish`).expect(200);
      const copy = `${code}_COPIA`;

      const created = await http()
        .post('/admin/functions', {
          code: copy,
          name: 'Suporte técnico',
          description: 'Cópia',
          copyFrom: code,
        })
        .expect(201);
      expect(created.body).toMatchObject({
        code: copy,
        latestVersion: null,
        versions: [],
        draft: draft(),
      });

      await http()
        .put(`/admin/functions/${copy}/draft`, {
          draft: draft({ behavior: 'Outro {{empresa.nome}} {{suporte.tom}}' }),
        })
        .expect(200);
      const original = await http().get(`/admin/functions/${code}`).expect(200);
      expect(original.body.draft.behavior).toBe(draft().behavior);

      await http()
        .post('/admin/functions', {
          code: `${code}_X`,
          name: 'X',
          description: 'X',
          copyFrom: 'NAO_EXISTE',
        })
        .expect(404);
    });

    it('campo publicado: aparece travado e não muda de tipo', async () => {
      await createBlock();
      await createTemplate();
      const published = await http().post(`/admin/functions/${code}/publish`).expect(200);
      expect(published.body.published['suporte.tom']).toEqual({
        kind: 'CHOICE',
        options: ['formal', 'leve'],
      });
      expect(published.body.published['empresa.nome']).toEqual({ kind: 'TEXT', options: [] });
      // A intenção do bloco saiu na versão: a chave fica travada no editor.
      expect(published.body.publishedIntentions).toEqual(['registrar_duvida']);

      const changed = draft();
      changed.fields[1] = {
        kind: 'TEXT',
        id: 'suporte.tom',
        label: 'Tom',
        required: true,
        maxLength: 50,
        multiline: false,
      };
      const res = await http()
        .put(`/admin/functions/${code}/draft`, { draft: changed })
        .expect(422);
      expect(res.body.error).toMatchObject({
        code: 'FUNCTION_FIELD_LOCKED',
        details: { fields: [{ id: 'suporte.tom', from: 'CHOICE', to: 'TEXT' }] },
      });
      // Remover o campo continua permitido.
      const removed = draft({ behavior: 'Você atende pela {{empresa.nome}}.\n{{bloco.duvida}}' });
      removed.fields = [removed.fields[0]!];
      await http().put(`/admin/functions/${code}/draft`, { draft: removed }).expect(200);
    });

    it('prévia do rascunho com respostas de exemplo', async () => {
      await createBlock();
      await createTemplate();
      const res = await http()
        .post(`/admin/functions/${code}/preview`, {
          answers: { 'empresa.nome': 'Loja X', 'suporte.tom': 'leve' },
          agentName: 'Ana',
        })
        .expect(200);
      expect(res.body.compiled.behavior).toBe(
        'Você atende pela Loja X.\nUse linguagem leve.\nSe não souber, use a ação Registrar dúvida.',
      );
      expect(res.body.compiled.intentions.map((i: { key: string }) => i.key)).toEqual([
        'registrar_duvida',
      ]);
      expect(res.body.check.errors).toEqual([]);
      expect(res.body.blockErrors).toEqual([]);
    });
  });
});
