import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { appUserPermission } from '../../shared/database/schema/index';

export interface GrantedUser {
  bitrixUserId: string;
  grantedBy: string;
  grantedAt: Date;
}

/** Usuários do portal autorizados pelo admin a gerenciar agentes, treinamentos e gatilhos. */
@Injectable()
export class PermissionService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async isGranted(tenantId: string, bitrixUserId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: appUserPermission.id })
      .from(appUserPermission)
      .where(
        and(
          eq(appUserPermission.tenantId, tenantId),
          eq(appUserPermission.bitrixUserId, bitrixUserId),
        ),
      );
    return row !== undefined;
  }

  list(tenantId: string): Promise<GrantedUser[]> {
    return this.db
      .select({
        bitrixUserId: appUserPermission.bitrixUserId,
        grantedBy: appUserPermission.grantedBy,
        grantedAt: appUserPermission.createdAt,
      })
      .from(appUserPermission)
      .where(eq(appUserPermission.tenantId, tenantId))
      .orderBy(asc(appUserPermission.createdAt));
  }

  /** Idempotente: conceder de novo mantém a concessão original. */
  async grant(tenantId: string, bitrixUserIds: string[], grantedBy: string): Promise<void> {
    const ids = [...new Set(bitrixUserIds)];
    if (ids.length === 0) return;
    await this.db
      .insert(appUserPermission)
      .values(ids.map((bitrixUserId) => ({ tenantId, bitrixUserId, grantedBy })))
      .onConflictDoNothing();
  }

  async revoke(tenantId: string, bitrixUserId: string): Promise<void> {
    await this.db
      .delete(appUserPermission)
      .where(
        and(
          eq(appUserPermission.tenantId, tenantId),
          eq(appUserPermission.bitrixUserId, bitrixUserId),
        ),
      );
  }
}
