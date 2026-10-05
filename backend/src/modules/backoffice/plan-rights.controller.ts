import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import {
  type AdminPlansView,
  type AdminPlanView,
  updatePlanRightsSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import type { Operator } from './operator.service';
import { PlanRightsService } from './plan-rights.service';

class UpdatePlanRightsDto extends createZodDto(updatePlanRightsSchema) {}

/** Direitos dos planos: todos os operadores consultam; só ADMIN altera (auditado). */
@Controller('admin/plans')
export class PlanRightsController {
  constructor(private readonly rights: PlanRightsService) {}

  @Get()
  @AdminAuth()
  list(): Promise<AdminPlansView & { platformError: boolean }> {
    return this.rights.list();
  }

  @Put(':planId')
  @AdminAuth('ADMIN')
  update(
    @CurrentOperator() actor: Operator,
    @Param('planId', ParseIntPipe) planId: number,
    @Body() body: UpdatePlanRightsDto,
  ): Promise<AdminPlanView> {
    return this.rights.update(planId, body, actor.id);
  }
}
