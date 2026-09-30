import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type AgentView, createAgentSchema, type CreateAgentInput } from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { currentContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { subscriptionState } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import {
  GptMakerClient,
  GptMakerError,
  type GptMakerWebhooks,
  TenantAgentLimitService,
  toGptMakerName,
  WEBHOOK_EVENTS,
} from '../gptmaker';
import { type AiModel, ModelCatalogService } from '../models';
import { type Agent, AgentRepository } from './agent.repository';

/** Dono da operação: tenant da sessão do iframe. */
export interface AgentOwner {
  tenantId: string;
  tenantCode: string;
}

// Cobre a criação no GPTMaker e as duas configurações seguintes, com retentativas.
const CREATE_LOCK_TTL_MS = 120_000;

/**
 * Gestão de agentes do tenant (spec agent-management) sobre o workspace GPTMaker compartilhado.
 * O GPTMaker é alterado primeiro; o registro local só é gravado depois que ele confirma.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly agents: AgentRepository,
    private readonly limits: TenantAgentLimitService,
    private readonly models: ModelCatalogService,
    private readonly gptmaker: GptMakerClient,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.lock = new DistributedLock(redis);
  }

  async list(tenantId: string): Promise<AgentView[]> {
    const [rows, models] = await Promise.all([this.agents.list(tenantId), this.modelsById()]);
    return rows.map((row) => toView(row, models.get(row.modelId)!));
  }

  async get(tenantId: string, id: string): Promise<AgentView> {
    const [row, models] = await Promise.all([this.agents.getById(tenantId, id), this.modelsById()]);
    return toView(row, models.get(row.modelId)!);
  }

  /**
   * Cria o agente no GPTMaker (nome `[<tenantCode>] <nome>`), aplica o modelo em `prefferModel`,
   * aponta os webhooks para esta API e só então grava o registro local `ACTIVE`. Criações do mesmo
   * tenant são serializadas para o limite de agentes valer sob concorrência.
   */
  async create(owner: AgentOwner, raw: CreateAgentInput): Promise<AgentView> {
    const input = createAgentSchema.parse(raw);
    const outcome = await this.lock.runExclusive(
      `agent-create:${owner.tenantId}`,
      CREATE_LOCK_TTL_MS,
      async () => {
        await this.limits.assertCanCreate(owner.tenantId);
        const model = await this.resolveModel(owner.tenantId, input.modelId);
        return toView(await this.createRemoteAndLocal(owner, input, model), model);
      },
    );
    if (!outcome.ran) {
      throw new DomainError(
        'AGENT_CREATION_IN_PROGRESS',
        'Outro agente está sendo criado; aguarde e tente de novo',
        HttpStatus.CONFLICT,
      );
    }
    return outcome.result;
  }

  private async createRemoteAndLocal(
    owner: AgentOwner,
    input: ReturnType<typeof createAgentSchema.parse>,
    model: AiModel,
  ): Promise<Agent> {
    const remote = await this.callGptMaker(() =>
      this.gptmaker.createAgent({
        name: toGptMakerName(owner.tenantCode, input.name),
        avatar: input.avatarUrl,
        behavior: input.behavior,
        type: input.type,
        communicationType: input.communicationType,
        jobName: input.jobName,
        jobSite: input.jobSite,
        jobDescription: input.jobDescription,
      }),
    );

    // O token em claro só vai para o GPTMaker, na URL dos webhooks; aqui fica o hash.
    const webhookToken = randomBytes(32).toString('base64url');
    try {
      await this.callGptMaker(() =>
        this.gptmaker.updateAgentSettings(remote.id, { prefferModel: model.code }),
      );
      await this.callGptMaker(() =>
        this.gptmaker.updateWebhooks(remote.id, this.webhookUrls(webhookToken)),
      );
      return await this.agents.insert(owner.tenantId, {
        gptmakerAgentId: remote.id,
        name: input.name,
        avatarUrl: input.avatarUrl ?? null,
        behavior: input.behavior ?? null,
        type: input.type,
        communicationType: input.communicationType,
        jobName: input.jobName ?? null,
        jobSite: input.jobSite ?? null,
        jobDescription: input.jobDescription ?? null,
        modelId: model.id,
        status: 'ACTIVE',
        webhookTokenHash: hashWebhookToken(webhookToken),
      });
    } catch (error) {
      await this.discardRemote(remote.id);
      throw error;
    }
  }

  /**
   * Sem `modelId`, o padrão do catálogo (sempre ativo). Com `modelId`, o modelo precisa estar
   * ativo e ser o padrão ou estar liberado no plano do tenant; tenant sem plano só tem o padrão.
   */
  private async resolveModel(tenantId: string, modelId: string | undefined): Promise<AiModel> {
    const models = await this.models.list();
    const model = modelId
      ? models.find((row) => row.id === modelId)
      : models.find((row) => row.isDefault);
    if (!modelId && !model) {
      throw new DomainError(
        'NO_DEFAULT_MODEL',
        'Nenhum modelo padrão configurado',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!model?.active) throw modelNotAllowed();
    if (model.isDefault) return model;

    const planId = await this.planOf(tenantId);
    if (!planId || !(await this.models.isAllowedForPlan(planId, model.id))) {
      throw modelNotAllowed();
    }
    return model;
  }

  /** Plano da projeção local da assinatura (alimentada pelos eventos da plataforma). */
  private async planOf(tenantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ planId: subscriptionState.planId })
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, tenantId));
    return row?.planId ?? null;
  }

  private webhookUrls(token: string): GptMakerWebhooks {
    const base = this.env.API_PUBLIC_URL;
    return Object.fromEntries(
      WEBHOOK_EVENTS.map((event) => [
        event,
        `${base}/gptmaker/webhooks/${event}?t=${encodeURIComponent(token)}`,
      ]),
    );
  }

  /** Desfaz a criação remota; se falhar, o `workspace-sync` acha o órfão pelo prefixo do nome. */
  private async discardRemote(gptmakerAgentId: string): Promise<void> {
    try {
      await this.gptmaker.deleteAgent(gptmakerAgentId);
    } catch (error) {
      this.logger.error(
        { gptmakerAgentId, err: error },
        'agente criado no GPTMaker ficou órfão após falha na criação',
      );
    }
  }

  /** Falha do GPTMaker vira erro recuperável com o `traceId` para o suporte localizar o log. */
  private async callGptMaker<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof GptMakerError)) throw error;
      const traceId = currentContext()?.traceId;
      this.logger.error(
        { traceId, operation: error.operation, kind: error.kind, err: error },
        'falha no GPTMaker',
      );
      throw new DomainError(
        'GPTMAKER_UNAVAILABLE',
        'Não foi possível concluir no GPTMaker agora; nada foi alterado. Tente de novo em instantes',
        HttpStatus.SERVICE_UNAVAILABLE,
        { traceId },
      );
    }
  }

  /** Inclui removidos: a chave estrangeira garante que o modelo do agente existe. */
  private async modelsById(): Promise<Map<string, AiModel>> {
    const models = await this.models.list({ includeDeleted: true });
    return new Map(models.map((model) => [model.id, model]));
  }
}

export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const modelNotAllowed = () =>
  new DomainError(
    'MODEL_NOT_ALLOWED',
    'Modelo inativo ou não permitido pelo plano',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

function toView(row: Agent, model: AiModel): AgentView {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatarUrl,
    behavior: row.behavior,
    type: row.type,
    communicationType: row.communicationType,
    jobName: row.jobName,
    jobSite: row.jobSite,
    jobDescription: row.jobDescription,
    model: {
      id: model.id,
      code: model.code,
      displayName: model.displayName,
      creditsPerResponse: model.creditsPerResponse,
    },
    status: row.status as AgentView['status'],
    inactiveReason: row.inactiveReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
