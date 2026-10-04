import { Controller, Get, Query } from '@nestjs/common';
import { type AdminAuditPage, auditQuerySchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AdminAuth } from './admin-auth.guard';
import { AuditQueryService } from './audit-query.service';

class AuditQueryDto extends createZodDto(auditQuerySchema) {}

/** Trilha de auditoria: consulta só para ADMIN (spec admin-backoffice). */
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @AdminAuth('ADMIN')
  list(@Query() query: AuditQueryDto): Promise<AdminAuditPage> {
    return this.audit.list(query);
  }
}
