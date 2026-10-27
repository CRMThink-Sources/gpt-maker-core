import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AgentFunctionConfigView,
  type AgentFunctionView,
  type AgentView,
  type CompiledAgent,
  compileAgent,
  type CreateAgentInput,
  createAgentSchema,
  type FunctionAnswers,
  type FunctionMode,
  type FunctionPreview,
  type FunctionPublishInput,
  functionPublishSchema,
  type FunctionTemplateContent,
  planPublication,
  type PreviewNewAgentInput,
  previewNewAgentSchema,
  type PublicationPlan,
  publishedStateOf,
  type SaveFunctionDraftInput,
  saveFunctionDraftSchema,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agentFunctionConfig,
  agentIntention,
  type FunctionPublicationTarget,
} from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { QUEUES } from '../../shared/messaging/topology';
import { AgentRepository, AgentService, type AgentOwner } from '../agents';
import { TenantService } from '../tenancy';
import { TrainingService } from '../training';
import { FunctionCatalog, type PublishedFunction } from './function-catalog.service';
import { mediaTrainings } from './function-training-policy';
import {
  currentState,
  emptyState,
  type FunctionConfig,
  type ManagedResource,
} from './function-state';

/** Mensagem da fila de publicação. */
export interface FunctionPublicationMessage {
  agentId: string;
  tenantId: string;
}

export type PublishResult = { status: 'NOTHING' } | { status: 'PENDING' };

/**
 * Configuração do agente pela função (spec agent-function-configuration): o cliente responde o
 * formulário; aqui a validação, a compilação, a prévia e o pedido de publicação. A publicação em si
 * roda no worker (`FunctionPublisher`).
 */
@Injectable()
export class AgentFunctionService {
  private readonly logger = new Logger(AgentFunctionService.name);

  constructor(
    private readonly catalog: FunctionCatalog,
    private readonly agents: AgentService,
    private readonly agentRows: AgentRepository,
    private readonly trainings: TrainingService,
    private readonly tenants: TenantService,
    private readonly amqp: AmqpConnection,
    @Inject(DB) private readonly db: Database,
  ) {}

  listFunctions(tenantId: string): Promise<AgentFunctionView[]> {
    return this.catalog.listPublished(tenantId);
  }

  async functionForm(
    tenantId: string,
    code: string,
  ): Promise<AgentFunctionView & { form: FunctionTemplateContent }> {
    const fn = await this.catalog.latestPublished(code, tenantId);
    return {
      code: fn.code,
      name: fn.name,
      description: fn.description,
      version: fn.version,
      form: fn.content,
    };
  }

  /** Prévia antes de criar o agente: plano contra o estado vazio (design D6). */
  async previewNew(tenantId: string, raw: PreviewNewAgentInput): Promise<FunctionPreview> {
    const input = previewNewAgentSchema.parse(raw);
    const fn = await this.catalog.latestPublished(input.functionCode, tenantId);
    const { answers, issues } = validateFunctionAnswers(
      fn.content,
      input.answers as FunctionAnswers,
    );
    const compiled = compileAgent({
      content: fn.content,
      answers,
      agentName: input.agentName,
      mode: 'SIMPLE',
    });
    return {
      compiled,
      plan: planPublication(compiled, null),
      issues,
      version: { from: null, to: fn.version },
      mediaToRemove: [],
      removedIntentions: {},
    };
  }

