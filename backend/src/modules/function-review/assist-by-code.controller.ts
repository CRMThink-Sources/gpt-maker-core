import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { type AssistResult, assistInputSchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { FunctionReviewService } from './function-review.service';

class AssistByCodeDto extends createZodDto(assistInputSchema) {}

/**
 * Ajuda da IA no assistente de criação, antes de o agente existir: a função vem pelo código.
 * Acesso `manage`, o mesmo de criar agente.
 */
@Controller('app/agent-functions/:code/assist')
export class AssistByCodeController {
  constructor(private readonly reviews: FunctionReviewService) {}

  @Post()
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  assist(
    @CurrentSession() session: AppSession,
    @Param('code') code: string,
    @Body() body: AssistByCodeDto,
  ): Promise<AssistResult> {
    return this.reviews.assistByCode(session.tenantId, code, body);
  }
}
