import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AppAuth, type AppSession, CurrentSession } from './app-session.guard';
import { type GrantedUser, PermissionService } from './permission.service';

const bitrixUserId = z.string().regex(/^\d+$/, 'id de usuário do Bitrix');

class GrantDto extends createZodDto(
  z.object({ bitrixUserIds: z.array(bitrixUserId).min(1).max(100) }),
) {}

/** Rotas do frontend embutido: sessão atual e concessão de permissões (admin do portal). */
@Controller('app')
export class AppSessionController {
  constructor(private readonly permissions: PermissionService) {}

  @Get('session')
  @AppAuth()
  session(@CurrentSession() session: AppSession) {
    return {
      user: { id: session.userId, name: session.userName, isAdmin: session.isAdmin },
      tenant: { code: session.tenantCode, status: session.tenantStatus },
      canManage: session.canManage,
    };
  }

  @Get('permissions')
  @AppAuth('admin')
  async list(@CurrentSession() session: AppSession): Promise<{ users: GrantedUser[] }> {
    return { users: await this.permissions.list(session.tenantId) };
  }

  @Post('permissions')
  @AppAuth('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async grant(@CurrentSession() session: AppSession, @Body() body: GrantDto): Promise<void> {
    await this.permissions.grant(session.tenantId, body.bitrixUserIds, session.userId);
  }

  @Delete('permissions/:bitrixUserId')
  @AppAuth('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentSession() session: AppSession,
    @Param('bitrixUserId') userId: string,
  ): Promise<void> {
    if (!bitrixUserId.safeParse(userId).success) {
      throw new DomainError(
        'INVALID_USER',
        'Id de usuário do Bitrix inválido',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.permissions.revoke(session.tenantId, userId);
  }
}
