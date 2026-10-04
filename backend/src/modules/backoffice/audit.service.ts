import { Inject, Injectable } from '@nestjs/common';
import { currentContext, type RequestContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { auditLog } from '../../shared/database/schema/index';

export interface AuditEntry {
  /** Operador (id) ou `system`. */
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  tenantId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Requisições que já gravaram auditoria própria: o interceptor não grava a genérica. */
const audited = new WeakSet<RequestContext>();

export function wasAudited(context: RequestContext | undefined): boolean {
  return context !== undefined && audited.has(context);
}

/** Trilha de auditoria do backoffice (spec admin-backoffice, "Auditoria de ações"). */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    const context = currentContext();
    await this.db.insert(auditLog).values({
      actorType: entry.actorId === 'system' ? 'SYSTEM' : 'OPERATOR',
      actorId: entry.actorId,
      tenantId: entry.tenantId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
      traceId: context?.traceId ?? null,
    });
    if (context) audited.add(context);
  }
}
