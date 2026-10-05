import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminAuditEntry, AdminAuditPage } from '@gptmaker/contracts';
import { and, desc, eq, inArray, like, lt, or, type SQL } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { auditLog, backofficeUser, tenant } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';

export interface AuditQuery {
  tenantId?: string;
  actorId?: string;
  action?: string;
  cursor?: string;
  limit: number;
}

/** Cursor opaco: data (ISO) e id do último item; empate na data desempata pelo id. */
function encodeCursor(entry: { createdAt: Date; id: string }): string {
  return Buffer.from(`${entry.createdAt.toISOString()}|${entry.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new DomainError('INVALID_CURSOR', 'Cursor inválido.', HttpStatus.BAD_REQUEST);
  }
  return { createdAt, id };
}

/**
 * Consulta da trilha de auditoria (spec admin-backoffice, "Consultar auditoria"; tarefa 15.8):
 * filtros por portal, operador e prefixo da ação, mais novas primeiro, paginada por cursor.
 */
@Injectable()
export class AuditQueryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(query: AuditQuery): Promise<AdminAuditPage> {
    const filters: SQL[] = [];
    if (query.tenantId) filters.push(eq(auditLog.tenantId, query.tenantId));
    if (query.actorId) filters.push(eq(auditLog.actorId, query.actorId));
    if (query.action) {
      filters.push(like(auditLog.action, `${query.action.replace(/[\\%_]/g, '\\$&')}%`));
    }
    if (query.cursor) {
      const { createdAt, id } = decodeCursor(query.cursor);
      filters.push(
        or(
          lt(auditLog.createdAt, createdAt),
          and(eq(auditLog.createdAt, createdAt), lt(auditLog.id, id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ entry: auditLog, domain: tenant.domain })
      .from(auditLog)
      .leftJoin(tenant, eq(tenant.id, auditLog.tenantId))
      .where(and(...filters))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);

    const actorIds = [...new Set(page.map((r) => r.entry.actorId))].filter((id) =>
      /^[\da-f-]{36}$/i.test(id),
    );
    const operators = actorIds.length
      ? await this.db
          .select({ id: backofficeUser.id, name: backofficeUser.name })
          .from(backofficeUser)
          .where(inArray(backofficeUser.id, actorIds))
      : [];

    const items: AdminAuditEntry[] = page.map(({ entry, domain }) => ({
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      actor: {
        type: entry.actorType,
        id: entry.actorId,
        name: operators.find((op) => op.id === entry.actorId)?.name ?? null,
      },
      tenant: entry.tenantId && domain ? { id: entry.tenantId, domain } : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      traceId: entry.traceId,
    }));
    const last = page.at(-1)?.entry;
    return { items, nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null };
  }
}
