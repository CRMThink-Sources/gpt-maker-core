import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { type AssistResult, assistInputSchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { FunctionReviewService } from './function-review.service';

class AssistDto extends createZodDto(assistInputSchema) {}

/** Ajuda da IA para preencher campos de texto vazios: acesso `manage`, como a edição da função. */
@Controller('app/agents/:id/function/assist')
export class AssistController {
  constructor(private readonly reviews: FunctionReviewService) {}

  @Post()
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  assist(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Body() body: AssistDto,
  ): Promise<AssistResult> {
    return this.reviews.assist(session.tenantId, id, body);
  }
}
