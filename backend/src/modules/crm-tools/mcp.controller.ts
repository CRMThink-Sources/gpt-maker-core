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
import { CalendarToolsService } from './calendar-tools.service';
import { CrmAccessGuard, type CrmCaller, CurrentCaller } from './crm-access.guard';
import { CrmToolsService, DEAL_SITUATIONS, type ToolResult } from './crm-tools.service';
import { MCP_PATH } from './system-intention';

/**
 * Versão das ferramentas publicadas: mudar nome, descrição ou esquema exige incrementar, para o
 * `CrmToolsSync` pedir ao GPTMaker que releia (`sync-tools`).
 */
export const TOOLS_VERSION = '5';

/** Ferramentas do servidor MCP, ligadas ao agente que chama (design S8). */
export function buildMcpServer(
  tools: CrmToolsService,
  calendar: CalendarToolsService,
  caller: CrmCaller,
): McpServer {
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

  // Agenda (spec agent-calendar-scheduling). As três ficam sempre publicadas: sem agenda
  // configurada respondem que ela não está configurada (design D8).
  server.registerTool(
    'horarios_livres',
    {
      title: 'Horários livres na agenda',
      description:
        'Mostra até 10 horários livres na agenda do atendimento (Calendário do Bitrix24). Cada horário ' +
        'traz "quando" (a data e a hora por extenso, para dizer ao cliente) e "usar_ao_agendar" (valor ' +
        'interno para agendar_compromisso, que o cliente nunca deve ver). Use quando o cliente quiser ' +
        'marcar um horário. Só funciona se a ' +
        'empresa configurou a agenda deste agente; se não houver agenda ou horários, avise que a ' +
        'equipe vai retornar o contato. Se a agenda for a do responsável do cliente, informe a ' +
        'referência do cliente devolvida por "Consultar cliente no CRM".',
      inputSchema: {
        cliente: z
          .string()
          .optional()
          .describe('Referência do cliente, exatamente como veio em "Consultar cliente no CRM"'),
        a_partir_de: z
          .string()
          .optional()
          .describe('Primeiro dia a considerar, no formato AAAA-MM-DD; sem ele, a partir de hoje'),
      },
    },
    async ({ cliente, a_partir_de }) =>
      asToolResult(await calendar.freeSlots(caller, { cliente, aPartirDe: a_partir_de })),
  );

  server.registerTool(
    'agendar_compromisso',
    {
      title: 'Marcar compromisso na agenda',
      description:
        'Marca um compromisso do cliente no Calendário do Bitrix24 em um dos horários livres. ' +
        'ANTES de usar: consulte "horarios_livres", ofereça os horários ao cliente e deixe que ele ' +
        'escolha. Precisa da referência do cliente devolvida por "Consultar cliente no CRM". ' +
        'Funciona em duas etapas: a PRIMEIRA chamada não marca nada, só confere o horário e devolve a ' +
        'data e a hora por extenso (campo "quando") e com quem será, para você confirmar a data e a ' +
        'hora com o cliente; só depois que ele responder que sim, chame de novo com os mesmos valores ' +
        'e o compromisso é marcado. Depois de marcado, confirme ao cliente a data, a hora e com quem ' +
        'será. Chamar de novo com os mesmos dados não duplica o compromisso. Se o horário já foi ' +
        'ocupado, a resposta traz alternativas para oferecer.',
      inputSchema: {
        cliente: z
          .string()
          .describe('Referência do cliente, exatamente como veio em "Consultar cliente no CRM"'),
        inicio: z
          .string()
          .describe(
            'Valor "usar_ao_agendar" do horário escolhido em "horarios_livres" (formato AAAA-MM-DD HH:mm, no horário da agenda). É um valor interno: não mostre ao cliente',
          ),
        assunto: z
          .string()
          .optional()
          .describe('Assunto do compromisso em poucas palavras, como o cliente disse (opcional)'),
      },
    },
    async ({ cliente, inicio, assunto }) =>
      asToolResult(await calendar.book(caller, { cliente, inicio, assunto })),
  );

  server.registerTool(
    'agendamentos_do_cliente',
    {
      title: 'Compromissos do cliente',
      description:
        'Lista os compromissos futuros do cliente nos próximos 60 dias (até 10), só com data, hora, ' +
        'duração e com quem é, sem título nem detalhes. Use quando o cliente perguntar o que já tem ' +
        'marcado. Precisa da referência do cliente devolvida por "Consultar cliente no CRM". Só ' +
        'funciona se a empresa configurou a agenda deste agente.',
      inputSchema: {
        cliente: z
          .string()
          .describe('Referência do cliente, exatamente como veio em "Consultar cliente no CRM"'),
      },
    },
    async ({ cliente }) => asToolResult(await calendar.clientAppointments(caller, { cliente })),
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
    private readonly calendar: CalendarToolsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @UseGuards(CrmAccessGuard)
  async handle(
    @CurrentCaller() caller: CrmCaller,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const server = buildMcpServer(this.tools, this.calendar, caller);
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
