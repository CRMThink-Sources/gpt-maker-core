import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import type { Env } from '../../config/env';
import type { Database } from '../../shared/database/database.module';
import type { CrmCaller } from './crm-access.guard';
import { ToolRunner, type ToolResult } from './tool-runner';

const fakeDb = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Database;
const ok: ToolResult = { outcome: 'ok', count: 1, body: { x: 1 } };
const caller = (agentId: string): CrmCaller => ({
  tenantId: 'tenant-a',
  agentId,
  installationId: 101,
});

afterEach(() => vi.restoreAllMocks());

describe('ToolRunner', () => {
  it('o limite por agente soma as ferramentas do CRM e as de agenda', async () => {
    const redis = new FakeRedis().asRedis();
    const env = { CRM_TOOLS_RATE_PER_MINUTE: 4 } as Env;
    // Um executor por serviço (CRM e agenda), como em produção; o contador está no Redis.
    const crm = new ToolRunner(fakeDb, redis, env);
    const calendar = new ToolRunner(fakeDb, redis, env);
    const fn = vi.fn(async () => ok);

    const outcomes = [
      (await crm.run(caller('a1'), 'consultar_cliente', fn)).outcome,
      (await calendar.run(caller('a1'), 'horarios_livres', fn)).outcome,
      (await crm.run(caller('a1'), 'negocios_do_cliente', fn)).outcome,
      (await calendar.run(caller('a1'), 'agendar_compromisso', fn)).outcome,
      (await calendar.run(caller('a1'), 'agendamentos_do_cliente', fn)).outcome,
      (await crm.run(caller('a1'), 'etapas_do_funil', fn)).outcome,
    ];
    expect(outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'rate_limited', 'rate_limited']);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('o limite é por agente: outro agente não é afetado', async () => {
    const redis = new FakeRedis().asRedis();
    const runner = new ToolRunner(fakeDb, redis, { CRM_TOOLS_RATE_PER_MINUTE: 1 } as Env);
    await runner.run(caller('a1'), 'horarios_livres', async () => ok);
    expect((await runner.run(caller('a1'), 'horarios_livres', async () => ok)).outcome).toBe(
      'rate_limited',
    );
    expect((await runner.run(caller('a2'), 'horarios_livres', async () => ok)).outcome).toBe('ok');
  });

  it('o registro de cada chamada traz só ferramenta, resultado, quantidade e duração', async () => {
    const logs: unknown[][] = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
    }
    const runner = new ToolRunner(fakeDb, new FakeRedis().asRedis(), {
      CRM_TOOLS_RATE_PER_MINUTE: 60,
    } as Env);
    await runner.run(caller('a1'), 'agendar_compromisso', async () => ({
      outcome: 'ok',
      count: 1,
      body: { com: 'Ana Lima', cliente: 'Maria Souza', hora_inicio: '09:00' },
    }));

    const entry = logs.find(
      ([first]) => (first as { tool?: string }).tool === 'agendar_compromisso',
    );
    expect(Object.keys(entry![0] as object).sort()).toEqual([
      'count',
      'durationMs',
      'outcome',
      'tool',
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/Ana Lima|Maria Souza|09:00/);
  });
});