  /**
   * Cria o agente já compilado (spec agent-management, "Criação com sucesso"): comportamento,
   * tipo, tom, dados da empresa e settings vão na criação; treinamentos e intenções seguem pela
   * publicação no worker.
   */
  async create(owner: AgentOwner, raw: CreateAgentInput): Promise<AgentView> {
    const input = createAgentSchema.parse(raw);
    const fn = await this.catalog.latestPublished(input.functionCode, owner.tenantId);
    const answers = this.validAnswers(fn.content, input.answers as FunctionAnswers);
    const compiled = compileOrFail({
      content: fn.content,
      answers,
      agentName: input.name,
      mode: 'SIMPLE',
    });
    await this.assertTrainingRoom(owner.tenantId, compiled.trainings.length);

    const view = await this.agents.create(owner, {
      name: input.name,
      avatarUrl: input.avatarUrl,
      modelId: input.modelId,
      behavior: compiled.behavior,
      type: compiled.agentType,
      communicationType: compiled.communicationType,
      jobName: compiled.profile.jobName || undefined,
      jobSite: compiled.profile.jobSite || undefined,
      jobDescription: compiled.profile.jobDescription || undefined,
      settings: compiled.settings,
    });

    try {
      // O perfil já foi aplicado na criação; a publicação cuida só da base e das intenções.
      const applied = { ...publishedStateOf(compiled), trainings: [], intentions: [] };
      await this.db.insert(agentFunctionConfig).values({
        agentId: view.id,
        tenantId: owner.tenantId,
        templateId: fn.templateId,
        answers,
        publishedState: applied,
        publicationStatus: 'PENDING',
        publicationTarget: target(fn, answers, 'SIMPLE', null, null),
      });
    } catch (error) {
      // Sem configuração o agente pareceria de teste (descartável): desfaz a criação.
      this.logger.error({ agentId: view.id, err: error }, 'configuração da função não gravada');
      await this.agents.remove(owner, view.id).catch(() => undefined);
      throw error;
    }
    await this.enqueue(owner.tenantId, view.id);
    return view;
  }

  async view(tenantId: string, agentId: string): Promise<AgentFunctionConfigView> {
    const config = await this.config(tenantId, agentId);
    const [latest, current, tenant] = await Promise.all([
      this.catalog.latestOfTemplate(config.templateId),
      config.versionId ? this.catalog.versionById(config.versionId) : Promise.resolve(null),
      this.tenants.findById(tenantId),
    ]);
    return {
      function: { code: latest.code, name: latest.name, description: latest.description },
      version: current?.version ?? null,
      latestVersion: latest.version,
      updateAvailable:
        config.mode !== 'TAKEN_OVER' && current !== null && current.version < latest.version,
      mode: config.mode,
      answers: config.answers,
      draftAnswers: config.draftAnswers,
      additionalInstructions: config.additionalInstructions,
      takenOverBehavior: config.takenOverBehavior,
      publication: { status: config.publicationStatus, error: config.publicationError },
      needsRepublishReason: config.needsRepublishReason,
      canTakeOver: tenant?.isPartner === true || config.mode === 'TAKEN_OVER',
      form: latest.content,
    };
  }

  /** Rascunho: limites valem, obrigatórios não; o agente publicado não muda. */
  async saveDraft(
    tenantId: string,
    agentId: string,
    raw: SaveFunctionDraftInput,
  ): Promise<AgentFunctionConfigView> {
    const input = saveFunctionDraftSchema.parse(raw);
    const config = await this.config(tenantId, agentId);
    const latest = await this.catalog.latestOfTemplate(config.templateId);
    const { answers, issues } = validateFunctionAnswers(
      latest.content,
      input.answers as FunctionAnswers,
      {
        partial: true,
      },
    );
    if (issues.length) throw answersInvalid(issues);
    await this.db
      .update(agentFunctionConfig)
      .set({ draftAnswers: answers })
      .where(eq(agentFunctionConfig.agentId, agentId));
    return this.view(tenantId, agentId);
  }

  async preview(
    tenantId: string,
    agentId: string,
    raw: FunctionPublishInput,
  ): Promise<FunctionPreview> {
    const config = await this.config(tenantId, agentId);
    const prepared = await this.prepare(
      tenantId,
      agentId,
      config,
      functionPublishSchema.parse(raw),
    );
    return {
      compiled: prepared.compiled,
      plan: prepared.plan,
      issues: prepared.issues,
      version: { from: prepared.fromVersion, to: prepared.latest.version },
      mediaToRemove: prepared.mediaToRemove,
      removedIntentions: await this.intentionNames(prepared.resources, prepared.plan),
    };
  }

