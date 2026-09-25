import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  createModelSchema,
  planAllowedModelsSchema,
  removeModelSchema,
  updateModelSchema,
  type CreateModelInput,
  type PlanAllowedModelsInput,
  type RemoveModelInput,
  type UpdateModelInput,
} from '@gptmaker/contracts';
import { and, asc, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  aiModel,
  aiModelCostHistory,
  planAllowedModel,
  planEntitlement,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { GPTMAKER_KNOWN_MODELS, GptMakerClient } from '../gptmaker';

export type AiModel = typeof aiModel.$inferSelect;

/** Modelo oferecido ao tenant na escolha do modelo do agente. */
export interface AllowedModel {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  creditsPerResponse: number;
  isDefault: boolean;
}

export interface AffectedAgent {
  id: string;
  tenantId: string;
  name: string;
  status: string;
}

/**
 * Catálogo de modelos (spec ai-model-catalog). `actor` identifica o autor da alteração
 * (ex.: `operator:<id>`); a autorização fica na borda HTTP do backoffice (tarefa 15.1).
 */
@Injectable()
export class ModelCatalogService {
  private readonly logger = new Logger(ModelCatalogService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gptmaker: GptMakerClient,
  ) {}

  list(options: { includeDeleted?: boolean } = {}): Promise<AiModel[]> {
    return this.db
      .select()
      .from(aiModel)
      .where(options.includeDeleted ? undefined : isNull(aiModel.deletedAt))
      .orderBy(asc(aiModel.displayName));
  }

  async get(id: string): Promise<AiModel> {
    const [row] = await this.db
      .select()
      .from(aiModel)
      .where(and(eq(aiModel.id, id), isNull(aiModel.deletedAt)));
    if (!row)
      throw new DomainError('MODEL_NOT_FOUND', 'Modelo não encontrado', HttpStatus.NOT_FOUND);
    return row;
  }

  async create(raw: CreateModelInput): Promise<AiModel> {
    const input = createModelSchema.parse(raw);
    if (!GPTMAKER_KNOWN_MODELS.includes(input.code) && !input.confirmUnknownCode) {
      throw new DomainError(
        'MODEL_CODE_UNKNOWN',
        `O código ${input.code} não está na lista conhecida do GPTMaker; confirme para cadastrar`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        { code: input.code },
      );
    }
    if (input.isDefault && !input.active) throw inactiveDefault();
    const [existing] = await this.db
      .select({ id: aiModel.id })
      .from(aiModel)
      .where(and(eq(aiModel.code, input.code), isNull(aiModel.deletedAt)));
    if (existing) throw duplicateCode(input.code);

    try {
      return await this.db.transaction(async (tx) => {
        if (input.isDefault)
          await tx.update(aiModel).set({ isDefault: false }).where(eq(aiModel.isDefault, true));
        const [row] = await tx
          .insert(aiModel)
          .values({
            code: input.code,
            displayName: input.displayName,
            description: input.description ?? null,
            creditsPerResponse: input.creditsPerResponse,
            active: input.active,
            isDefault: input.isDefault,
          })
          .returning();
        return row!;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'ai_model_code_uq')) throw duplicateCode(input.code);
      throw error;
    }
  }

  /** Custo novo vale para respostas processadas depois; a alteração fica no histórico. */
  async update(id: string, raw: UpdateModelInput, actor: string): Promise<AiModel> {
    const input = updateModelSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(aiModel)
        .where(and(eq(aiModel.id, id), isNull(aiModel.deletedAt)))
        .for('update');
      if (!current) throw notFound();
      const costChanged =
        input.creditsPerResponse !== undefined &&
        input.creditsPerResponse !== current.creditsPerResponse;
      if (Object.keys(input).length === 0) return current;
      const [row] = await tx.update(aiModel).set(input).where(eq(aiModel.id, id)).returning();
      if (costChanged) {
        await tx.insert(aiModelCostHistory).values({
          modelId: id,
          previousCost: current.creditsPerResponse,
          newCost: input.creditsPerResponse!,
          changedBy: actor,
        });
        this.logger.log(
          {
            modelId: id,
            code: current.code,
            from: current.creditsPerResponse,
            to: input.creditsPerResponse,
            actor,
          },
          'custo do modelo alterado',
        );
      }
      return row!;
    });
  }

  costHistory(modelId: string) {
    return this.db
      .select()
      .from(aiModelCostHistory)
      .where(eq(aiModelCostHistory.modelId, modelId))
      .orderBy(desc(aiModelCostHistory.changedAt));
  }

  /** Marca como padrão; qualquer outro deixa de ser. */
  async setDefault(id: string): Promise<AiModel> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(aiModel)
        .where(and(eq(aiModel.id, id), isNull(aiModel.deletedAt)))
        .for('update');
      if (!current) throw notFound();
      if (!current.active) throw inactiveDefault();
      await tx
        .update(aiModel)
        .set({ isDefault: false })
        .where(and(eq(aiModel.isDefault, true), ne(aiModel.id, id)));
      const [row] = await tx
        .update(aiModel)
        .set({ isDefault: true })
        .where(eq(aiModel.id, id))
        .returning();
      return row!;
    });
  }

  async activate(id: string): Promise<AiModel> {
    await this.get(id);
    const [row] = await this.db
      .update(aiModel)
      .set({ active: true })
      .where(eq(aiModel.id, id))
      .returning();
    return row!;
  }

  /** Inativo não pode ser escolhido em novos agentes; os agentes atuais seguem com ele. */
  async deactivate(id: string): Promise<AiModel> {
    const current = await this.get(id);
    if (current.isDefault) throw isDefault();
    const [row] = await this.db
      .update(aiModel)
      .set({ active: false })
      .where(eq(aiModel.id, id))
      .returning();
    return row!;
  }

  /**
   * Soft delete. Com agentes não removidos usando o modelo, exige substituto ativo e migra cada
   * agente (settings no GPTMaker, depois o registro local). Falha em algum agente interrompe a
   * remoção sem desfazer os já migrados; repetir a chamada continua de onde parou. O modelo é
   * inativado antes da migração para não ser escolhido por agentes novos no meio do caminho.
   */
  async remove(id: string, raw: RemoveModelInput = {}): Promise<{ migratedAgents: number }> {
    const { replacementModelId } = removeModelSchema.parse(raw);
    const current = await this.get(id);
    if (current.isDefault) throw isDefault();

    const affected = await this.agentsUsing(id);
    if (affected.length > 0 && !replacementModelId) {
      throw new DomainError(
        'MODEL_IN_USE',
        'Modelo em uso por agentes; informe um modelo substituto',
        HttpStatus.CONFLICT,
        { agents: affected },
      );
    }

    let migratedAgents = 0;
    if (affected.length > 0) {
      const replacement = await this.get(replacementModelId!).catch(() => {
        throw new DomainError(
          'REPLACEMENT_MODEL_INVALID',
          'Modelo substituto não encontrado',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      });
      if (replacement.id === id || !replacement.active) {
        throw new DomainError(
          'REPLACEMENT_MODEL_INVALID',
          'O substituto deve ser outro modelo ativo',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (current.active)
        await this.db.update(aiModel).set({ active: false }).where(eq(aiModel.id, id));
      migratedAgents = await this.migrateAgents(id, replacement);
    }

    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: aiModel.id })
        .from(aiModel)
        .where(eq(aiModel.id, id))
        .for('update');
      if (!locked) throw notFound();
      const remaining = await this.agentsUsing(id, tx);
      if (remaining.length > 0) {
        throw new DomainError(
          'MODEL_IN_USE',
          'Modelo passou a ser usado por outros agentes durante a remoção; tente novamente',
          HttpStatus.CONFLICT,
          { agents: remaining },
        );
      }
      await tx.delete(planAllowedModel).where(eq(planAllowedModel.modelId, id));
      await tx
        .update(aiModel)
        .set({ active: false, deletedAt: new Date() })
        .where(eq(aiModel.id, id));
    });
    this.logger.log(
      { modelId: id, code: current.code, replacementModelId, migratedAgents },
      'modelo removido',
    );
    return { migratedAgents };
  }

  /** Substitui a lista de modelos permitidos do plano; só modelos ativos. */
  async setPlanAllowedModels(
    planSpaId: string,
    raw: PlanAllowedModelsInput,
    actor: string,
  ): Promise<AllowedModel[]> {
    const modelIds = [...new Set(planAllowedModelsSchema.parse(raw).modelIds)];
    const [plan] = await this.db
      .select({ planSpaId: planEntitlement.planSpaId })
      .from(planEntitlement)
      .where(eq(planEntitlement.planSpaId, planSpaId));
    if (!plan)
      throw new DomainError(
        'PLAN_NOT_FOUND',
        'Plano sem direitos cadastrados',
        HttpStatus.NOT_FOUND,
      );

    if (modelIds.length > 0) {
      const valid = await this.db
        .select({ id: aiModel.id })
        .from(aiModel)
        .where(
          and(inArray(aiModel.id, modelIds), eq(aiModel.active, true), isNull(aiModel.deletedAt)),
        );
      const validIds = new Set(valid.map((row) => row.id));
      const invalid = modelIds.filter((modelId) => !validIds.has(modelId));
      if (invalid.length > 0) {
        throw new DomainError(
          'MODEL_NOT_AVAILABLE',
          'Só modelos ativos podem ser permitidos no plano',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { modelIds: invalid },
        );
      }
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(planAllowedModel).where(eq(planAllowedModel.planSpaId, planSpaId));
      if (modelIds.length > 0) {
        await tx
          .insert(planAllowedModel)
          .values(modelIds.map((modelId) => ({ planSpaId, modelId })));
      }
      await tx
        .update(planEntitlement)
        .set({ updatedBy: actor })
        .where(eq(planEntitlement.planSpaId, planSpaId));
    });
    return this.listAllowedForPlan(planSpaId);
  }

  /** Modelos que o tenant do plano pode escolher: permitidos, ativos e não removidos. */
  listAllowedForPlan(planSpaId: string): Promise<AllowedModel[]> {
    return this.db
      .select({
        id: aiModel.id,
        code: aiModel.code,
        displayName: aiModel.displayName,
        description: aiModel.description,
        creditsPerResponse: aiModel.creditsPerResponse,
        isDefault: aiModel.isDefault,
      })
      .from(planAllowedModel)
      .innerJoin(aiModel, eq(aiModel.id, planAllowedModel.modelId))
      .where(
        and(
          eq(planAllowedModel.planSpaId, planSpaId),
          eq(aiModel.active, true),
          isNull(aiModel.deletedAt),
        ),
      )
      .orderBy(asc(aiModel.creditsPerResponse), asc(aiModel.displayName));
  }

  async isAllowedForPlan(planSpaId: string, modelId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ total: count() })
      .from(planAllowedModel)
      .innerJoin(aiModel, eq(aiModel.id, planAllowedModel.modelId))
      .where(
        and(
          eq(planAllowedModel.planSpaId, planSpaId),
          eq(planAllowedModel.modelId, modelId),
          eq(aiModel.active, true),
          isNull(aiModel.deletedAt),
        ),
      );
    return (row?.total ?? 0) > 0;
  }

  private agentsUsing(
    modelId: string,
    executor: Pick<Database, 'select'> = this.db,
  ): Promise<AffectedAgent[]> {
    return executor
      .select({ id: agent.id, tenantId: agent.tenantId, name: agent.name, status: agent.status })
      .from(agent)
      .where(and(eq(agent.modelId, modelId), ne(agent.status, 'DELETED')));
  }

  private async migrateAgents(fromModelId: string, replacement: AiModel): Promise<number> {
    const rows = await this.db
      .select({
        id: agent.id,
        gptmakerAgentId: agent.gptmakerAgentId,
        status: agent.status,
        settings: agent.settings,
      })
      .from(agent)
      .where(and(eq(agent.modelId, fromModelId), ne(agent.status, 'DELETED')));

    let migrated = 0;
    const failed: Array<{ agentId: string; reason: string }> = [];
    for (const row of rows) {
      try {
        // Agente fora de sincronia não existe no GPTMaker: só o registro local muda.
        if (row.status !== 'OUT_OF_SYNC') {
          // Semântica do PUT (merge ou substituição) não documentada: envia as settings locais junto.
          await this.gptmaker.updateAgentSettings(row.gptmakerAgentId, {
            ...row.settings,
            prefferModel: replacement.code,
          });
        }
        await this.db
          .update(agent)
          .set({ modelId: replacement.id })
          .where(and(eq(agent.id, row.id), eq(agent.modelId, fromModelId)));
        migrated++;
      } catch (error) {
        this.logger.warn(
          { agentId: row.id, err: error },
          'falha ao migrar agente para o modelo substituto',
        );
        failed.push({
          agentId: row.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (failed.length > 0) {
      throw new DomainError(
        'MODEL_MIGRATION_FAILED',
        'Nem todos os agentes foram migrados; o modelo não foi removido. Tente novamente',
        HttpStatus.BAD_GATEWAY,
        { migrated, failed },
      );
    }
    return migrated;
  }
}

const notFound = () =>
  new DomainError('MODEL_NOT_FOUND', 'Modelo não encontrado', HttpStatus.NOT_FOUND);

const duplicateCode = (code: string) =>
  new DomainError(
    'MODEL_CODE_DUPLICATE',
    `Já existe um modelo com o código ${code}`,
    HttpStatus.CONFLICT,
    {
      code,
    },
  );

const inactiveDefault = () =>
  new DomainError(
    'MODEL_INACTIVE',
    'O modelo padrão precisa estar ativo',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

const isDefault = () =>
  new DomainError(
    'MODEL_IS_DEFAULT',
    'O modelo padrão não pode ser inativado nem removido; defina outro padrão antes',
    HttpStatus.CONFLICT,
  );

function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (
    let current: unknown = error;
    current && typeof current === 'object';
    current = (current as { cause?: unknown }).cause
  ) {
    const pg = current as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === constraint) return true;
  }
  return false;
}
