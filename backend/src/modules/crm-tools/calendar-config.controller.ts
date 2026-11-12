import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import {
  type CalendarConfigInput,
  calendarConfigInputSchema,
  type CalendarConfigView,
} from '@gptmaker/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { CalendarConfigService } from './calendar-config.service';

/** Agenda de um agente do tenant da sessão (spec agent-calendar-scheduling). */
@Controller('app/agents/:agentId/calendar')
export class CalendarConfigController {
  constructor(
    private readonly calendar: CalendarConfigService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @AppAuth()
  view(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
  ): Promise<CalendarConfigView> {
    return this.calendar.view(session.tenantId, agentId);
  }

  @Put()
  @AppAuth('manage')
  save(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
    @Body(new ZodValidationPipe(calendarConfigInputSchema)) body: CalendarConfigInput,
  ): Promise<CalendarConfigView> {
    if (!this.env.CRM_TOOLS_ENABLED) throw new NotFoundException();
    return this.calendar.save(
      { tenantId: session.tenantId, installationId: session.installationId },
      agentId,
      body,
    );
  }

  @Delete()
  @AppAuth('manage')
  remove(
    @CurrentSession() session: AppSession,
    @Param('agentId') agentId: string,
  ): Promise<CalendarConfigView> {
    if (!this.env.CRM_TOOLS_ENABLED) throw new NotFoundException();
    return this.calendar.remove(session.tenantId, agentId);
  }
}
