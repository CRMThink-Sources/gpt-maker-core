import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { INTENTION_TOKEN_HEADER } from './intention.service';
import { type IntentionReply, IntentionRunner } from './intention-runner';

/**
 * URL das intenções "Ação no Bitrix24" no GPTMaker: `API_PUBLIC_URL/gptmaker/intentions/{id}`,
 * com o token da intenção no cabeçalho. A resposta vai para o agente formular a mensagem.
 */
@Controller('gptmaker/intentions')
export class IntentionEndpointController {
  constructor(private readonly runner: IntentionRunner) {}

  @Post(':id')
  @HttpCode(HttpStatus.OK)
  async run(
    @Param('id') id: string,
    @Headers(INTENTION_TOKEN_HEADER.toLowerCase()) token: string | undefined,
    @Body() body: unknown,
  ): Promise<IntentionReply> {
    const outcome = await this.runner.run(id, token, body);
    if (outcome.kind === 'unauthorized')
      throw new UnauthorizedException('Intenção não autenticada');
    return outcome.reply;
  }
}
