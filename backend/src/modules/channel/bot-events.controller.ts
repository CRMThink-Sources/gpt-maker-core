import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { BitrixEventGuard, BitrixEventTenant, type Tenant } from '../tenancy';
import { BotEventsService } from './bot-events.service';

/**
 * `webhookUrl` dos chatbots (`imbot.v2`, eventMode webhook). O guard confere o
 * `auth[application_token]` com o da instalação; sem ele, 401 e nada é enfileirado.
 */
@Controller('bitrix/bots')
export class BotEventsController {
  constructor(private readonly events: BotEventsService) {}

  @Post('events')
  @HttpCode(HttpStatus.OK)
  @UseGuards(BitrixEventGuard)
  async receive(@BitrixEventTenant() tenant: Tenant, @Body() body: unknown) {
    await this.events.handle(tenant, body);
    return { status: 'ok' };
  }
}
