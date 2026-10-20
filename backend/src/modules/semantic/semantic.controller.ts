import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type CrmCatalogView,
  type CrmClientOption,
  type CrmFieldSettingInput,
  crmFieldSettingInputSchema,
  type CrmFieldView,
} from '@gptmaker/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { ClientSearchService } from './client-search.service';
import { SemanticCatalogService } from './semantic-catalog.service';

/** Catálogo do CRM do tenant da sessão (spec crm-semantic-layer). */
@Controller('app/crm')
export class SemanticController {
  constructor(
    private readonly catalog: SemanticCatalogService,
    private readonly clients: ClientSearchService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Clientes do CRM para simular numa conversa de teste (spec agent-test-chat). */
  @Get('clients')
  @AppAuth('manage')
  searchClients(
    @CurrentSession() session: AppSession,
    @Query('query') query: string | undefined,
  ): Promise<CrmClientOption[]> {
    this.assertEnabled();
    return this.clients.search(portalOf(session), query ?? '');
  }

  @Get('fields')
  @AppAuth()
  fields(@CurrentSession() session: AppSession): Promise<CrmCatalogView> {
    this.assertEnabled();
    return this.catalog.view(portalOf(session));
  }

  @Post('refresh')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  refresh(@CurrentSession() session: AppSession): Promise<CrmCatalogView> {
    this.assertEnabled();
    return this.catalog.view(portalOf(session), { fresh: true });
  }

  @Put('fields/:entity/:code')
  @AppAuth('manage')
  update(
    @CurrentSession() session: AppSession,
    @Param('entity') entity: string,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(crmFieldSettingInputSchema)) body: CrmFieldSettingInput,
  ): Promise<CrmFieldView> {
    this.assertEnabled();
    return this.catalog.update(portalOf(session), entity, code, body);
  }

  private assertEnabled(): void {
    if (!this.env.CRM_TOOLS_ENABLED) throw new NotFoundException();
  }
}

function portalOf(session: AppSession) {
  return { tenantId: session.tenantId, installationId: session.installationId };
}
