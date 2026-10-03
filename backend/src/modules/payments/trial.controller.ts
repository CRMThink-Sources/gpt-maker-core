import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { type TrialStatusView, trialRequestSchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { TrialService } from './trial.service';

class TrialRequestDto extends createZodDto(trialRequestSchema) {}

/** Oferta e ativação do trial na tela de planos (spec payments-integration). */
@Controller('app/trial')
export class TrialController {
  constructor(private readonly trials: TrialService) {}

  @Get()
  @AppAuth()
  status(@CurrentSession() session: AppSession): Promise<TrialStatusView> {
    return this.trials.status(session.tenantId);
  }

  @Post()
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  request(
    @CurrentSession() session: AppSession,
    @Body() body: TrialRequestDto,
  ): Promise<TrialStatusView> {
    return this.trials.request(session.tenantId, session.installationId, body);
  }
}
