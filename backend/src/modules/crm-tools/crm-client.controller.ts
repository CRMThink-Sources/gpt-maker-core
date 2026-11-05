import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CrmAccessGuard, type CrmCaller, CurrentCaller } from './crm-access.guard';
import { CrmToolsService } from './crm-tools.service';
import { CLIENT_LOOKUP_PATH } from './system-intention';

/**
 * Intenção de sistema "Consultar cliente no CRM" (spec agent-crm-tools): o GPTMaker manda
 * `{ chat: "<chat_id>" }` com a credencial do agente. Resultado de negócio sempre em 200: o
 * agente formula a resposta a partir do corpo.
 */
@Controller()
export class CrmClientController {
  constructor(private readonly tools: CrmToolsService) {}

  @Post(CLIENT_LOOKUP_PATH.slice(1))
  @HttpCode(HttpStatus.OK)
  @UseGuards(CrmAccessGuard)
  async identify(
    @CurrentCaller() caller: CrmCaller,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const chat = body && typeof body === 'object' ? (body as { chat?: unknown }).chat : undefined;
    return (await this.tools.identifyClient(caller, chat)).body;
  }
}
