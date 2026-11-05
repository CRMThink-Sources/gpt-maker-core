import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CompiledAgent,
  compileAgent,
  intentionHash,
  planPublication,
  publishedStateOf,
  trainingHash,
  transferHash,
} from '@gptmaker/contracts';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { currentContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agentFunctionConfig,
  agentIntention,
  agentManagedResource,
  training,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { AgentRepository, AgentService } from '../agents';
import { CrmAccessService } from '../crm-tools';
import { GptMakerClient, GptMakerError } from '../gptmaker';
import { IntentionService } from '../intentions';
import { TrainingService } from '../training';
import { FunctionCatalog } from './function-catalog.service';
import {
  currentState,
  emptyState,
  type FunctionConfig,
  type ManagedResource,
} from './function-state';
import { mediaTrainings } from './function-training-policy';
import { transferTargets } from './function-transfer-targets';

// Dezenas de treinamentos, cada um com criação e listagem no GPTMaker.
const LOCK_TTL_MS = 10 * 60_000;
const MANAGED = { managed: true } as const;

export type PublishRun = 'DONE' | 'FAILED' | 'SKIPPED';

/**
 * Executa a publicação pendente de um agente (design D5): compila de novo o alvo gravado, aplica
 * o perfil e depois remove, atualiza e cria os treinamentos e as intenções gerenciados, gravando
 * cada passo em `agent_managed_resource`. Repetir uma publicação que falhou aplica só o que falta.
 */
@Injectable()
export class FunctionPublisher {
  private readonly logger = new Logger(FunctionPublisher.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly catalog: FunctionCatalog,
    private readonly agents: AgentService,
    private readonly agentRows: AgentRepository,
    private readonly trainings: TrainingService,
    private readonly intentions: IntentionService,
    private readonly crmAccess: CrmAccessService,
    private readonly gptmaker: GptMakerClient,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  async run(agentId: string): Promise<PublishRun> {
    const outcome = await this.lock.runExclusive(`function-publish:${agentId}`, LOCK_TTL_MS, () =>
      this.runLocked(agentId),
    );
    return outcome.ran ? outcome.result : 'SKIPPED';
  }

  private async runLocked(agentId: string): Promise<PublishRun> {
    const [config] = await this.db
      .select()
      .from(agentFunctionConfig)
      .where(eq(agentFunctionConfig.agentId, agentId));
    if (!config?.publicationTarget || config.publicationStatus === 'IDLE') return 'SKIPPED';
    const target = config.publicationTarget;

    try {
      const owner = await this.agentRows.getById(config.tenantId, agentId);
      const { content } = await this.catalog.versionById(target.versionId);
      const compiled = compileAgent({
        content,
        answers: target.answers,
        agentName: owner.name,
        mode: target.mode,
        additionalInstructions: target.additionalInstructions,
        takenOverBehavior: target.takenOverBehavior,
      });
      if (compiled.errors.length) throw new Error(compiled.errors.join('; '));
      // Destinos conferidos antes de qualquer chamada: falha não deixa a publicação pela metade.
      const targets = await transferTargets(this.db, config.tenantId, agentId, compiled, content);

      await this.applyProfile(config, compiled);
      await this.applyTrainings(config, compiled);
      await this.applyIntentions(config, compiled);
      await this.applyTransfers(config, compiled, targets, owner.gptmakerAgentId);
      // Exigido pela função; tirar o bloco depois não desliga (o cliente pode ter ligado à mão).
      if (compiled.crmAccess) await this.crmAccess.ensureEnabled(config.tenantId, agentId);
      // Fora do modo avançado, site e vídeo saem (spec "Desligar o modo avançado").
      if (target.mode !== 'ADVANCED') {
        for (const media of await mediaTrainings(this.db, agentId)) {
          await ignoreNotFound(() => this.trainings.remove(config.tenantId, agentId, media.id));
        }
      }

      await this.db
        .update(agentFunctionConfig)
        .set({
          versionId: target.versionId,
          answers: target.answers,
          draftAnswers: null,
          mode: target.mode,
          additionalInstructions: target.additionalInstructions,
          takenOverBehavior: target.takenOverBehavior,
          publishedState: publishedStateOf(compiled),
          publicationStatus: 'IDLE',
          publicationTarget: null,
          publicationError: null,
          needsRepublishReason: null,
        })
        .where(eq(agentFunctionConfig.agentId, agentId));
      return 'DONE';
    } catch (error) {
      const traceId = currentContext()?.traceId;
      const message =
        error instanceof DomainError
          ? `${error.code}: ${error.message}`
          : String((error as Error).message ?? error);
      this.logger.error({ agentId, traceId, err: error }, 'publicação da função falhou');
      await this.db
        .update(agentFunctionConfig)
        .set({
          publicationStatus: 'FAILED',
          publicationError: traceId ? `${message} (rastreio ${traceId})` : message,
        })
        .where(eq(agentFunctionConfig.agentId, agentId));
      return 'FAILED';
    }
  }

  /** Comportamento, tipo, tom, dados da empresa e settings; gravado antes da base (design D5). */
  private async applyProfile(config: FunctionConfig, compiled: CompiledAgent): Promise<void> {
    const { state } = await currentState(this.db, config);
    const plan = planPublication(compiled, state ?? emptyState(compiled));
    if (!plan.behavior.changed && plan.agent.length === 0 && plan.settings.length === 0) return;
    await this.agents.applyFunctionProfile({ tenantId: config.tenantId }, config.agentId, {
      profile: {
        behavior: compiled.behavior,
        type: compiled.agentType,
        communicationType: compiled.communicationType,
        jobName: compiled.profile.jobName || null,
        jobSite: compiled.profile.jobSite || null,
        jobDescription: compiled.profile.jobDescription || null,
      },
      settings: compiled.settings,
    });
    const next = publishedStateOf(compiled);
    await this.db
      .update(agentFunctionConfig)
      .set({
        // Recursos seguem pelos registros gerenciados até o fim da publicação.
        publishedState: {
          ...next,
          trainings: state?.trainings ?? [],
          intentions: state?.intentions ?? [],
        },
      })
      .where(eq(agentFunctionConfig.agentId, config.agentId));
  }

  private async applyTrainings(config: FunctionConfig, compiled: CompiledAgent): Promise<void> {
    const { tenantId, agentId } = config;
    const resources = await this.resources(agentId, 'TRAINING');
    const wanted = new Map(compiled.trainings.map((item) => [item.key, item]));

    for (const resource of resources) {
      if (wanted.has(resource.key)) continue;
      if (resource.trainingId) {
        await ignoreNotFound(() =>
          this.trainings.remove(tenantId, agentId, resource.trainingId!, MANAGED),
        );
      }
      await this.dropResource(resource.id);
    }

    const byKey = new Map(resources.map((resource) => [resource.key, resource]));
    for (const item of compiled.trainings) {
      const hash = trainingHash(item);
      const resource = byKey.get(item.key);
      if (resource?.trainingId) {
        if (resource.hash === hash) continue;
        await this.trainings.updateText(
          tenantId,
          agentId,
          resource.trainingId,
          { text: item.text },
          MANAGED,
        );
        await this.setResource(resource.id, hash, { trainingId: resource.trainingId });
        continue;
      }
      // Criado numa tentativa que caiu antes de gravar o recurso: adota em vez de duplicar.
      const trainingId =
        (await this.orphanTraining(agentId, item.text)) ??
        (await this.trainings.create(tenantId, agentId, { type: 'TEXT', text: item.text }, MANAGED))
          .id;
      await this.saveResource(config, 'TRAINING', item.key, hash, { trainingId }, resource);
    }
  }

  private async applyIntentions(config: FunctionConfig, compiled: CompiledAgent): Promise<void> {
    const { tenantId, agentId } = config;
    const resources = await this.resources(agentId, 'INTENTION');
    const wanted = new Map(compiled.intentions.map((item) => [item.key, item]));

    for (const resource of resources) {
      if (wanted.has(resource.key)) continue;
      if (resource.intentionId) {
        await ignoreNotFound(() =>
          this.intentions.remove(tenantId, agentId, resource.intentionId!, MANAGED),
        );
      }
      await this.dropResource(resource.id);
    }

    const byKey = new Map(resources.map((resource) => [resource.key, resource]));
    for (const item of compiled.intentions) {
      const hash = intentionHash(item);
      const resource = byKey.get(item.key);
      if (resource?.intentionId) {
        if (resource.hash === hash) continue;
        await this.intentions.update(tenantId, agentId, resource.intentionId, item.input, MANAGED);
        await this.setResource(resource.id, hash, { intentionId: resource.intentionId });
        continue;
      }
      const intentionId =
        (await this.orphanIntention(agentId, item.input.name)) ??
        (await this.intentions.create(tenantId, agentId, item.input, MANAGED)).id;
      await this.saveResource(config, 'INTENTION', item.key, hash, { intentionId }, resource);
    }
  }

  /**
   * Regras de transferência para outros agentes (design D17), pela chave e pelo hash. Os destinos
   * (`gptmakerAgentId` por chave) já vêm conferidos por `transferTargets`.
   */
  private async applyTransfers(
    config: FunctionConfig,
    compiled: CompiledAgent,
    targets: ReadonlyMap<string, string>,
    sourceAgentId: string,
  ): Promise<void> {
    const { agentId } = config;

    const resources = await this.resources(agentId, 'TRANSFER_RULE');
    const wanted = new Set(compiled.transfers.map((transfer) => transfer.key));
    for (const resource of resources) {
      if (wanted.has(resource.key)) continue;
      if (resource.transferRuleId) {
        await ignoreProviderNotFound(() =>
          this.gptmaker.deleteTransferRule(sourceAgentId, resource.transferRuleId!),
        );
      }
      await this.dropResource(resource.id);
    }

    const byKey = new Map(resources.map((resource) => [resource.key, resource]));
    let remote: Awaited<ReturnType<GptMakerClient['listTransferRules']>> | null = null;
    for (const transfer of compiled.transfers) {
      const hash = transferHash(transfer);
      const resource = byKey.get(transfer.key);
      const body = {
        type: 'AGENT' as const,
        agentId: targets.get(transfer.key)!,
        instructions: transfer.instructions,
        returnOnFinish: transfer.returnOnFinish,
      };
      if (resource?.transferRuleId) {
        if (resource.hash === hash) continue;
        try {
          await this.gptmaker.updateTransferRule(sourceAgentId, resource.transferRuleId, body);
          await this.setResource(resource.id, hash, { transferRuleId: resource.transferRuleId });
          continue;
        } catch (error) {
          // Sumiu do GPTMaker: cria de novo abaixo.
          if (!(error instanceof GptMakerError && error.kind === 'NOT_FOUND')) throw error;
        }
      }
      // Retomada: regra criada numa tentativa que caiu antes de gravar o recurso.
      remote ??= await this.gptmaker.listTransferRules(sourceAgentId);
      const linked = new Set(resources.map((item) => item.transferRuleId).filter(Boolean));
      const orphan = remote.find(
        (rule) =>
          !linked.has(rule.id) &&
          rule.type === 'AGENT' &&
          rule.agentId === body.agentId &&
          rule.instructions === body.instructions,
      );
      const transferRuleId = orphan
        ? (await this.gptmaker.updateTransferRule(sourceAgentId, orphan.id, body), orphan.id)
        : await this.gptmaker.createTransferRule(sourceAgentId, body);
      await this.saveResource(
        config,
        'TRANSFER_RULE',
        transfer.key,
        hash,
        { transferRuleId },
        resource,
      );
    }
  }

  private resources(agentId: string, kind: ManagedResource['kind']): Promise<ManagedResource[]> {
    return this.db
      .select()
      .from(agentManagedResource)
      .where(and(eq(agentManagedResource.agentId, agentId), eq(agentManagedResource.kind, kind)));
  }

  private async saveResource(
    config: FunctionConfig,
    kind: ManagedResource['kind'],
    key: string,
    hash: string,
    link: { trainingId?: string; intentionId?: string; transferRuleId?: string },
    existing: ManagedResource | undefined,
  ): Promise<void> {
    if (existing) {
      await this.setResource(existing.id, hash, link);
      return;
    }
    await this.db
      .insert(agentManagedResource)
      .values({ tenantId: config.tenantId, agentId: config.agentId, kind, key, hash, ...link });
  }

  private async setResource(
    id: string,
    hash: string,
    link: { trainingId?: string; intentionId?: string; transferRuleId?: string },
  ): Promise<void> {
    await this.db
      .update(agentManagedResource)
      .set({ hash, ...link })
      .where(eq(agentManagedResource.id, id));
  }

  private async dropResource(id: string): Promise<void> {
    await this.db.delete(agentManagedResource).where(eq(agentManagedResource.id, id));
  }

  /** Treinamento gerado, vivo, com o mesmo texto e sem recurso que o aponte. */
  private async orphanTraining(agentId: string, text: string): Promise<string | null> {
    const linked = this.db
      .select({ id: agentManagedResource.trainingId })
      .from(agentManagedResource)
      .where(
        and(
          eq(agentManagedResource.agentId, agentId),
          sql`${agentManagedResource.trainingId} is not null`,
        ),
      );
    const [row] = await this.db
      .select({ id: training.id })
      .from(training)
      .where(
        and(
          eq(training.agentId, agentId),
          eq(training.managed, true),
          isNull(training.deletedAt),
          eq(training.content, text),
          notInArray(training.id, linked),
        ),
      );
    return row?.id ?? null;
  }

  private async orphanIntention(agentId: string, name: string): Promise<string | null> {
    const linked = this.db
      .select({ id: agentManagedResource.intentionId })
      .from(agentManagedResource)
      .where(
        and(
          eq(agentManagedResource.agentId, agentId),
          sql`${agentManagedResource.intentionId} is not null`,
        ),
      );
    const [row] = await this.db
      .select({ id: agentIntention.id })
      .from(agentIntention)
      .where(
        and(
          eq(agentIntention.agentId, agentId),
          eq(agentIntention.managed, true),
          isNull(agentIntention.deletedAt),
          sql`lower(${agentIntention.name}) = lower(${name})`,
          notInArray(agentIntention.id, linked),
        ),
      );
    return row?.id ?? null;
  }
}

/** Regra que já não existe no GPTMaker conta como removida. */
async function ignoreProviderNotFound(call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (error) {
    if (error instanceof GptMakerError && error.kind === 'NOT_FOUND') return;
    throw error;
  }
}

/** Já removido (aqui ou no GPTMaker) conta como removido. */
async function ignoreNotFound(call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (error) {
    if (error instanceof DomainError && error.code.endsWith('_NOT_FOUND')) return;
    throw error;
  }
}