  /** Pede a publicação (spec "Prévia e publicação"); o worker aplica no GPTMaker. */
  async publish(
    tenantId: string,
    agentId: string,
    raw: FunctionPublishInput,
  ): Promise<PublishResult> {
    const config = await this.config(tenantId, agentId);
    if (config.publicationStatus === 'PENDING') throw publicationPending();
    const prepared = await this.prepare(
      tenantId,
      agentId,
      config,
      functionPublishSchema.parse(raw),
    );
    if (prepared.issues.length) throw answersInvalid(prepared.issues);
    if (prepared.compiled.errors.length) throw compileFailed(prepared.compiled.errors);

    const sameTarget =
      config.versionId === prepared.latest.versionId &&
      config.mode === prepared.target.mode &&
      prepared.plan.empty;
    if (sameTarget && config.publicationStatus === 'IDLE') {
      // Nada a aplicar; só limpa o rascunho, que ficou igual ao publicado.
      await this.db
        .update(agentFunctionConfig)
        .set({ answers: prepared.target.answers, draftAnswers: null })
        .where(eq(agentFunctionConfig.agentId, agentId));
      return { status: 'NOTHING' };
    }

    const { create, remove } = prepared.plan.trainings;
    await this.assertTrainingRoom(tenantId, create.length - remove.length);
    await this.db
      .update(agentFunctionConfig)
      .set({
        publicationStatus: 'PENDING',
        publicationTarget: prepared.target,
        publicationError: null,
      })
      .where(eq(agentFunctionConfig.agentId, agentId));
    await this.enqueue(tenantId, agentId);
    return { status: 'PENDING' };
  }

  /** Repete uma publicação que falhou, com o mesmo alvo. */
  async retry(tenantId: string, agentId: string): Promise<AgentFunctionConfigView> {
    const config = await this.config(tenantId, agentId);
    if (config.publicationStatus !== 'FAILED' || !config.publicationTarget) {
      throw new DomainError(
        'FUNCTION_NOTHING_TO_RETRY',
        'Não há publicação com falha para repetir',
        HttpStatus.CONFLICT,
      );
    }
    await this.db
      .update(agentFunctionConfig)
      .set({ publicationStatus: 'PENDING', publicationError: null })
      .where(eq(agentFunctionConfig.agentId, agentId));
    await this.enqueue(tenantId, agentId);
    return this.view(tenantId, agentId);
  }

  // Internos ---------------------------------------------------------------------------------

  /** Nome local das intenções gerenciadas que o plano remove (a prévia mostra o nome, não a chave). */
  private async intentionNames(
    resources: ManagedResource[],
    plan: PublicationPlan,
  ): Promise<Record<string, string>> {
    const removed = new Set(plan.intentions.remove);
    const byId = new Map(
      resources
        .filter((resource) => resource.kind === 'INTENTION' && removed.has(resource.key))
        .flatMap((resource) =>
          resource.intentionId ? [[resource.intentionId, resource.key]] : [],
        ),
    );
    if (byId.size === 0) return {};
    const rows = await this.db
      .select({ id: agentIntention.id, name: agentIntention.name })
      .from(agentIntention)
      .where(inArray(agentIntention.id, [...byId.keys()]));
    return Object.fromEntries(rows.map((row) => [byId.get(row.id)!, row.name]));
  }

  private async prepare(
    tenantId: string,
    agentId: string,
    config: FunctionConfig,
    input: ReturnType<typeof functionPublishSchema.parse>,
  ) {
    const [owner, latest, tenant] = await Promise.all([
      this.agentRows.getById(tenantId, agentId),
      this.catalog.latestOfTemplate(config.templateId),
      this.tenants.findById(tenantId),
    ]);
    const mode: FunctionMode = input.mode ?? config.mode;
    if (mode === 'TAKEN_OVER' && config.mode !== 'TAKEN_OVER' && tenant?.isPartner !== true) {
      throw new DomainError(
        'FUNCTION_TAKE_OVER_NOT_ALLOWED',
        'Só parceiros podem assumir o controle do comportamento',
        HttpStatus.FORBIDDEN,
      );
    }
    const raw = (input.answers ?? config.draftAnswers ?? config.answers) as FunctionAnswers;
    const { answers, issues } = validateFunctionAnswers(latest.content, raw);
    const additional =
      mode === 'ADVANCED'
        ? input.additionalInstructions !== undefined
          ? input.additionalInstructions
          : config.additionalInstructions
        : null;
    const { state, resources } = await currentState(this.db, config);
    // Assumir controle sem texto novo parte do comportamento publicado.
    const takenOver =
      mode === 'TAKEN_OVER'
        ? (input.takenOverBehavior ??
          config.takenOverBehavior ??
          state?.behavior ??
          owner.behavior ??
          '')
        : null;
    const compiled = compileAgent({
      content: latest.content,
      answers,
      agentName: owner.name,
      mode,
      additionalInstructions: additional,
      takenOverBehavior: takenOver,
    });
    const current = config.versionId ? await this.catalog.versionById(config.versionId) : null;
    // Site e vídeo são do modo avançado: saem ao sair dele, para o simples ou o controle assumido.
    const mediaToRemove =
      mode !== 'ADVANCED'
        ? ((await mediaTrainings(this.db, agentId)) as FunctionPreview['mediaToRemove'])
        : [];
    return {
      mediaToRemove,
      resources,
      latest,
      compiled,
      issues,
      plan: planPublication(compiled, state ?? emptyState(compiled)),
      target: target(latest, answers, mode, additional, takenOver),
      fromVersion: current?.version ?? null,
    };
  }

