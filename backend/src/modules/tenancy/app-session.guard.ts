import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { enrichContext } from '../../shared/context/request-context';
import { DomainError } from '../../shared/http/api-exception.filter';
import {
  SESSION_VERIFIER,
  type SessionClaims,
  type SessionVerifier,
} from '../../shared/platform/session-verifier';
import { PermissionService } from './permission.service';
import { TenantService, type TenantStatus } from './tenant.service';

/** Quem está usando o app no iframe; identidade e admin vêm só do JWT da plataforma. */
export interface AppSession {
  tenantId: string;
  tenantCode: string;
  tenantStatus: TenantStatus;
  installationId: number;
  /** Id do usuário no Bitrix (`sub`). */
  userId: string;
  userName: string;
  isAdmin: boolean;
  /** Admin do portal ou usuário autorizado pelo admin (spec: permissão de administração). */
  canManage: boolean;
}

export type AppAccess = 'read' | 'manage' | 'admin';

type SessionRequest = Request & { appSession?: AppSession };

const ACCESS = 'app:access';

/**
 * Autentica a rota pelo JWT da sessão do iframe (`Authorization: Bearer`), validado localmente
 * pelo JWKS da plataforma (assinatura RS256, `iss`, `aud` = `crmthink.gptmaker`, `exp`), e
 * resolve tenant e permissão. `manage`: admin do portal ou usuário autorizado; `admin`: só admin.
 */
export function AppAuth(access: AppAccess = 'read') {
  return applyDecorators(SetMetadata(ACCESS, access), UseGuards(AppSessionGuard));
}

@Injectable()
export class AppSessionGuard implements CanActivate {
  constructor(
    @Inject(SESSION_VERIFIER) private readonly verify: SessionVerifier,
    private readonly tenants: TenantService,
    private readonly permissions: PermissionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    const token = /^Bearer (.+)$/i.exec(req.header('authorization') ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Sessão ausente');

    let claims: SessionClaims;
    try {
      claims = await this.verify(token);
    } catch {
      // Expirado, assinatura inválida, outro emissor ou outra audiência: todos viram 401.
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }

    const tenant = await this.tenants.findByInstallationId(claims.installationId);
    if (!tenant || tenant.status === 'UNINSTALLED') {
      throw new DomainError(
        'TENANT_NOT_INSTALLED',
        'App não instalado neste portal',
        HttpStatus.FORBIDDEN,
      );
    }

    const isAdmin = claims.isAdmin === true;
    if (isAdmin) {
      // Melhor esforço: falhar aqui não pode derrubar a requisição.
      await this.permissions.rememberAdmin(tenant.id, claims.sub).catch(() => undefined);
    }
    const canManage = isAdmin || (await this.permissions.isGranted(tenant.id, claims.sub));
    req.appSession = {
      tenantId: tenant.id,
      tenantCode: tenant.tenantCode,
      tenantStatus: tenant.status,
      installationId: claims.installationId,
      userId: claims.sub,
      userName: claims.name,
      isAdmin,
      canManage,
    };
    enrichContext({ tenantId: tenant.id });

    const access =
      this.reflector.getAllAndOverride<AppAccess | undefined>(ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'read';
    if (access === 'admin' && !isAdmin) {
      throw new ForbiddenException('Somente administradores do portal');
    }
    if (access === 'manage' && !canManage)
      throw new ForbiddenException('Sem permissão para alterar');
    return true;
  }
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AppSession => {
    const session = context.switchToHttp().getRequest<SessionRequest>().appSession;
    if (!session) throw new Error('AppAuth ausente na rota');
    return session;
  },
);
