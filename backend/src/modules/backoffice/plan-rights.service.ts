import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Plan } from '@crmthink-sources/platform-sdk';
import type { AdminPlansView, AdminPlanView, UpdatePlanRightsInput } from '@gptmaker/contracts';
import { inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import {
  backofficeUser,
  planAllowedModel,
  planEntitlement,
  subscriptionState,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { PlatformApiClient } from '../../shared/platform/platform-api.client';
import { ModelCatalogService } from '../models';
import { AuditService } from './audit.service';

type Rights = typeof planEntitlement.$inferSelect;

/**
 * Direitos dos planos no backoffice (spec admin-backoffice, "Gestão de direitos dos planos";
 * tarefa 15.2). Preço, intervalo e preço Stripe ficam no SPA 1138 (lidos da plataforma); aqui só
 * o que o app concede: créditos, modelos permitidos e limites de treinamento. Créditos valem a
 * partir do próximo ciclo de quem já assina (o `GRANT` é calculado na virada).
 */
@Injectable()
export class PlanRightsService {
  private readonly logger = new Logger(PlanRightsService.name);

  constructor(
    private readonly platform: PlatformApiClient,
    private readonly models: ModelCatalogService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async list(): Promise<AdminPlansView & { platformError: boolean }> {
    let platformPlans: Plan[] = [];
    let platformError = false;
    try {
      platformPlans = await this.platform.listPlans();
    } catch (error) {
      // Sem a plataforma, os direitos cadastrados continuam visíveis (e editáveis).
      platformError = true;
      this.logger.warn({ err: error }, 'planos da plataforma indisponíveis no backoffice');
    }
    const [rights, allowed, subscribers, models, operators] = await Promise.all([
      this.db.select().from(planEntitlement),
      this.db.select().from(planAllowedModel),
      this.db
        .select({ planId: subscriptionState.planId, total: sql<number>`count(*)::int` })
        .from(subscriptionState)
        .where(inArray(subscriptionState.status, ['trialing', 'active', 'past_due']))
        .groupBy(subscriptionState.planId),
      this.models.list(),
      this.db.select({ id: backofficeUser.id, name: backofficeUser.name }).from(backofficeUser),
    ]);
    // `updated_by` guarda o id do operador (ou `manual`, dos cadastros feitos direto no banco).
    const nameOf = (actor: string | null) => operators.find((op) => op.id === actor)?.name ?? actor;

    const rightsOf = new Map(rights.map((row) => [row.planSpaId, row]));
    const view = (base: Omit<AdminPlanView, 'rights' | 'subscribers'>): AdminPlanView => {
      const row = rightsOf.get(String(base.id));
      return {
        ...base,
        rights: row ? { ...this.rightsView(row, allowed), updatedBy: nameOf(row.updatedBy) } : null,
        subscribers: subscribers.find((s) => s.planId === String(base.id))?.total ?? 0,
      };
    };
    const plans = platformPlans.map((plan) =>
      view({
        id: plan.id,
        name: plan.name,
        type: plan.type,
        interval: plan.interval,
        amount: plan.amount,
        trial: plan.trial,
        onPlatform: true,
      }),
    );
    // Direitos de planos que a plataforma não lista (inativos, de outro ambiente ou removidos).
    for (const row of rights) {
      if (platformPlans.some((plan) => String(plan.id) === row.planSpaId)) continue;
      plans.push(
        view({
          id: Number(row.planSpaId),
          name: `Plano ${row.planSpaId}`,
          type: row.planType,
          interval: null,
          amount: 0,
          trial: false,
          onPlatform: false,
        }),
      );
    }
    plans.sort((a, b) => a.type.localeCompare(b.type) || a.amount - b.amount || a.id - b.id);

    return {
      plans,
      models: models
        .filter((model) => model.deletedAt === null)
        .map((model) => ({
          id: model.id,
          code: model.code,
          displayName: model.displayName,
          creditsPerResponse: model.creditsPerResponse,
          isDefault: model.isDefault,
          active: model.active,
        })),
      platformError,
    };
  }

  async update(
    planId: number,
    input: UpdatePlanRightsInput,
    actor: string,
  ): Promise<AdminPlanView> {
    const before = (await this.list()).plans.find((plan) => plan.id === planId);
    if (before?.onPlatform && before.type !== input.type) {
      throw new DomainError(
        'PLAN_TYPE_MISMATCH',
        'O tipo do plano é definido no SPA de Planos.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const subscription = input.type === 'subscription';
    // Modelos validados antes de gravar qualquer coisa: só ativos e não removidos.
    if (subscription && input.allowedModelIds.length) {
      const valid = new Set(
        (await this.models.list())
          .filter((model) => model.active && model.deletedAt === null)
          .map((model) => model.id),
      );
      const invalid = input.allowedModelIds.filter((id) => !valid.has(id));
      if (invalid.length) {
        throw new DomainError(
          'MODEL_NOT_AVAILABLE',
          'Só modelos ativos podem ser permitidos no plano.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { modelIds: invalid },
        );
      }
    }
    const values = {
      planType: input.type,
      active: input.active,
      creditsPerCycle: subscription ? input.creditsPerCycle : null,
      creditsPerPackage: subscription ? null : input.creditsPerPackage,
      maxTrainings: subscription ? input.maxTrainings : null,
      maxDocumentStorageMb: subscription ? input.maxDocumentStorageMb : null,
      updatedBy: actor,
    };
    await this.db
      .insert(planEntitlement)
      .values({ planSpaId: String(planId), ...values })
      .onConflictDoUpdate({ target: planEntitlement.planSpaId, set: values });
    // Valida os modelos (só ativos) e substitui a lista; pacote não tem modelos.
    await this.models.setPlanAllowedModels(
      String(planId),
      { modelIds: subscription ? input.allowedModelIds : [] },
      actor,
    );

    const after = (await this.list()).plans.find((plan) => plan.id === planId)!;
    await this.audit.record({
      actorId: actor,
      action: 'plan.rights_updated',
      entityType: 'plan',
      entityId: String(planId),
      before: before?.rights ?? null,
      after: after.rights,
    });
    return after;
  }

  private rightsView(
    row: Rights,
    allowed: Array<typeof planAllowedModel.$inferSelect>,
  ): NonNullable<AdminPlanView['rights']> {
    return {
      active: row.active,
      creditsPerCycle: row.creditsPerCycle,
      creditsPerPackage: row.creditsPerPackage,
      maxTrainings: row.maxTrainings,
      maxDocumentStorageMb: row.maxDocumentStorageMb,
      allowedModelIds: allowed.filter((a) => a.planSpaId === row.planSpaId).map((a) => a.modelId),
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
