import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CalendarToolsService } from './calendar-tools.service';
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

/** Ferramentas de agenda falsas: registram a chamada e devolvem um resultado fixo. */
class FakeCalendar {
  readonly seen: Array<{ tool: string; caller: CrmCaller; input: unknown }> = [];

  async freeSlots(who: CrmCaller, input: unknown): Promise<ToolResult> {
    this.seen.push({ tool: 'horarios_livres', caller: who, input });
    return {
      outcome: 'ok',
      count: 1,
      body: { horarios: [{ data: '2026-11-24', hora_inicio: '09:00' }] },
    };
  }

  async book(who: CrmCaller, input: unknown): Promise<ToolResult> {
    this.seen.push({ tool: 'agendar_compromisso', caller: who, input });
    return { outcome: 'ok', count: 1, body: { agendado: true } };
  }

  async clientAppointments(who: CrmCaller, input: unknown): Promise<ToolResult> {
    this.seen.push({ tool: 'agendamentos_do_cliente', caller: who, input });
    return { outcome: 'not_found', count: 0, body: { erro: 'Cliente não encontrado.' } };
  }
}

// Servidor MCP sem estado sobre HTTP real, com o cliente oficial (tarefa 5.4).
describe('McpController', () => {
  let app: INestApplication;
  let url: URL;
  const tools = new FakeTools();
  const calendar = new FakeCalendar();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: CrmToolsService, useValue: tools },
        { provide: CalendarToolsService, useValue: calendar },
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

  it('lista as ferramentas do CRM e as de agenda com descrições em pt-BR', async () => {
    const client = await connect();
    const { tools: listed } = await client.listTools();
    expect(listed.map((tool) => tool.name).sort()).toEqual([
      'agendamentos_do_cliente',
      'agendar_compromisso',
      'etapas_do_funil',
      'horarios_livres',
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

  it('as ferramentas de agenda pedem o que precisam e orientam a confirmar com o cliente', async () => {
    const client = await connect();
    const { tools: listed } = await client.listTools();
    const byName = Object.fromEntries(listed.map((tool) => [tool.name, tool]));

    expect(byName.horarios_livres!.inputSchema.required ?? []).toEqual([]);
    expect(Object.keys(byName.horarios_livres!.inputSchema.properties!).sort()).toEqual([
      'a_partir_de',
      'cliente',
    ]);
    expect(byName.agendar_compromisso!.inputSchema.required).toEqual(
      expect.arrayContaining(['cliente', 'inicio']),
    );
    expect(byName.agendar_compromisso!.inputSchema.required).not.toContain('assunto');
    expect(byName.agendamentos_do_cliente!.inputSchema.required).toEqual(['cliente']);
    // O agente só pode informar cliente, início, assunto e data: nada de usuário, agenda ou ids.
    const allowed = new Set(['cliente', 'inicio', 'assunto', 'a_partir_de']);
    for (const name of ['horarios_livres', 'agendar_compromisso', 'agendamentos_do_cliente']) {
      const fields = Object.keys(byName[name]!.inputSchema.properties!);
      expect(fields.every((field) => allowed.has(field))).toBe(true);
    }
    expect(byName.agendar_compromisso!.description).toContain('confirmar a data e a hora');
    expect(byName.agendar_compromisso!.description).toContain('horarios_livres');
    expect(byName.horarios_livres!.description).toContain('a equipe vai retornar');
    await client.close();
  });

  it('horarios_livres chega ao serviço com o agente da credencial e a data renomeada', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'horarios_livres',
      arguments: { cliente: 'c12.ok', a_partir_de: '2026-11-25' },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      horarios: [{ data: '2026-11-24', hora_inicio: '09:00' }],
    });
    expect(calendar.seen.at(-1)).toEqual({
      tool: 'horarios_livres',
      caller,
      input: { cliente: 'c12.ok', aPartirDe: '2026-11-25' },
    });
    await client.close();
  });

  it('agendar_compromisso repassa cliente, início e assunto, e só eles', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'agendar_compromisso',
      arguments: {
        cliente: 'c12.ok',
        inicio: '2026-11-24 09:00',
        assunto: 'Visita',
        // Campos que o modelo tente passar por conta própria não chegam ao serviço.
        ownerId: 999,
        usuario: 999,
      },
    });
    expect(result.isError).toBeUndefined();
    expect(calendar.seen.at(-1)).toEqual({
      tool: 'agendar_compromisso',
      caller,
      input: { cliente: 'c12.ok', inicio: '2026-11-24 09:00', assunto: 'Visita' },
    });
    await client.close();
  });

  it('agendar_compromisso sem o início é recusado antes de chegar ao serviço', async () => {
    const client = await connect();
    const before = calendar.seen.length;
    const result = await client.callTool({
      name: 'agendar_compromisso',
      arguments: { cliente: 'c12.ok' },
    });
    expect(result.isError).toBe(true);
    expect(calendar.seen).toHaveLength(before);
    await client.close();
  });

  it('erro de negócio da agenda volta como resultado com isError', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'agendamentos_do_cliente',
      arguments: { cliente: 'inventada' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Cliente não encontrado');
    expect(calendar.seen.at(-1)).toMatchObject({ tool: 'agendamentos_do_cliente', caller });
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
