import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { type HallucinationResult, hallucinationRequestSchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { HallucinationAnalysisService } from './hallucination-analysis.service';

class HallucinationDto extends createZodDto(hallucinationRequestSchema) {}

/**
 * Análise de alucinação de uma conversa do agente (spec agent-hallucination-analysis): acesso
 * `manage`, como a revisão por IA. A resposta traz o resultado; nada é guardado.
 */
@Controller('app/agents/:id/function/hallucination')
export class HallucinationController {
  constructor(private readonly analysis: HallucinationAnalysisService) {}

  @Post()
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  analyze(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Body() body: HallucinationDto,
  ): Promise<HallucinationResult> {
    return this.analysis.analyze(session.tenantId, id, body);
  }
}
