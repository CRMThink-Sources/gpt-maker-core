import { Body, Controller, Get, Inject, NotFoundException, Param, Put } from '@nestjs/common';
import { type CrmAccessInput, crmAccessInputSchema, type CrmAccessView } from '@gptmaker/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { CrmAccessService } from './crm-access.service';

/** Acesso ao CRM de um agente do tenant da sessão (spec agent-crm-tools). */
@Controller('app/agents/:agentId/crm-access')
export class CrmAccessController {
  constructor(
    private readonly access: CrmAccessService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @AppAuth()
  view(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
  ): Promise<CrmAccessView> {
    return this.access.view(session.tenantId, agentId);
  }

  @Put()
  @AppAuth('manage')
  update(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Body(new ZodValidationPipe(crmAccessInputSchema)) body: CrmAccessInput,
  ): Promise<CrmAccessView> {
    if (!this.env.CRM_TOOLS_ENABLED) throw new NotFoundException();
    return this.access.update(session.tenantId, agentId, body);
  }
}
