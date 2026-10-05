import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AgentEventIntake } from './agent-event.intake';

/**
 * URLs que o app configura nos webhooks de cada agente no GPTMaker:
 * `API_PUBLIC_URL/gptmaker/webhooks/{event}?t={token do agente}`. Responde 200 assim que o
 * evento é gravado; a avaliação dos gatilhos é assíncrona.
 */
@Controller('gptmaker/webhooks')
export class GptMakerWebhooksController {
  private readonly logger = new Logger(GptMakerWebhooksController.name);

  constructor(private readonly intake: AgentEventIntake) {}

  @Post(':event')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('event') event: string,
    @Query('t') token: string | undefined,
    @Body() body: unknown,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const outcome = await this.intake.receive(event, token, payloadOf(body, req));
    if (outcome.kind === 'unknown-event') throw new NotFoundException('Evento desconhecido');
    if (outcome.kind === 'invalid-token') {
      this.logger.warn({ alert: 'security', event }, 'webhook do GPTMaker com token inválido');
      throw new UnauthorizedException('Webhook não autenticado');
    }
    return { status: 'ok' };
  }
}

/**
 * Corpo como objeto quando o parser do Nest entendeu (JSON ou form); senão o texto original, para
 * não perder payload em formato inesperado (contrato ainda não documentado).
 */
function payloadOf(body: unknown, req: RawBodyRequest<Request>): unknown {
  if (body && typeof body === 'object' && Object.keys(body).length) return body;
  const raw = req.rawBody?.toString('utf8');
  return raw ? { raw, contentType: req.headers['content-type'] ?? null } : {};
}