  private async config(tenantId: string, agentId: string): Promise<FunctionConfig> {
    // 404 de agente de outro tenant vem do repositório.
    await this.agentRows.getById(tenantId, agentId);
    const [config] = await this.db
      .select()
      .from(agentFunctionConfig)
      .where(eq(agentFunctionConfig.agentId, agentId));
    if (!config) {
      throw new DomainError(
        'FUNCTION_NOT_CONFIGURED',
        'Este agente não tem função configurada',
        HttpStatus.NOT_FOUND,
      );
    }
    return config;
  }

  private validAnswers(content: FunctionTemplateContent, raw: FunctionAnswers): FunctionAnswers {
    const { answers, issues } = validateFunctionAnswers(content, raw);
    if (issues.length) throw answersInvalid(issues);
    return answers;
  }

  /** Limite de treinamentos do plano para `extra` treinamentos a mais (spec "Limite do plano"). */
  private async assertTrainingRoom(tenantId: string, extra: number): Promise<void> {
    if (extra <= 0) return;
    const { trainings } = await this.trainings.usage(tenantId);
    if (trainings.limit !== null && trainings.used + extra > trainings.limit) {
      throw new DomainError(
        'PLAN_TRAINING_LIMIT',
        `Seu plano permite até ${trainings.limit} treinamentos; esta publicação passaria para ${trainings.used + extra}. Remova itens da base ou mude de plano`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        { kind: 'trainings', used: trainings.used, limit: trainings.limit, requested: extra },
      );
    }
  }

  private async enqueue(tenantId: string, agentId: string): Promise<void> {
    const message: FunctionPublicationMessage = { agentId, tenantId };
    try {
      await this.amqp.publish('', QUEUES.functionPublication, message, { persistent: true });
    } catch (error) {
      // O pedido está gravado como pendente: a varredura do worker retoma.
      this.logger.warn({ agentId, err: error }, 'publicação não enfileirada; a varredura retoma');
    }
  }
}

function target(
  fn: PublishedFunction,
  answers: FunctionAnswers,
  mode: FunctionMode,
  additionalInstructions: string | null,
  takenOverBehavior: string | null,
): FunctionPublicationTarget {
  return { versionId: fn.versionId, answers, mode, additionalInstructions, takenOverBehavior };
}

function compileOrFail(input: Parameters<typeof compileAgent>[0]): CompiledAgent {
  const compiled = compileAgent(input);
  if (compiled.errors.length) throw compileFailed(compiled.errors);
  return compiled;
}

const answersInvalid = (issues: Array<{ field: string; message: string }>) =>
  new DomainError(
    'FUNCTION_ANSWERS_INVALID',
    'Revise as respostas do formulário',
    HttpStatus.UNPROCESSABLE_ENTITY,
    { issues },
  );

const compileFailed = (errors: string[]) =>
  new DomainError(
    'FUNCTION_COMPILE_FAILED',
    'Não foi possível montar o agente com essas respostas',
    HttpStatus.UNPROCESSABLE_ENTITY,
    { errors },
  );

const publicationPending = () =>
  new DomainError(
    'FUNCTION_PUBLICATION_PENDING',
    'Há uma publicação em andamento; aguarde ela terminar',
    HttpStatus.CONFLICT,
  );
