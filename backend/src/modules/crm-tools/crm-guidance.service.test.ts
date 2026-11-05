import { describe, expect, it } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import type { Database } from '../../shared/database/database.module';
import { CRM_GUIDANCE_DEFAULTS } from './crm-guidance.defaults';
import { CRM_GUIDANCE_CACHE_KEY, CrmGuidanceService } from './crm-guidance.service';

/** Só o `select(...).from(crm_tool_guidance)` da leitura das ferramentas. */
function fakeDb(rows: () => Array<{ key: string; text: string }>) {
  let reads = 0;
  const db = {
    select: () => ({
      from: async () => {
        reads++;
        return rows();
      },
    }),
  } as unknown as Database;
  return { db, reads: () => reads };
}

// Spec agent-crm-tools, "Orientações das respostas editáveis no backoffice".
describe('CrmGuidanceService.current', () => {
  it('sem edição devolve o padrão', async () => {
    const { db } = fakeDb(() => []);
    const service = new CrmGuidanceService(db, new FakeRedis().asRedis());
    expect(await service.current()).toEqual(CRM_GUIDANCE_DEFAULTS);
  });

  it('com edição devolve o texto editado e ignora chave desconhecida', async () => {
    const { db } = fakeDb(() => [
      { key: 'escopo_dados', text: 'Escopo novo.' },
      { key: 'chave_antiga', text: 'x' },
    ]);
    const service = new CrmGuidanceService(db, new FakeRedis().asRedis());
    const guidance = await service.current();
    expect(guidance.escopo_dados).toBe('Escopo novo.');
    expect(guidance.negocios_do_cliente).toBe(CRM_GUIDANCE_DEFAULTS.negocios_do_cliente);
    expect(guidance).not.toHaveProperty('chave_antiga');
  });

  it('guarda as edições no Redis e não volta ao banco dentro do TTL', async () => {
    const { db, reads } = fakeDb(() => [{ key: 'escopo_dados', text: 'Escopo novo.' }]);
    const redis = new FakeRedis();
    const service = new CrmGuidanceService(db, redis.asRedis());
    await service.current();
    await service.current();
    expect(reads()).toBe(1);
    expect(redis.store.get(CRM_GUIDANCE_CACHE_KEY)?.expiresAt).toBeDefined();
  });

  it('Redis fora lê do banco', async () => {
    const { db } = fakeDb(() => [{ key: 'escopo_dados', text: 'Escopo novo.' }]);
    const redis = new FakeRedis();
    redis.failing = true;
    const service = new CrmGuidanceService(db, redis.asRedis());
    expect((await service.current()).escopo_dados).toBe('Escopo novo.');
  });

  it('banco fora devolve o padrão sem falhar', async () => {
    const { db } = fakeDb(() => {
      throw new Error('banco fora');
    });
    const service = new CrmGuidanceService(db, new FakeRedis().asRedis());
    expect(await service.current()).toEqual(CRM_GUIDANCE_DEFAULTS);
  });
});
