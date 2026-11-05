import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { type CrmGuidanceView, crmGuidanceInputSchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import { CrmGuidanceAdminService } from './crm-guidance-admin.service';
import type { Operator } from './operator.service';

class CrmGuidanceDto extends createZodDto(crmGuidanceInputSchema) {}

/**
 * Orientações das ferramentas do CRM (spec agent-crm-tools): consulta para todos; editar e
 * restaurar o padrão só ADMIN (auditados).
 */
@Controller('admin/crm-guidance')
export class CrmGuidanceAdminController {
  constructor(private readonly guidance: CrmGuidanceAdminService) {}

  @Get()
  @AdminAuth()
  list(): Promise<CrmGuidanceView[]> {
    return this.guidance.list();
  }

  @Put(':key')
  @AdminAuth('ADMIN')
  save(
    @CurrentOperator() actor: Operator,
    @Param('key') key: string,
    @Body() body: CrmGuidanceDto,
  ): Promise<CrmGuidanceView[]> {
    return this.guidance.save(key, body.text, actor.id);
  }

  /** Restaurar o padrão. */
  @Delete(':key')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  reset(@CurrentOperator() actor: Operator, @Param('key') key: string): Promise<CrmGuidanceView[]> {
    return this.guidance.reset(key, actor.id);
  }
}
