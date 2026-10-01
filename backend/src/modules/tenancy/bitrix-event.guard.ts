import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { enrichContext } from '../../shared/context/request-context';
import { BitrixEventVerifier } from './bitrix-event.verifier';
import type { Tenant } from './tenant.service';

type BitrixEventRequest = Request & { bitrixTenant?: Tenant };

/**
 * Guard dos endpoints que recebem eventos do portal (mensagens do chatbot etc.): valida
 * `auth[application_token]` e deixa o tenant em `@BitrixEventTenant()`. O corpo do Bitrix vem
 * como `application/x-www-form-urlencoded` com chaves aninhadas (`auth[member_id]`) ou JSON.
 */
@Injectable()
export class BitrixEventGuard implements CanActivate {
  constructor(private readonly verifier: BitrixEventVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BitrixEventRequest>();
    const body = req.body as
      | { auth?: Record<string, unknown>; data?: { bot?: { auth?: Record<string, unknown> } } }
      | undefined;
    // Eventos `imbot.v2` trazem só `domain` e `application_token` no `auth` de cima; o portal
    // vem em `data.bot.auth.member_id`. Ele só localiza o tenant: quem autentica é o token.
    const auth = {
      ...body?.auth,
      member_id: body?.auth?.member_id ?? body?.data?.bot?.auth?.member_id,
    };
    const check = await this.verifier.verify(auth);
    if (!check.ok) throw new UnauthorizedException('Evento não autenticado');
    req.bitrixTenant = check.tenant;
    enrichContext({ tenantId: check.tenant.id });
    return true;
  }
}

export const BitrixEventTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Tenant => {
    const tenant = context.switchToHttp().getRequest<BitrixEventRequest>().bitrixTenant;
    if (!tenant) throw new Error('BitrixEventGuard ausente na rota');
    return tenant;
  },
);
