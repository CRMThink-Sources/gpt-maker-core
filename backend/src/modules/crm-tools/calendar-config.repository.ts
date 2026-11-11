import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agentCalendarConfig, agentCrmAccess } from '../../shared/database/schema/index';

export type CalendarConfigRow = typeof agentCalendarConfig.$inferSelect;
export type CalendarConfigValues = Pick<
  typeof agentCalendarConfig.$inferInsert,
  'mode' | 'userIds' | 'slotMinutes' | 'minNoticeMinutes' | 'maxDaysAhead'
>;

/**
 * Persistência da agenda do agente (spec agent-calendar-scheduling, design D2). Toda consulta e
 * escrita filtra por `tenantId`: o agente já foi resolvido contra o tenant da sessão, mas a
 * tabela não depende disso.
 */
@Injectable()
export class CalendarConfigRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async find(tenantId: string, agentId: string): Promise<CalendarConfigRow | undefined> {
    const [row] = await this.db.select().from(agentCalendarConfig).where(scope(tenantId, agentId));
    return row;
  }

  /** Cria ou substitui a configuração; mudar a agenda não apaga o aviso de escopo ausente. */
  async upsert(
    tenantId: string,
    agentId: string,
    values: CalendarConfigValues,
  ): Promise<CalendarConfigRow | undefined> {
    // `undefined` só se a linha existir em outro tenant: o conflito não atualiza e nada volta.
    const [row] = await this.db
      .insert(agentCalendarConfig)
      .values({ agentId, tenantId, ...values })
      .onConflictDoUpdate({
        target: agentCalendarConfig.agentId,
        set: values,
        setWhere: eq(agentCalendarConfig.tenantId, tenantId),
      })
      .returning();
    return row;
  }

  async remove(tenantId: string, agentId: string): Promise<void> {
    await this.db.delete(agentCalendarConfig).where(scope(tenantId, agentId));
  }

  /** Marca (ou, com `null`, limpa) a última chamada recusada por falta do escopo `calendar`. */
  async setScopeError(tenantId: string, agentId: string, at: Date | null): Promise<void> {
    await this.db
      .update(agentCalendarConfig)
      .set({ lastScopeErrorAt: at })
      .where(scope(tenantId, agentId));
  }

  /** O acesso ao CRM do agente está conectado (pré-requisito da agenda). */
  async crmConnected(tenantId: string, agentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ status: agentCrmAccess.status })
      .from(agentCrmAccess)
      .where(and(eq(agentCrmAccess.agentId, agentId), eq(agentCrmAccess.tenantId, tenantId)));
    return row?.status === 'CONNECTED';
  }
}

function scope(tenantId: string, agentId: string) {
  return and(eq(agentCalendarConfig.agentId, agentId), eq(agentCalendarConfig.tenantId, tenantId));
}
