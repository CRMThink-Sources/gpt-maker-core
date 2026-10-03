import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  type BillingPortalView,
  checkoutRequestSchema,
  type CheckoutSessionView,
  type PlansView,
  type PurchaseStatusView,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { PlansService } from './plans.service';

class CheckoutDto extends createZodDto(checkoutRequestSchema) {}

/** Planos, checkout embutido e portal de pagamento (spec payments-integration). */
@Controller('app')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get('plans')
  @AppAuth()
  list(): Promise<PlansView> {
    return this.plans.offers();
  }

  @Post('checkout')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  checkout(
    @CurrentSession() session: AppSession,
    @Body() body: CheckoutDto,
  ): Promise<CheckoutSessionView> {
    return this.plans.checkout(session.tenantId, session.installationId, body.planId);
  }

  @Get('checkout/purchases/:purchaseId')
  @AppAuth()
  purchase(
    @CurrentSession() session: AppSession,
    @Param('purchaseId', ParseIntPipe) purchaseId: number,
  ): Promise<PurchaseStatusView> {
    return this.plans.purchaseStatus(session.tenantId, purchaseId);
  }

  @Post('billing-portal')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  billingPortal(@CurrentSession() session: AppSession): Promise<BillingPortalView> {
    return this.plans.billingPortal(session.tenantId, session.installationId);
  }
}
