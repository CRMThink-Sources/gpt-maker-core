import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminModelCostChange,
  AdminModelView,
  CreateModelInput,
  RemoveModelInput,
  UpdateModelInput,
} from '@gptmaker/contracts';
import { ne, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, backofficeUser, planAllowedModel } from '../../shared/database/schema/index';
import { type AiModel, ModelCatalogService } from '../models';
import { ModelCostInsights } from '../reconciliation';
import { AuditService } from './audit.service';

const snapshot = (model: AiModel) => ({
  displayName: model.displayName,
  creditsPerResponse: model.creditsPerResponse,
  active: model.active,
  isDefault: model.isDefault,
});

/**
 * Catálogo de modelos no backoffice (spec ai-model-catalog e admin-backoffice; tarefas 15.3 e
 * 14.3): as regras ficam no `ModelCatalogService` (código fixo, padrão único e ativo, histórico de
 * custo, remoção com substituto migrando os agentes); aqui só a visão do operador, com o uso e a
 * média real da reconciliação, e a auditoria.
 */
@Injectable()
export class ModelsAdminService {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly insights: ModelCostInsights,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async list(): Promise<AdminModelView[]> {
    const models = await this.catalog.list();
    const [using, allowing, insights] = await Promise.all([
      this.db
        .select({ modelId: agent.modelId, total: sql<number>`count(*)::int` })
        .from(agent)
        .where(ne(agent.status, 'DELETED'))
        .groupBy(agent.modelId),
      this.db
        .select({ modelId: planAllowedModel.modelId, total: sql<number>`count(*)::int` })
        .from(planAllowedModel)
        .groupBy(planAllowedModel.modelId),
      this.insights.byModel(new Map(models.map((m) => [m.code, m.creditsPerResponse]))),
    ]);
    return models
      .map((model) => ({
        id: model.id,
        code: model.code,
        displayName: model.displayName,
        description: model.description,
        creditsPerResponse: model.creditsPerResponse,
        active: model.active,
        isDefault: model.isDefault,
        agentsUsing: using.find((u) => u.modelId === model.id)?.total ?? 0,
        plansAllowing: allowing.find((a) => a.modelId === model.id)?.total ?? 0,
        insight: insights.get(model.code) ?? {
          average: null,
          real: 0,
          responses: 0,
          suggestion: null,
          stale: false,
        },
      }))
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          Number(b.active) - Number(a.active) ||
          a.creditsPerResponse - b.creditsPerResponse ||
          a.displayName.localeCompare(b.displayName),
      );
  }

  async history(modelId: string): Promise<AdminModelCostChange[]> {
    await this.catalog.get(modelId);
    const [rows, operators] = await Promise.all([
      this.catalog.costHistory(modelId),
      this.db.select({ id: backofficeUser.id, name: backofficeUser.name }).from(backofficeUser),
    ]);
    return rows.map((row) => ({
      changedAt: row.changedAt.toISOString(),
      previousCost: row.previousCost,
      newCost: row.newCost,
      changedBy: operators.find((op) => op.id === row.changedBy)?.name ?? row.changedBy,
    }));
  }

  async create(input: CreateModelInput, actor: string): Promise<AiModel> {
    const model = await this.catalog.create(input);
    await this.record(actor, 'model.created', model.id, null, {
      code: model.code,
      ...snapshot(model),
    });
    return model;
  }

  async update(id: string, input: UpdateModelInput, actor: string): Promise<AiModel> {
    const before = await this.catalog.get(id);
    const after = await this.catalog.update(id, input, actor);
    await this.record(actor, 'model.updated', id, snapshot(before), snapshot(after));
    return after;
  }

  async setDefault(id: string, actor: string): Promise<AiModel> {
    const model = await this.catalog.setDefault(id);
    await this.record(actor, 'model.default_set', id, null, snapshot(model));
    return model;
  }

  async setActive(id: string, active: boolean, actor: string): Promise<AiModel> {
    const model = active ? await this.catalog.activate(id) : await this.catalog.deactivate(id);
    await this.record(
      actor,
      active ? 'model.activated' : 'model.deactivated',
      id,
      null,
      snapshot(model),
    );
    return model;
  }

  async remove(
    id: string,
    input: RemoveModelInput,
    actor: string,
  ): Promise<{ migratedAgents: number }> {
    const before = await this.catalog.get(id);
    const result = await this.catalog.remove(id, input);
    await this.record(actor, 'model.removed', id, snapshot(before), {
      replacementModelId: input.replacementModelId ?? null,
      migratedAgents: result.migratedAgents,
    });
    return result;
  }

  private record(actor: string, action: string, id: string, before: unknown, after: unknown) {
    return this.audit.record({
      actorId: actor,
      action,
      entityType: 'ai_model',
      entityId: id,
      before,
      after,
    });
  }
}
