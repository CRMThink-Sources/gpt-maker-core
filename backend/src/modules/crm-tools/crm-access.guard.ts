import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { enrichContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, agentCrmAccess, tenant } from '../../shared/database/schema/index';
import { hashCredential } from './crm-access.service';

/** Quem está chamando: o agente da credencial e o portal dele (design S3). */
export interface CrmCaller {
  tenantId: string;
  agentId: string;
  installationId: number;
}

type CallerRequest = Request & { crmCaller?: CrmCaller };

/**
 * Autentica a intenção de sistema e o servidor MCP pela credencial do agente
 * (`Authorization: Bearer` ou `?t=` na URL, usado pela conexão MCP). Recusa sem revelar o motivo: credencial desconhecida, acesso
 * desativado, agente removido ou inativo, tenant fora do ar. Com a flag desligada, 404.
 * `CONNECTING` vale: o GPTMaker lista as ferramentas durante a própria conexão.
 */
@Injectable()
export class CrmAccessGuard implements CanActivate {
  private readonly logger = new Logger(CrmAccessGuard.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.CRM_TOOLS_ENABLED) throw new NotFoundException();
    const request = context.switchToHttp().getRequest<CallerRequest>();
    const token = bearer(request.headers.authorization) ?? queryToken(request.query?.t);
    if (!token) throw new UnauthorizedException();

    const [row] = await this.db
      .select({
        tenantId: agentCrmAccess.tenantId,
        agentId: agentCrmAccess.agentId,
        installationId: tenant.installationId,
      })
      .from(agentCrmAccess)
      .innerJoin(agent, eq(agent.id, agentCrmAccess.agentId))
      .innerJoin(tenant, eq(tenant.id, agentCrmAccess.tenantId))
      .where(
        and(
          eq(agentCrmAccess.tokenHash, hashCredential(token)),
          inArray(agentCrmAccess.status, ['CONNECTING', 'CONNECTED']),
          eq(agent.status, 'ACTIVE'),
          isNull(agent.deletedAt),
          eq(tenant.status, 'ACTIVE'),
        ),
      );
    if (!row) {
      this.logger.warn({ alert: 'security' }, 'ferramenta do CRM chamada sem credencial válida');
      throw new UnauthorizedException();
    }
    const caller = { ...row, installationId: Number(row.installationId) };
    request.crmCaller = caller;
    enrichContext({ tenantId: caller.tenantId, agentId: caller.agentId });
    return true;
  }
}

export const CurrentCaller = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const caller = context.switchToHttp().getRequest<CallerRequest>().crmCaller;
  if (!caller) throw new Error('CrmAccessGuard ausente na rota');
  return caller;
});

function queryToken(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bearer(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? null;
}
