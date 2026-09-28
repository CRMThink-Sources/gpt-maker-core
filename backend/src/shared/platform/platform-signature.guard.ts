import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SIGNATURE_HEADER, verifyPlatformSignature } from '@gptmaker/platform-sdk';
import type { Request } from 'express';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Valida `X-Platform-Signature` (HMAC-SHA256 sobre o corpo cru, janela de 5 min) com o SDK da
 * plataforma. Usado no instalador e em `/platform/events`; sem assinatura válida, 401 antes de
 * qualquer efeito. Depende de `rawBody: true` no bootstrap do Nest.
 */
@Injectable()
export class PlatformSignatureGuard implements CanActivate {
  private readonly logger = new Logger(PlatformSignatureGuard.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const check = verifyPlatformSignature({
      header: req.header(SIGNATURE_HEADER),
      rawBody: req.rawBody ?? '',
      secrets: this.env.PLATFORM_WEBHOOK_SECRETS,
    });
    if (check.ok) return true;
    this.logger.warn(
      { alert: 'security', reason: check.reason, path: req.path },
      'assinatura da plataforma recusada',
    );
    throw new UnauthorizedException('Assinatura inválida');
  }
}
