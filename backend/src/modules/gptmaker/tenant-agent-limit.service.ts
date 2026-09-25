import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, count, eq, ne } from 'drizzle-orm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { agent } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';

/** Executor aceito: conexão normal ou transação aberta pelo chamador. */
type Executor = Pick<Database, 'select'>;

/**
 * Limite de agentes não removidos (ativos, inativos ou fora de sincronia) por tenant, igual para
 * todos os planos; protege o workspace compartilhado (spec gptmaker-workspace).
 */
@Injectable()
export class TenantAgentLimitService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get limit(): number {
    return this.env.TENANT_AGENT_LIMIT;
  }

  async countNonDeleted(tenantId: string, executor: Executor = this.db): Promise<number> {
    const [row] = await executor
      .select({ total: count() })
      .from(agent)
      .where(and(eq(agent.tenantId, tenantId), ne(agent.status, 'DELETED')));
    return row?.total ?? 0;
  }

  /**
   * Recusa com `TENANT_AGENT_LIMIT` antes de qualquer chamada ao GPTMaker. Criações simultâneas
   * do mesmo tenant precisam ser serializadas pelo chamador (lock por tenant na criação, tarefa 7.2).
   */
  async assertCanCreate(tenantId: string, executor: Executor = this.db): Promise<void> {
    const total = await this.countNonDeleted(tenantId, executor);
    if (total >= this.limit) {
      throw new DomainError(
        'TENANT_AGENT_LIMIT',
        `Limite de ${this.limit} agentes atingido; remova um agente para criar outro`,
        HttpStatus.CONFLICT,
        { limit: this.limit, current: total },
      );
    }
  }
}
