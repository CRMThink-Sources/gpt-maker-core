import {
  All,
  Controller,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CrmAccessGuard, type CrmCaller, CurrentCaller } from './crm-access.guard';
import { CrmToolsService, DEAL_SITUATIONS, type ToolResult } from './crm-tools.service';
import { MCP_PATH } from './system-intention';

/**
 * Versão das ferramentas publicadas: mudar nome, descrição ou esquema exige incrementar, para o
 * `CrmToolsSync` pedir ao GPTMaker que releia (`sync-tools`).
 */
export const TOOLS_VERSION = '2';

/** Ferramentas do servidor MCP, ligadas ao agente que chama (design S8). */
export function buildMcpServer(tools: CrmToolsService, caller: CrmCaller): McpServer {
  const server = new McpServer({ name: 'crm-bitrix24', version: TOOLS_VERSION });

  server.registerTool(
    'negocios_do_cliente',
    {
      title: 'Negócios do cliente no CRM',
      description:
        'Lista os negócios do cliente no CRM (até 10, do mais recente para o mais antigo), com ' +
        'funil, etapa, situação e valor. Use para histórico, compras anteriores, negócios ganhos ' +
        'ou perdidos. Precisa da referência do cliente devolvida por "Consultar cliente no CRM"; ' +
        'sem ela, consulte o cliente primeiro. Traz só os negócios: não há histórico de atividades ' +
        'nem documentos.',
      inputSchema: {
        cliente: z
          .string()
          .describe('Referência do cliente, exatamente como veio em "Consultar cliente no CRM"'),
        situacao: z
          .enum(DEAL_SITUATIONS as [string, ...string[]])
          .optional()
          .describe('em_andamento, ganhos, perdidos ou todos (padrão: todos)'),
      },
    },
    async ({ cliente, situacao }) =>
      asToolResult(
        await tools.clientDeals(
          caller,
          cliente,
          situacao as Parameters<CrmToolsService['clientDeals']>[2],
        ),
      ),
  );

  server.registerTool(
    'etapas_do_funil',
    {
      title: 'Etapas dos funis de venda',
      description:
        'Mostra os funis de venda da empresa e as etapas de cada um, na ordem, com a situação ' +
        '(em andamento, ganha, perdida). Use para explicar ao cliente em que ponto do processo ' +
        'ele está e quais são os próximos passos.',
      inputSchema: {
        funil: z.string().optional().describe('Nome do funil; sem ele, todos os funis'),
      },
    },
    async ({ funil }) => asToolResult(await tools.pipelineStages(caller, funil)),
  );

  return server;
}

/** Erro de negócio volta como resultado da ferramenta, nunca como erro de protocolo. */
function asToolResult(result: ToolResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result.body) }],
    structuredContent: result.body,
    ...(result.outcome === 'ok' || result.outcome === 'not_identified' ? {} : { isError: true }),
  };
}

/**
 * Servidor MCP sem estado (design S8): um `McpServer` e um transporte por requisição, resposta
 * JSON. O GPTMaker abre conexão nova a cada chamada e tenta `GET` (SSE), que recebe 405.
 */
@Controller(MCP_PATH.slice(1))
export class McpController {
  constructor(
    private readonly tools: CrmToolsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @UseGuards(CrmAccessGuard)
  async handle(
    @CurrentCaller() caller: CrmCaller,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const server = buildMcpServer(this.tools, caller);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @All()
  notAllowed(@Res() res: Response): void {
    if (!this.env.CRM_TOOLS_ENABLED) throw new NotFoundException();
    res.status(HttpStatus.METHOD_NOT_ALLOWED).set('Allow', 'POST').end();
  }
}
