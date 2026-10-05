import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { appUserPermission, portalAdmin } from '../../shared/database/schema/index';

/** Uma gravação por administrador e hora (o guard roda em toda requisição). */
const ADMIN_SEEN_THROTTLE_MS = 3_600_000;

export interface GrantedUser {
  bitrixUserId: string;
  grantedBy: string;
  grantedAt: Date;
}

/** Usuários do portal autorizados pelo admin a gerenciar agentes, treinamentos e gatilhos. */
@Injectable()
export class PermissionService {
  private readonly adminsSeen = new Map<string, number>();

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Registra um administrador do portal visto na sessão (`portal_admin`): o Bitrix24 não lista
   * administradores pela API, e eles recebem os avisos quando não há destinatários configurados.
   */
  async rememberAdmin(tenantId: string, bitrixUserId: string, now = Date.now()): Promise<void> {
    const key = `${tenantId}:${bitrixUserId}`;
    if (now - (this.adminsSeen.get(key) ?? 0) < ADMIN_SEEN_THROTTLE_MS) return;
    this.adminsSeen.set(key, now);
    const lastSeenAt = new Date(now);
    await this.db
      .insert(portalAdmin)
      .values({ tenantId, bitrixUserId, lastSeenAt })
      .onConflictDoUpdate({
        target: [portalAdmin.tenantId, portalAdmin.bitrixUserId],
        set: { lastSeenAt },
      });
  }

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
