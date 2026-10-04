import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne, type SQL } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';

export type Agent = typeof agent.$inferSelect;
export type AgentStatus = Agent['status'];

/** Campos gravados na criação; `tenantId` vem sempre do argumento, nunca do chamador. */
export type NewAgent = Omit<
  typeof agent.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/** Campos alteráveis: posse (`tenantId`) e vínculo com o GPTMaker (`gptmakerAgentId`) são fixos. */
export type AgentPatch = Partial<
  Omit<NewAgent, 'gptmakerAgentId' | 'webhookTokenHash'> & Pick<Agent, 'deletedAt'>
>;

/** Executor aceito: conexão normal ou transação aberta pelo chamador. */
export type Executor = Pick<Database, 'select' | 'insert' | 'update'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Único acesso do domínio de agentes à tabela `agent` (design D2): todo método exige o `tenantId`
 * da sessão e filtra por ele, pois todos os agentes vivem no mesmo workspace GPTMaker. Agente de
 * outro tenant, removido ou com id malformado é tratado como inexistente, sem revelar que existe.
 */
@Injectable()
export class AgentRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Agentes não removidos do tenant, do mais antigo ao mais novo. */
  list(
    tenantId: string,
    filter: { status?: Exclude<AgentStatus, 'DELETED'> } = {},
    executor: Executor = this.db,
  ): Promise<Agent[]> {
    return executor
      .select()
      .from(agent)
      .where(this.scope(tenantId, filter.status ? eq(agent.status, filter.status) : undefined))
      .orderBy(asc(agent.createdAt), asc(agent.id));
  }

  async findById(
    tenantId: string,
    id: string,
    executor: Executor = this.db,
  ): Promise<Agent | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await executor
      .select()
      .from(agent)
      .where(this.scope(tenantId, eq(agent.id, id)));
    return row;
  }

  /** Agente local (de qualquer tenant, inclusive removido) ligado a um agente do GPTMaker. */
  async findByGptMakerId(gptmakerAgentId: string): Promise<Agent | undefined> {
    const [row] = await this.db
      .select()
      .from(agent)
      .where(eq(agent.gptmakerAgentId, gptmakerAgentId));
    return row;
  }

  /** Como `findById`, mas responde 404 `AGENT_NOT_FOUND` (spec agent-management: isolamento). */
  async getById(tenantId: string, id: string, executor: Executor = this.db): Promise<Agent> {
    const row = await this.findById(tenantId, id, executor);
    if (!row) throw agentNotFound();
    return row;
  }

  async insert(tenantId: string, values: NewAgent, executor: Executor = this.db): Promise<Agent> {
    const [row] = await executor
      .insert(agent)
      .values({ ...values, tenantId })
      .returning();
    return row!;
  }

  /** Atualiza só se o agente for do tenant e não estiver removido; `undefined` caso contrário. */
  async update(
    tenantId: string,
    id: string,
    patch: AgentPatch,
    executor: Executor = this.db,
  ): Promise<Agent | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await executor
      .update(agent)
      .set(patch)
      .where(this.scope(tenantId, eq(agent.id, id)))
      .returning();
    return row;
  }

  /** Soft delete: o registro fica para preservar o histórico de consumo. */
  markDeleted(tenantId: string, id: string, executor: Executor = this.db) {
    return this.update(
      tenantId,
      id,
      { status: 'DELETED', inactiveReason: null, deletedAt: new Date() },
      executor,
    );
  }

  private scope(tenantId: string, condition?: SQL): SQL {
    return and(eq(agent.tenantId, tenantId), ne(agent.status, 'DELETED'), condition)!;
  }
}

const agentNotFound = () =>
  new DomainError('AGENT_NOT_FOUND', 'Agente não encontrado', HttpStatus.NOT_FOUND);
