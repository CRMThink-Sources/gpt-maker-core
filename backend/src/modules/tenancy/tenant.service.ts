import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { tenant } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';

export type Tenant = typeof tenant.$inferSelect;
export type TenantStatus = Tenant['status'];

const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 5;

/** Código curto do prefixo `[<tenantCode>]` no GPTMaker; sem caracteres ambíguos (0/o, 1/l). */
export function generateTenantCode(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? error;
  const pg = cause as { code?: string; constraint?: string };
  return pg.code === '23505' && pg.constraint === constraint;
}

@Injectable()
export class TenantService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findById(id: string): Promise<Tenant | undefined> {
    const [row] = await this.db.select().from(tenant).where(eq(tenant.id, id));
    return row;
  }

  async findByInstallationId(installationId: number): Promise<Tenant | undefined> {
    const [row] = await this.db
      .select()
      .from(tenant)
      .where(eq(tenant.installationId, String(installationId)));
    return row;
  }

  async findByMemberId(memberId: string): Promise<Tenant | undefined> {
    const [row] = await this.db.select().from(tenant).where(eq(tenant.memberId, memberId));
    return row;
  }

  /**
   * Cria o tenant na primeira instalação ou reativa o existente (mesmo `installationId`),
   * preservando `tenantCode`, agentes, ledger e saldo. Suspensão (política de cobrança) não é
   * desfeita por reinstalar. Idempotente: a plataforma reexecuta o instalador após falha.
   */
  async upsertOnInstall(input: {
    installationId: number;
    memberId: string;
    domain: string;
  }): Promise<{ tenant: Tenant; created: boolean }> {
    for (let attempt = 1; ; attempt++) {
      try {
        const [row] = await this.db
          .insert(tenant)
          .values({
            installationId: String(input.installationId),
            memberId: input.memberId,
            domain: input.domain,
            tenantCode: generateTenantCode(),
          })
          .onConflictDoUpdate({
            target: tenant.installationId,
            set: {
              memberId: input.memberId,
              domain: input.domain,
              status: sql`case when ${tenant.status} = 'SUSPENDED' then 'SUSPENDED'::tenant_status else 'ACTIVE'::tenant_status end`,
              uninstalledAt: null,
            },
          })
          // xmax = 0 só na linha recém-inserida (não no update do conflito).
          .returning({ ...getTableColumns(tenant), created: sql<boolean>`(xmax = 0)` });
        const { created, ...saved } = row!;
        return { tenant: saved, created };
      } catch (error) {
        if (isUniqueViolation(error, 'tenant_tenant_code_uq') && attempt < CODE_ATTEMPTS) continue;
        if (isUniqueViolation(error, 'tenant_member_id_uq')) {
          throw new DomainError(
            'TENANT_MEMBER_CONFLICT',
            'Portal já vinculado a outra instalação',
            HttpStatus.CONFLICT,
            { memberId: input.memberId },
          );
        }
        throw error;
      }
    }
  }

  async markUninstalled(tenantId: string): Promise<void> {
    await this.db
      .update(tenant)
      .set({ status: 'UNINSTALLED', uninstalledAt: new Date() })
      .where(eq(tenant.id, tenantId));
  }

  /** Só sai de `ACTIVE`: suspensão e desinstalação têm precedência sobre erro de autorização. */
  async markAuthError(tenantId: string): Promise<boolean> {
    const rows = await this.db
      .update(tenant)
      .set({ status: 'AUTH_ERROR' })
      .where(and(eq(tenant.id, tenantId), eq(tenant.status, 'ACTIVE')))
      .returning({ id: tenant.id });
    return rows.length > 0;
  }

  async markAuthRestored(tenantId: string): Promise<boolean> {
    const rows = await this.db
      .update(tenant)
      .set({ status: 'ACTIVE' })
      .where(and(eq(tenant.id, tenantId), eq(tenant.status, 'AUTH_ERROR')))
      .returning({ id: tenant.id });
    return rows.length > 0;
  }
}
