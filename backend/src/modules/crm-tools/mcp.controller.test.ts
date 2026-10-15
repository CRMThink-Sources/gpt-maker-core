import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CrmAccessGuard, type CrmCaller } from './crm-access.guard';
import { CrmToolsService, type ToolResult } from './crm-tools.service';
import { McpController } from './mcp.controller';

const caller: CrmCaller = { tenantId: 't1', agentId: 'a1', installationId: 101 };

/** Ferramentas falsas: registram quem chamou e com o quê. */
class FakeTools {
  readonly seen: Array<{ tool: string; caller: CrmCaller; args: unknown[] }> = [];

  async clientDeals(who: CrmCaller, ...args: unknown[]): Promise<ToolResult> {
    this.seen.push({ tool: 'negocios_do_cliente', caller: who, args });
    if (args[0] !== 'c12.ok')
      return { outcome: 'not_found', count: 0, body: { erro: 'Cliente não encontrado.' } };
    return {
      outcome: 'ok',
      count: 1,
      body: { negocios: [{ titulo: 'Plano Pro' }], ha_mais: false },
    };
  }

  async pipelineStages(who: CrmCaller, ...args: unknown[]): Promise<ToolResult> {
    this.seen.push({ tool: 'etapas_do_funil', caller: who, args });
    return { outcome: 'ok', count: 1, body: { funis: [{ funil: 'Vendas', etapas: [] }] } };
  }
}

// Servidor MCP sem estado sobre HTTP real, com o cliente oficial (tarefa 5.4).
describe('McpController', () => {
  let app: INestApplication;
  let url: URL;
  const tools = new FakeTools();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: CrmToolsService, useValue: tools },
        { provide: ENV, useValue: { CRM_TOOLS_ENABLED: true } as Env },
      ],
    })
      .overrideGuard(CrmAccessGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const request = context.switchToHttp().getRequest();
          const headers = request.headers as Record<string, string>;
          if (headers.authorization !== 'Bearer cred') return false;
          request.crmCaller = caller;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    url = new URL(`${await app.getUrl()}/mcp`.replace('[::1]', '127.0.0.1'));
  });

  afterAll(async () => {
    await app?.close();
  });

  async function connect(token = 'cred') {
    const client = new Client({ name: 'teste', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }

  it('lista as duas ferramentas com descrições em pt-BR', async () => {
    const client = await connect();
    const { tools: listed } = await client.listTools();
    expect(listed.map((tool) => tool.name).sort()).toEqual([
      'etapas_do_funil',
      'negocios_do_cliente',
    ]);
    const deals = listed.find((tool) => tool.name === 'negocios_do_cliente')!;
    expect(deals.description).toContain('referência do cliente');
    expect(deals.inputSchema.required).toEqual(['cliente']);
    await client.close();
  });

  it('chama a ferramenta com o agente da credencial', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'negocios_do_cliente',
      arguments: { cliente: 'c12.ok', situacao: 'ganhos' },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      negocios: [{ titulo: 'Plano Pro' }],
      ha_mais: false,
    });
    expect(tools.seen.at(-1)).toEqual({
      tool: 'negocios_do_cliente',
      caller,
      args: ['c12.ok', 'ganhos'],
    });
    await client.close();
  });

  it('erro de negócio volta como resultado com isError, não como erro de protocolo', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'negocios_do_cliente',
      arguments: { cliente: 'inventada' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Cliente não encontrado');
    await client.close();
  });

  it('credencial inválida é recusada', async () => {
    await expect(connect('outra')).rejects.toThrow();
  });

  it('GET e DELETE respondem 405', async () => {
    const get = await fetch(url, { headers: { Authorization: 'Bearer cred' } });
    expect(get.status).toBe(405);
    const del = await fetch(url, { method: 'DELETE' });
    expect(del.status).toBe(405);
  });
});
