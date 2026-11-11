import { describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import type { Env } from '../../config/env';
import type { Database } from '../../shared/database/database.module';
import type { GptMakerClient } from '../gptmaker';
import { CrmToolsSync } from './crm-tools.sync';
import { TOOLS_VERSION } from './mcp.controller';

const URL_NOW = 'https://api.exemplo.com';
const STATE_KEY = 'crm-tools:published';

interface Row {
  access: {
    agentId: string;
    tokenEncrypted: string | null;
    gptmakerMcpId: string | null;
    gptmakerIntentionId: string | null;
  };
  gptmakerAgentId: string;
}
const row = (agentId: string, overrides: Partial<Row['access']> = {}): Row => ({
  access: {
    agentId,
    tokenEncrypted: `token-${agentId}`,
    gptmakerMcpId: `mcp-${agentId}`,
    gptmakerIntentionId: `int-${agentId}`,
    ...overrides,
  },
  gptmakerAgentId: `gm-${agentId}`,
});

function setup(
  rows: Row[],
  tools: Record<string, Array<{ id: string; name: string; active: boolean }>>,
) {
  const redis = new FakeRedis();
  const db = {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => rows }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as unknown as Database;
  const gptmaker = {
    syncMcpTools: vi.fn(async () => {}),
    listMcpTools: vi.fn(async (mcpId: string) => tools[mcpId] ?? []),
    activateMcpTool: vi.fn(async () => {}),
    updateIntention: vi.fn(async () => {}),
    deleteMcp: vi.fn(async () => {}),
    addMcp: vi.fn(async (agent: string) => `mcp-novo-${agent}`),
  };
  const sync = new CrmToolsSync(gptmaker as unknown as GptMakerClient, db, redis.asRedis(), {
    API_PUBLIC_URL: URL_NOW,
    APP_ROLE: 'worker',
    CRM_TOOLS_ENABLED: true,
  } as Env);
  const published = (version: string, url = URL_NOW) =>
    redis.store.set(STATE_KEY, { value: JSON.stringify({ version, url }) });
  return { sync, gptmaker, redis, published };
}

describe('CrmToolsSync.sync', () => {
  it('só a versão das ferramentas mudou: relê as ferramentas e ativa as novas, que chegam inativas', async () => {
    const { sync, gptmaker, published } = setup([row('a1')], {
      'mcp-a1': [
        { id: 't1', name: 'negocios_do_cliente', active: true },
        { id: 't2', name: 'etapas_do_funil', active: true },
        { id: 't3', name: 'horarios_livres', active: false },
        { id: 't4', name: 'agendar_compromisso', active: false },
        { id: 't5', name: 'agendamentos_do_cliente', active: false },
      ],
    });
    published('2');
    await expect(sync.sync()).resolves.toEqual({ updated: 1, failed: 0 });

    expect(gptmaker.syncMcpTools).toHaveBeenCalledWith('mcp-a1');
    expect(gptmaker.activateMcpTool.mock.calls).toEqual([
      ['mcp-a1', 't3'],
      ['mcp-a1', 't4'],
      ['mcp-a1', 't5'],
    ]);
    // Nada é recriado: a conexão e a intenção ficam.
    expect(gptmaker.addMcp).not.toHaveBeenCalled();
    expect(gptmaker.updateIntention).not.toHaveBeenCalled();
  });

  it('a ordem importa: primeiro o sync-tools, depois a ativação', async () => {
    const order: string[] = [];
    const { sync, gptmaker, published } = setup([row('a1')], {
      'mcp-a1': [{ id: 't3', name: 'horarios_livres', active: false }],
    });
    gptmaker.syncMcpTools.mockImplementation(async () => void order.push('sync'));
    gptmaker.activateMcpTool.mockImplementation(async () => void order.push('ativar'));
    published('2');
    await sync.sync();
    expect(order).toEqual(['sync', 'ativar']);
  });

  it('guarda a versão publicada e a seguinte execução não faz nada', async () => {
    const { sync, gptmaker, redis, published } = setup([row('a1')], {});
    published('2');
    await sync.sync();
    expect(JSON.parse(redis.store.get(STATE_KEY)!.value)).toEqual({
      version: TOOLS_VERSION,
      url: URL_NOW,
    });
    gptmaker.syncMcpTools.mockClear();
    await expect(sync.sync()).resolves.toEqual({ updated: 0, failed: 0 });
    expect(gptmaker.syncMcpTools).not.toHaveBeenCalled();
  });

  it('a URL mudou: recria a conexão MCP e ativa o que estiver inativo', async () => {
    const { sync, gptmaker, published } = setup([row('a1')], {
      'mcp-novo-gm-a1': [{ id: 't3', name: 'horarios_livres', active: false }],
    });
    published(TOOLS_VERSION, 'https://antiga.exemplo.com');
    await expect(sync.sync()).resolves.toEqual({ updated: 1, failed: 0 });
    expect(gptmaker.updateIntention).toHaveBeenCalledWith('int-a1', expect.anything());
    expect(gptmaker.deleteMcp).toHaveBeenCalledWith('mcp-a1');
    expect(gptmaker.addMcp).toHaveBeenCalledOnce();
    expect(gptmaker.activateMcpTool).toHaveBeenCalledWith('mcp-novo-gm-a1', 't3');
    expect(gptmaker.syncMcpTools).not.toHaveBeenCalled();
  });

  it('falha num agente: conta a falha, segue com os outros e não grava a versão', async () => {
    const { sync, gptmaker, redis, published } = setup([row('a1'), row('a2')], {
      'mcp-a2': [{ id: 't9', name: 'horarios_livres', active: false }],
    });
    gptmaker.syncMcpTools.mockImplementationOnce(async () => {
      throw new Error('GPTMaker fora');
    });
    published('2');
    await expect(sync.sync()).resolves.toEqual({ updated: 1, failed: 1 });
    expect(gptmaker.activateMcpTool).toHaveBeenCalledWith('mcp-a2', 't9');
    // A versão antiga continua: a próxima execução tenta de novo.
    expect(JSON.parse(redis.store.get(STATE_KEY)!.value).version).toBe('2');
  });

  it('agente sem credencial ou sem conexão registrada é ignorado', async () => {
    const { sync, gptmaker, published } = setup(
      [row('a1', { tokenEncrypted: null }), row('a2', { gptmakerMcpId: null })],
      {},
    );
    published('2');
    await expect(sync.sync()).resolves.toEqual({ updated: 0, failed: 0 });
    expect(gptmaker.syncMcpTools).not.toHaveBeenCalled();
  });
});
