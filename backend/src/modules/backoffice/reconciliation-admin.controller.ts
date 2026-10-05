import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AdminReconciliationReviewsView,
  type PartnerReportView,
  partnerReportQuerySchema,
  reviewDecisionSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import type { Operator } from './operator.service';
import { PartnerReportService } from './partner-report.service';
import { ReconciliationAdminService } from './reconciliation-admin.service';

class ReviewDecisionDto extends createZodDto(reviewDecisionSchema) {}
class PartnerReportQueryDto extends createZodDto(partnerReportQuerySchema) {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reconciliação no backoffice: revisão de ajustes (só ADMIN decide) e relatório do partner. */
@Controller('admin/reconciliation')
export class ReconciliationAdminController {
  constructor(
    private readonly reviews: ReconciliationAdminService,
    private readonly reports: PartnerReportService,
  ) {}

  @Get('reviews')
  @AdminAuth()
  list(): Promise<AdminReconciliationReviewsView> {
    return this.reviews.reviews();
  }

  @Post('reviews/:agentId/:day')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentOperator() actor: Operator,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('day') day: string,
    @Body() body: ReviewDecisionDto,
  ): Promise<AdminReconciliationReviewsView> {
    if (!DAY.test(day)) throw new BadRequestException('Dia no formato AAAA-MM-DD');
    return this.reviews.decide(agentId, day, body.decision, actor.id);
  }

  @Get('partner-report')
  @AdminAuth()
  report(@Query() query: PartnerReportQueryDto): Promise<PartnerReportView> {
    return this.reports.report(query.month);
  }
}
