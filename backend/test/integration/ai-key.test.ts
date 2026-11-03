import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env';
import { AiKeyService } from '../../src/modules/function-review/ai-key.service';
import { VibecodeError, type VibecodeClient } from '../../src/modules/vibecode';
import { configureFieldCipher } from '../../src/shared/crypto/field-cipher';
import type { Database } from '../../src/shared/database/database.module';
import { runMigrations } from '../../src/shared/database/migrate';
import * as schema from '../../src/shared/database/schema/index';
import { testPool } from '../support/postgres';

const { tenant, tenantAiKey } = schema;

const MODEL = 'bitrix/bitrixgpt-5.5';

/** Chave de IA do cliente (spec agent-knowledge-review; tarefa 4.4), com o Vibecode simulado. */
describe('chave de IA do cliente', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: AiKeyService;
  let platformKey: string | undefined;

  // Resposta do Vibecode simulado: modelos, escopos ou uma falha.
  let models: string[] | VibecodeError = [MODEL];
  let scopes: string[] | null = ['vibe:ai'];

  const vibecode = {
    listModels: async () => {
      if (models instanceof VibecodeError) throw models;
      return models;
    },
    scopes: async () => scopes,
  } as unknown as VibecodeClient;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    configureFieldCipher(randomBytes(32).toString('base64'));
    await runMigrations(postgres.getConnectionUri());
    pool = testPool(postgres.getConnectionUri());
    db = drizzle(pool, { schema });
    const env = {
      VIBECODE_REVIEW_MODEL: MODEL,
      REVIEW_CREDITS_PER_FIELD: 2,
      get VIBECODE_PLATFORM_API_KEY() {
        return platformKey;
      },
    } as unknown as Env;
    service = new AiKeyService(db as unknown as Database, env, vibecode);
  });

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  async function newTenant() {
    const code = randomBytes(4).toString('hex');
    const [row] = await db
      .insert(tenant)
      .values({
        installationId: code,
        memberId: code,
        domain: `${code}.bitrix24.com.br`,
        tenantCode: code,
      })
      .returning();
    return row!.id;
  }

  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { code?: string }) => error.code,
    );

  it('sem chave: não configurada, com o preço por campo e a chave da CRMThink', async () => {
    const tenantId = await newTenant();
    platformKey = undefined;
    expect(await service.view(tenantId)).toEqual({
      configured: false,
      last4: null,
      verifiedAt: null,
      creditsPerField: 2,
      platformAvailable: false,
    });
    platformKey = 'vibe_api_da_crmthink';
    expect((await service.view(tenantId)).platformAvailable).toBe(true);
  });

  it('salva a chave válida e mostra só o final e o teste, nunca a chave', async () => {
    const tenantId = await newTenant();
    const view = await service.save(tenantId, 'vibe_api_segredo1a2b');
    expect(view).toMatchObject({ configured: true, last4: '1a2b', creditsPerField: 2 });
    expect(new Date(view.verifiedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.stringify(view)).not.toContain('segredo');
    expect(JSON.stringify(await service.view(tenantId))).not.toContain('segredo');

    // Em repouso: cifrada. Para a aplicação: em claro, só por `find`.
    const raw = await pool.query<{ api_key: string }>(
      'select api_key from tenant_ai_key where tenant_id = $1',
      [tenantId],
    );
    expect(raw.rows[0]!.api_key).toMatch(/^v1:/);
    expect(await service.find(tenantId)).toBe('vibe_api_segredo1a2b');
  });

  it('troca a chave sem criar outra linha', async () => {
    const tenantId = await newTenant();
    await service.save(tenantId, 'vibe_api_primeira0001');
    const view = await service.save(tenantId, 'vibe_api_segunda0002');
    expect(view.last4).toBe('0002');
    expect(await service.find(tenantId)).toBe('vibe_api_segunda0002');
    const rows = await pool.query('select 1 from tenant_ai_key where tenant_id = $1', [tenantId]);
    expect(rows.rowCount).toBe(1);
  });

  it('recusa a chave inválida e não salva nada', async () => {
    const tenantId = await newTenant();
    models = new VibecodeError('AI_KEY_INVALID', 'models', 'HTTP 401', { status: 401 });
    expect(await refusal(service.save(tenantId, 'vibe_api_errada0000'))).toBe('AI_KEY_INVALID');
    models = [MODEL];
    expect((await service.view(tenantId)).configured).toBe(false);
    expect(await service.find(tenantId)).toBeNull();
  });

  it('recusa chave sem o escopo, sem o modelo e com escopos demais', async () => {
    const tenantId = await newTenant();
    scopes = ['vibe:storage'];
    expect(await refusal(service.save(tenantId, 'vibe_api_semescopo00'))).toBe('AI_KEY_SCOPE');
    scopes = ['vibe:ai', 'crm'];
    expect(await refusal(service.save(tenantId, 'vibe_api_escopodemais'))).toBe('AI_KEY_SCOPE');
    scopes = ['vibe:ai'];
    models = ['bitrix/outro'];
    expect(await refusal(service.save(tenantId, 'vibe_api_semmodelo00'))).toBe(
      'AI_MODEL_UNAVAILABLE',
    );
    models = [MODEL];
    expect(await service.find(tenantId)).toBeNull();
  });

  it('chave recusada não apaga a que já estava salva', async () => {
    const tenantId = await newTenant();
    await service.save(tenantId, 'vibe_api_boa00000001');
    scopes = ['crm'];
    expect(await refusal(service.save(tenantId, 'vibe_api_ruim0000002'))).toBe('AI_KEY_SCOPE');
    scopes = ['vibe:ai'];
    expect(await service.find(tenantId)).toBe('vibe_api_boa00000001');
  });

  it('remove a chave e a remoção é idempotente', async () => {
    const tenantId = await newTenant();
    await service.save(tenantId, 'vibe_api_remover00003');
    await service.remove(tenantId);
    expect((await service.view(tenantId)).configured).toBe(false);
    await expect(service.remove(tenantId)).resolves.toBeUndefined();
  });

  it('cada tenant vê só a própria chave', async () => {
    const a = await newTenant();
    const b = await newTenant();
    await service.save(a, 'vibe_api_do_tenant_a1');
    expect((await service.view(b)).configured).toBe(false);
    expect(await service.find(b)).toBeNull();
    expect(await service.find(a)).toBe('vibe_api_do_tenant_a1');
    const [count] = await db.select().from(tenantAiKey);
    expect(count).toBeDefined();
  });
});
