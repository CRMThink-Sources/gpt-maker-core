import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CreateTriggerInput,
  createTriggerSchema,
  TRIGGER_MAX_PER_AGENT,
  type TriggerActionInput,
  type TriggerView,
  type TriggerWriteResult,
  type UpdateTriggerInput,
  updateTriggerSchema,
} from '@gptmaker/contracts';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { trigger, triggerAction } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AgentRepository } from '../agents';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;
type TriggerRow = typeof trigger.$inferSelect;
type ActionRow = typeof triggerAction.$inferSelect;

/** Segredo de assinatura de um webhook de saída (HMAC, tarefa 10.6). */
function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Gatilhos de um agente (spec agent-triggers: cadastro): evento do agente ⇒ ações no Bitrix24, na
 * ordem. Remover é lógico, no gatilho e nas ações retiradas na edição, para o histórico de
 * execuções continuar apontando para elas. O webhook de saída ganha um segredo gerado aqui,
 * mostrado uma vez só (`newSecrets`); editar a ação mantendo o `id` preserva o segredo.
 */
@Injectable()
export class TriggerService {
  constructor(
    private readonly agents: AgentRepository,
    @Inject(DB) private readonly db: Database,
  ) {}

  async list(tenantId: string, agentId: string): Promise<TriggerView[]> {
    await this.agents.getById(tenantId, agentId);
    const rows = await this.db
      .select()
      .from(trigger)
      .where(
        and(
          eq(trigger.tenantId, tenantId),
          eq(trigger.agentId, agentId),
          isNull(trigger.deletedAt),
        ),
      )
      .orderBy(asc(trigger.createdAt), asc(trigger.id));
    const actions = await this.actionsOf(rows.map((row) => row.id));
    return rows.map((row) => toView(row, actions.get(row.id) ?? []));
  }

