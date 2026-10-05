import { Controller, Get, Query } from '@nestjs/common';
import {
  type CreditEntriesView,
  creditEntriesQuerySchema,
  type CreditSummaryView,
  type CreditUsageView,
  creditUsageQuerySchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { CreditStatementService } from '../billing';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { CreditSummaryService } from './credit-summary.service';

class UsageQueryDto extends createZodDto(creditUsageQuerySchema) {}
class EntriesQueryDto extends createZodDto(creditEntriesQuerySchema) {}

/** Saldo, consumo por dia e movimentações do tenant da sessão (spec credit-billing). */
@Controller('app/credits')
export class CreditsController {
  constructor(
    private readonly summaries: CreditSummaryService,
    private readonly statement: CreditStatementService,
  ) {}

  @Get()
  @AppAuth()
  summary(@CurrentSession() session: AppSession): Promise<CreditSummaryView> {
    return this.summaries.summary(session.tenantId);
  }

  @Get('usage')
  @AppAuth()
  usage(
    @CurrentSession() session: AppSession,
    @Query() query: UsageQueryDto,
  ): Promise<CreditUsageView> {
    return this.statement.usage(session.tenantId, query);
  }

  @Get('entries')
  @AppAuth()
  entries(
    @CurrentSession() session: AppSession,
    @Query() query: EntriesQueryDto,
  ): Promise<CreditEntriesView> {
    return this.statement.entries(session.tenantId, query);
  }
}
