import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { currentContext } from '../../shared/context/request-context';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AuditService, wasAudited } from './audit.service';
import type { Operator } from './operator.service';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Campos que nunca vão para a auditoria (senhas, códigos TOTP, segredos). */
const SENSITIVE = /pass|secret|token|totp|otp|^current$|^next$|^code$/i;

/** Corpo sem campos sensíveis (recursivo); a auditoria guarda o que foi pedido, não credenciais. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE.test(key) ? '[oculto]' : redact(item),
    ]),
  );
}

function failure(error: unknown): { status: number; error: string } {
  if (error instanceof DomainError) return { status: error.getStatus(), error: error.code };
  if (error instanceof HttpException) {
    return { status: error.getStatus(), error: `HTTP_${error.getStatus()}` };
  }
  return { status: 500, error: 'INTERNAL_ERROR' };
}

/**
 * Rede de segurança da trilha de auditoria (spec admin-backoffice; tarefa 15.8): em toda escrita
 * do backoffice (`@AdminAuth`), se a ação não gravou auditoria própria (com antes/depois), grava
 * uma genérica com a rota, os parâmetros e o corpo sem campos sensíveis. Escritas que falharam
 * também entram (com o código do erro): tentativa recusada também é ação do operador.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAuditInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = execution.switchToHttp();
    const req = http.getRequest<Request & { operator?: Operator }>();
    if (req.method === 'GET' || !req.operator) return next.handle();
    const context = currentContext();
    const operator = req.operator;
    const route = `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`;
    const params = req.params as Record<string, string>;
    const body = req.body as Record<string, unknown> | undefined;
    const candidate = route.includes('/admin/tenants/:id') ? params.id : body?.tenantId;
    const tenantId = typeof candidate === 'string' && UUID.test(candidate) ? candidate : undefined;

    const record = (outcome: { ok: true } | { ok: false; status: number; error: string }) => {
      if (wasAudited(context)) return;
      const entry = {
        actorId: operator.id,
        tenantId,
        action: route,
        entityType: 'http_request',
        entityId: req.originalUrl.split('?')[0],
        after: {
          params: Object.keys(params).length ? params : undefined,
          body: body && Object.keys(body).length ? redact(body) : undefined,
          ...outcome,
        },
      };
      // Portal inexistente (FK) não pode custar o registro: grava sem o portal.
      this.audit
        .record(entry)
        .catch(() => this.audit.record({ ...entry, tenantId: undefined }))
        .catch((error: unknown) =>
          this.logger.error({ err: error, route }, 'auditoria genérica não gravada'),
        );
    };

    return next.handle().pipe(
      tap({
        next: () => record({ ok: true }),
        error: (error: unknown) => record({ ok: false, ...failure(error) }),
      }),
    );
  }
}
