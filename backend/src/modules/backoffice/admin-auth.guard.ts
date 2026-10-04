import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BACKOFFICE_HEADER, type OperatorRole } from '@gptmaker/contracts';
import type { Request } from 'express';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { AdminAuthService } from './admin-auth.service';
import type { Operator } from './operator.service';

export const ADMIN_COOKIE = 'gm_admin';

type AdminRequest = Request & { operator?: Operator };
const ROLE = 'backoffice:role';

/** Cookie da sessão sem `cookie-parser` (só este cookie é lido). */
export function sessionToken(req: Request): string | undefined {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === ADMIN_COOKIE) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/**
 * Rota do backoffice: exige sessão de operador ativo; `ADMIN` restringe ao perfil que altera
 * (spec: operador `SUPPORT` alterando ⇒ 403). Escritas exigem `X-Backoffice: 1` (CSRF: outro site
 * não manda esse cabeçalho sem o preflight, recusado pelo CORS).
 */
export function AdminAuth(role: OperatorRole | 'ANY' = 'ANY') {
  return applyDecorators(
    SetMetadata(ROLE, role),
    UseGuards(AdminAuthGuard),
    // Toda escrita do backoffice fica na auditoria (15.8).
    UseInterceptors(AdminAuditInterceptor),
  );
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    if (req.method !== 'GET' && req.header(BACKOFFICE_HEADER) !== '1') {
      throw new ForbiddenException('Requisição sem o cabeçalho do backoffice');
    }
    const session = await this.auth.session(sessionToken(req));
    if (!session) throw new UnauthorizedException('Sessão do backoffice ausente ou expirada');
    const role =
      this.reflector.getAllAndOverride<OperatorRole | 'ANY' | undefined>(ROLE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'ANY';
    if (role === 'ADMIN' && session.operator.role !== 'ADMIN') {
      throw new ForbiddenException('Somente operadores ADMIN');
    }
    req.operator = session.operator;
    return true;
  }
}

export const CurrentOperator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Operator => {
    const operator = context.switchToHttp().getRequest<AdminRequest>().operator;
    if (!operator) throw new Error('AdminAuth ausente na rota');
    return operator;
  },
);
