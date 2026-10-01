import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { subscriptionState } from '../../shared/database/schema/index';
import type { TenantStatus } from '../tenancy';
import type { Agent } from './agent.repository';

/** Motivos de inativação aplicados pelo sistema; `MANUAL` é do tenant e o sistema não mexe. */
export type SystemInactiveReason = Exclude<NonNullable<Agent['inactiveReason']>, 'MANUAL'>;

export const SYSTEM_REASONS: readonly SystemInactiveReason[] = [
  'UNINSTALLED',
  'TENANT_SUSPENDED',
  'SUBSCRIPTION_EXPIRED',
];

/**
 * Se os agentes do tenant podem funcionar agora e, se não, por quê (spec agent-management:
 * inativação automática). Com várias causas, vale a primeira: desinstalação, suspensão,
 * assinatura. Sem projeção da assinatura, nada bloqueia: a plataforma cria o trial sozinha.
 */
@Injectable()
export class AgentAccessPolicy {
  constructor(@Inject(DB) private readonly db: Database) {}

  async blockingReason(
    tenantId: string,
    tenantStatus: TenantStatus,
    now = new Date(),
  ): Promise<SystemInactiveReason | null> {
    if (tenantStatus === 'UNINSTALLED') return 'UNINSTALLED';
    if (tenantStatus === 'SUSPENDED') return 'TENANT_SUSPENDED';
    return (await this.subscriptionEnded(tenantId, now)) ? 'SUBSCRIPTION_EXPIRED' : null;
  }

  /** Encerrada (cancelada, trial expirado) ou em atraso com a carência vencida (design D9). */
  private async subscriptionEnded(tenantId: string, now: Date): Promise<boolean> {
    const [row] = await this.db
      .select({ status: subscriptionState.status, graceUntil: subscriptionState.graceUntil })
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, tenantId));
    if (!row) return false;
    if (row.status === 'cancelled' || row.status === 'trial_expired') return true;
    return row.status === 'past_due' && row.graceUntil !== null && row.graceUntil <= now;
  }
}
