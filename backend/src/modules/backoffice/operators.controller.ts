import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type CreatedOperatorView,
  createOperatorSchema,
  type OperatorView,
  updateOperatorSchema,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AuditService } from './audit.service';
import { type Operator, OperatorService, operatorView } from './operator.service';

class CreateOperatorDto extends createZodDto(createOperatorSchema) {}
class UpdateOperatorDto extends createZodDto(updateOperatorSchema) {}

/** Operadores do backoffice: lista para todos, alterações só ADMIN, tudo auditado. */
@Controller('admin/operators')
export class OperatorsController {
  constructor(
    private readonly operators: OperatorService,
    private readonly auth: AdminAuthService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AdminAuth()
  list(): Promise<OperatorView[]> {
    return this.operators.list();
  }

  @Post()
  @AdminAuth('ADMIN')
  async create(
    @CurrentOperator() actor: Operator,
    @Body() body: CreateOperatorDto,
  ): Promise<CreatedOperatorView> {
    const created = await this.operators.create(body);
    await this.audit.record({
      actorId: actor.id,
      action: 'operator.created',
      entityType: 'backoffice_user',
      entityId: created.operator.id,
      after: { email: created.operator.email, role: created.operator.role },
    });
    return created;
  }

  @Patch(':id')
  @AdminAuth('ADMIN')
  async update(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOperatorDto,
  ): Promise<OperatorView> {
    const before = await this.operators.findById(id);
    if (!before) {
      throw new DomainError('OPERATOR_NOT_FOUND', 'Operador não encontrado.', HttpStatus.NOT_FOUND);
    }
    const losesAdmin =
      before.role === 'ADMIN' &&
      before.active &&
      (body.active === false || body.role === 'SUPPORT');
    if (losesAdmin && (await this.operators.activeAdmins()) <= 1) {
      throw new DomainError(
        'LAST_ADMIN',
        'É preciso manter pelo menos um operador ADMIN ativo.',
        HttpStatus.CONFLICT,
      );
    }
    const after = await this.operators.update(id, body);
    if (body.active === false) await this.auth.revokeAll(id);
    await this.audit.record({
      actorId: actor.id,
      action: 'operator.updated',
      entityType: 'backoffice_user',
      entityId: id,
      before: { active: before.active, role: before.role },
      after: { active: after.active, role: after.role },
    });
    return operatorView(after);
  }

  @Post(':id/reset-totp')
  @AdminAuth('ADMIN')
  async resetTotp(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OperatorView> {
    const row = await this.operators.resetTotp(id);
    await this.auth.revokeAll(id);
    await this.audit.record({
      actorId: actor.id,
      action: 'operator.totp_reset',
      entityType: 'backoffice_user',
      entityId: id,
    });
    return operatorView(row);
  }

  @Post(':id/reset-password')
  @AdminAuth('ADMIN')
  async resetPassword(
    @CurrentOperator() actor: Operator,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ temporaryPassword: string }> {
    const temporaryPassword = await this.operators.resetPassword(id);
    await this.auth.revokeAll(id);
    await this.audit.record({
      actorId: actor.id,
      action: 'operator.password_reset',
      entityType: 'backoffice_user',
      entityId: id,
    });
    return { temporaryPassword };
  }
}