  async create(
    tenantId: string,
    agentId: string,
    raw: CreateTriggerInput,
  ): Promise<TriggerWriteResult> {
    const input = createTriggerSchema.parse(raw);
    await this.agents.getById(tenantId, agentId);
    if (input.actions.some((action) => action.id)) {
      throw new DomainError(
        'TRIGGER_ACTION_NOT_FOUND',
        'Ação inexistente neste gatilho',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.db.transaction(async (tx) => {
      const [{ total } = { total: 0 }] = await tx
        .select({ total: count() })
        .from(trigger)
        .where(and(eq(trigger.agentId, agentId), isNull(trigger.deletedAt)));
      if (total >= TRIGGER_MAX_PER_AGENT) {
        throw new DomainError(
          'TRIGGER_LIMIT',
          `O agente já tem ${TRIGGER_MAX_PER_AGENT} gatilhos`,
          HttpStatus.CONFLICT,
          { limit: TRIGGER_MAX_PER_AGENT },
        );
      }
      const [row] = await tx
        .insert(trigger)
        .values({ tenantId, agentId, name: input.name, event: input.event, active: input.active })
        .returning();
      const newSecrets: Record<string, string> = {};
      const actions: ActionRow[] = [];
      for (const [position, action] of input.actions.entries()) {
        const created = await this.insertAction(tx, row!.id, position, action);
        if (created.secret) newSecrets[created.id] = created.secret;
        actions.push(created);
      }
      return { trigger: toView(row!, actions), newSecrets };
    });
  }

  /** `actions`, quando vem, substitui a lista: ids mantidos são editados, os ausentes saem. */
  async update(
    tenantId: string,
    agentId: string,
    id: string,
    raw: UpdateTriggerInput,
  ): Promise<TriggerWriteResult> {
    const input = updateTriggerSchema.parse(raw);
    await this.agents.getById(tenantId, agentId);
    return this.db.transaction(async (tx) => {
      const current = await this.getRow(tx, tenantId, agentId, id);
      const fields = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.event !== undefined ? { event: input.event } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      };
      const [row] = Object.keys(fields).length
        ? await tx.update(trigger).set(fields).where(eq(trigger.id, current.id)).returning()
        : [current];

      const newSecrets: Record<string, string> = {};
      if (input.actions) {
        await this.replaceActions(tx, current.id, input.actions, newSecrets);
      }
      const actions = await this.actionsOf([current.id], tx);
      return { trigger: toView(row!, actions.get(current.id) ?? []), newSecrets };
    });
  }

  /** Lógico: o gatilho sai da lista e para de disparar; o histórico fica. */
  async remove(tenantId: string, agentId: string, id: string): Promise<void> {
    await this.agents.getById(tenantId, agentId);
    const current = await this.getRow(this.db, tenantId, agentId, id);
    await this.db
      .update(trigger)
      .set({ active: false, deletedAt: new Date() })
      .where(eq(trigger.id, current.id));
  }

  private async replaceActions(
    tx: Tx,
    triggerId: string,
    inputs: TriggerActionInput[],
    newSecrets: Record<string, string>,
  ): Promise<void> {
    const existing = new Map(
      (await this.actionsOf([triggerId], tx)).get(triggerId)?.map((a) => [a.id, a]),
    );
    for (const input of inputs) {
      if (!input.id) continue;
      const kept = existing.get(input.id);
      if (!kept) {
        throw new DomainError(
          'TRIGGER_ACTION_NOT_FOUND',
          'Ação inexistente neste gatilho',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (kept.type !== input.type) {
        throw new DomainError(
          'TRIGGER_ACTION_TYPE_CHANGED',
          'Para trocar o tipo, remova a ação e crie outra',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const keptIds = new Set(inputs.flatMap((input) => (input.id ? [input.id] : [])));
    const removed = [...existing.keys()].filter((actionId) => !keptIds.has(actionId));
    if (removed.length) {
      await tx
        .update(triggerAction)
        .set({ deletedAt: new Date() })
        .where(inArray(triggerAction.id, removed));
    }
    // Posições temporárias negativas: reordenar sem esbarrar no índice único (gatilho, posição).
    for (const [index, actionId] of [...keptIds].entries()) {
      await tx
        .update(triggerAction)
        .set({ position: -(index + 1) })
        .where(eq(triggerAction.id, actionId));
    }
    for (const [position, input] of inputs.entries()) {
      if (input.id) {
        await tx
          .update(triggerAction)
          .set({ position, config: input.config as Record<string, unknown> })
          .where(eq(triggerAction.id, input.id));
      } else {
        const created = await this.insertAction(tx, triggerId, position, input);
        if (created.secret) newSecrets[created.id] = created.secret;
      }
    }
  }

  private async insertAction(
    tx: Tx,
    triggerId: string,
    position: number,
    action: TriggerActionInput,
  ): Promise<ActionRow> {
    const [row] = await tx
      .insert(triggerAction)
      .values({
        triggerId,
        position,
        type: action.type,
        config: action.config as Record<string, unknown>,
        secret: action.type === 'OUTBOUND_WEBHOOK' ? newSecret() : null,
      })
      .returning();
    return row!;
  }

  private async getRow(
    executor: Executor,
    tenantId: string,
    agentId: string,
    id: string,
  ): Promise<TriggerRow> {
    const [row] = await executor
      .select()
      .from(trigger)
      .where(
        and(
          eq(trigger.id, id),
          eq(trigger.tenantId, tenantId),
          eq(trigger.agentId, agentId),
          isNull(trigger.deletedAt),
        ),
      );
    if (!row)
      throw new DomainError('TRIGGER_NOT_FOUND', 'Gatilho não encontrado', HttpStatus.NOT_FOUND);
    return row;
  }

  private async actionsOf(
    triggerIds: string[],
    executor: Executor = this.db,
  ): Promise<Map<string, ActionRow[]>> {
    const grouped = new Map<string, ActionRow[]>();
    if (!triggerIds.length) return grouped;
    const rows = await executor
      .select()
      .from(triggerAction)
      .where(and(inArray(triggerAction.triggerId, triggerIds), isNull(triggerAction.deletedAt)))
      .orderBy(asc(triggerAction.position));
    for (const row of rows)
      grouped.set(row.triggerId, [...(grouped.get(row.triggerId) ?? []), row]);
    return grouped;
  }
}

function toView(row: TriggerRow, actions: ActionRow[]): TriggerView {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    event: row.event,
    active: row.active,
    actions: actions.map((action) => ({
      id: action.id,
      type: action.type,
      config: action.config,
      hasSecret: action.secret !== null,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
