import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AgentView,
  createAgentSchema,
  type CreateAgentInput,
  updateAgentSchema,
  type UpdateAgentInput,
} from '@gptmaker/contracts';
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
  type GptMakerNewAgent,
  type GptMakerWebhooks,
  TenantAgentLimitService,
  toGptMakerName,
  WEBHOOK_EVENTS,
} from '../gptmaker';
import { type AiModel, ModelCatalogService } from '../models';
import { OUTBOX_OPERATIONS, PaymentsOutbox } from '../payments';
import type { TenantStatus } from '../tenancy';
import { type Agent, AgentRepository, type Executor } from './agent.repository';

/** Dono da operação: tenant da sessão do iframe. */
export interface AgentOwner {
  tenantId: string;
  tenantCode: string;
}

// Cobre a criação no GPTMaker e as duas configurações seguintes, com retentativas.
const CREATE_LOCK_TTL_MS = 120_000;
// Duas chamadas ao GPTMaker (dados e settings) e o eventual desfazer.
const AGENT_LOCK_TTL_MS = 90_000;

/** Dados do agente espelhados em `PUT /agent/{id}` no GPTMaker. */
const PROFILE_FIELDS = [
  'name',
  'avatarUrl',
  'behavior',
  'type',
  'communicationType',
  'jobName',
  'jobSite',
  'jobDescription',
] as const;
type Profile = Pick<Agent, (typeof PROFILE_FIELDS)[number]>;

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
    private readonly outbox: PaymentsOutbox,
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

  /**
   * Edita dados, modelo e settings. O GPTMaker é atualizado antes do registro local; se a
   * segunda chamada falhar, a primeira é desfeita, e o registro local fica como estava.
   */
  async update(owner: AgentOwner, id: string, raw: UpdateAgentInput): Promise<AgentView> {
    const input = updateAgentSchema.parse(raw);
    return this.withAgentLock(owner.tenantId, id, async () => {
      const current = await this.agents.getById(owner.tenantId, id);
      if (current.status === 'OUT_OF_SYNC') throw outOfSync();

      const modelChanged = input.modelId !== undefined && input.modelId !== current.modelId;
      // Troca de modelo passa pela regra do plano; manter o atual não (plano pode ter mudado).
      const model = modelChanged
        ? await this.resolveModel(owner.tenantId, input.modelId)
        : (await this.modelsById()).get(current.modelId)!;

      const profile: Profile = {
        name: input.name ?? current.name,
        avatarUrl: keep(input.avatarUrl, current.avatarUrl),
        behavior: keep(input.behavior, current.behavior),
        type: input.type ?? current.type,
        communicationType: input.communicationType ?? current.communicationType,
        jobName: keep(input.jobName, current.jobName),
        jobSite: keep(input.jobSite, current.jobSite),
        jobDescription: keep(input.jobDescription, current.jobDescription),
      };
      const settings = { ...current.settings, ...input.settings };
      const profileChanged = PROFILE_FIELDS.some((field) => profile[field] !== current[field]);
      const settingsChanged =
        modelChanged ||
        Object.entries(input.settings ?? {}).some(
          ([key, value]) => current.settings[key] !== value,
        );

      if (profileChanged) {
        await this.callGptMaker(() =>
          this.gptmaker.updateAgent(current.gptmakerAgentId, remoteProfile(owner, profile)),
        );
      }
      if (settingsChanged) {
        try {
          // Semântica do PUT (merge ou substituição) não documentada: envia as settings locais junto.
          await this.callGptMaker(() =>
            this.gptmaker.updateAgentSettings(current.gptmakerAgentId, {
              ...settings,
              prefferModel: model.code,
            }),
          );
        } catch (error) {
          if (profileChanged) await this.revertProfile(owner, current);
          throw error;
        }
      }

      const patch = { ...profile, modelId: model.id, settings };
      // O item de assinatura só leva o título: outras edições não mudam o espelho.
      const updated =
        profile.name !== current.name
          ? await this.mirrored(owner.tenantId, (tx) =>
              this.agents.update(owner.tenantId, id, patch, tx),
            )
          : (await this.agents.update(owner.tenantId, id, patch))!;
      return toView(updated, model);
    });
  }

  /**
   * Inativa no GPTMaker e localmente (motivo `MANUAL`): o chatbot deixa de encaminhar mensagens
   * e o agente não consome créditos. Agente já inativo, por qualquer motivo, fica como está.
   */
  async inactivate(owner: AgentOwner, id: string): Promise<AgentView> {
    return this.withAgentLock(owner.tenantId, id, async () => {
      const current = await this.agents.getById(owner.tenantId, id);
      if (current.status === 'OUT_OF_SYNC') throw outOfSync();
      if (current.status === 'INACTIVE') return this.view(current);

      await this.callGptMaker(() => this.gptmaker.inactivateAgent(current.gptmakerAgentId));
      const updated = await this.mirrored(owner.tenantId, (tx) =>
        this.agents.update(
          owner.tenantId,
          id,
          { status: 'INACTIVE', inactiveReason: 'MANUAL' },
          tx,
        ),
      );
      return this.view(updated);
    });
  }

  /**
   * Reativa um agente inativado pelo próprio tenant. Inativações do sistema (assinatura expirada,
   * suspensão, desinstalação) só são desfeitas pelo evento que as causou; tenant suspenso não
   * reativa. O limite de agentes conta os inativos, então reativar nunca o ultrapassa.
   */
  async activate(
    owner: AgentOwner & { tenantStatus: TenantStatus },
    id: string,
  ): Promise<AgentView> {
    return this.withAgentLock(owner.tenantId, id, async () => {
      const current = await this.agents.getById(owner.tenantId, id);
      if (current.status === 'OUT_OF_SYNC') throw outOfSync();
      if (current.status === 'ACTIVE') return this.view(current);
      if (owner.tenantStatus === 'SUSPENDED') {
        throw new DomainError(
          'TENANT_SUSPENDED',
          'A conta está suspensa; regularize a assinatura para reativar agentes',
          HttpStatus.CONFLICT,
        );
      }
      if (current.inactiveReason !== 'MANUAL') {
        throw new DomainError(
          'AGENT_INACTIVE_BY_SYSTEM',
          'O agente foi inativado pelo sistema e volta sozinho quando a causa for resolvida',
          HttpStatus.CONFLICT,
          { reason: current.inactiveReason },
        );
      }

      await this.callGptMaker(() => this.gptmaker.activateAgent(current.gptmakerAgentId));
      const updated = await this.mirrored(owner.tenantId, (tx) =>
        this.agents.update(owner.tenantId, id, { status: 'ACTIVE', inactiveReason: null }, tx),
      );
      return this.view(updated);
    });
  }

  /**
   * Remove no GPTMaker e marca o registro local `DELETED` (soft delete, preserva o histórico de
   * consumo e libera a vaga no limite de agentes). Agente que já não existe no GPTMaker, inclusive
   * `OUT_OF_SYNC` ou removido lá numa tentativa anterior que falhou no banco, é só marcado aqui.
   */
  async remove(owner: AgentOwner, id: string): Promise<void> {
    await this.withAgentLock(owner.tenantId, id, async () => {
      const current = await this.agents.getById(owner.tenantId, id);
      await this.callGptMaker(async () => {
        try {
          await this.gptmaker.deleteAgent(current.gptmakerAgentId);
        } catch (error) {
          if (!(error instanceof GptMakerError && error.kind === 'NOT_FOUND')) throw error;
        }
      });
      await this.mirrored(owner.tenantId, (tx) => this.agents.markDeleted(owner.tenantId, id, tx));
    });
  }

  /**
   * Grava a mudança local e agenda, na mesma transação, o espelho do agente como item de
   * assinatura (spec payments-integration): falha na plataforma não bloqueia o agente.
   */
  private mirrored(
    tenantId: string,
    write: (tx: Executor) => Promise<Agent | undefined>,
  ): Promise<Agent> {
    return this.db.transaction(async (tx) => {
      const row = (await write(tx))!;
      await this.outbox.enqueue(tenantId, OUTBOX_OPERATIONS.agentItemSync, row.id, tx);
      return row;
    });
  }

  private async view(row: Agent): Promise<AgentView> {
    return toView(row, (await this.modelsById()).get(row.modelId)!);
  }

  /** Serializa alterações do mesmo agente; a segunda recebe 409 em vez de esperar. */
  private async withAgentLock<T>(tenantId: string, id: string, fn: () => Promise<T>): Promise<T> {
    const outcome = await this.lock.runExclusive(`agent:${tenantId}:${id}`, AGENT_LOCK_TTL_MS, fn);
    if (!outcome.ran) {
      throw new DomainError(
        'AGENT_BUSY',
        'O agente está sendo alterado; aguarde e tente de novo',
        HttpStatus.CONFLICT,
      );
    }
    return outcome.result;
  }

  private async revertProfile(owner: AgentOwner, previous: Agent): Promise<void> {
    try {
      await this.gptmaker.updateAgent(previous.gptmakerAgentId, remoteProfile(owner, previous));
    } catch (error) {
      this.logger.error(
        { agentId: previous.id, err: error },
        'dados do agente ficaram divergentes no GPTMaker após falha na edição',
      );
    }
  }

  private async createRemoteAndLocal(
    owner: AgentOwner,
    input: ReturnType<typeof createAgentSchema.parse>,
    model: AiModel,
  ): Promise<Agent> {
    const remote = await this.callGptMaker(() =>
      this.gptmaker.createAgent(
        remoteProfile(owner, {
          name: input.name,
          avatarUrl: input.avatarUrl ?? null,
          behavior: input.behavior ?? null,
          type: input.type,
          communicationType: input.communicationType,
          jobName: input.jobName ?? null,
          jobSite: input.jobSite ?? null,
          jobDescription: input.jobDescription ?? null,
        }),
      ),
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
      return await this.mirrored(owner.tenantId, (tx) =>
        this.agents.insert(
          owner.tenantId,
          {
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
          },
          tx,
        ),
      );
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
      if (error.kind === 'VALIDATION') {
        throw new DomainError(
          'GPTMAKER_REJECTED',
          'O GPTMaker recusou os dados do agente; nada foi alterado. Revise os campos',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { traceId, reason: error.message },
        );
      }
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

/** `undefined` mantém o valor atual; `null` limpa. */
function keep<T>(value: T | null | undefined, current: T | null): T | null {
  return value === undefined ? current : value;
}

/**
 * Corpo de `POST|PUT /agent` no GPTMaker: nome com o prefixo do tenant. Texto limpo vai como
 * string vazia, pois omitir o campo não o apaga num PUT de semântica não documentada.
 */
function remoteProfile(owner: AgentOwner, profile: Profile): GptMakerNewAgent {
  return {
    name: toGptMakerName(owner.tenantCode, profile.name),
    avatar: profile.avatarUrl ?? undefined,
    behavior: profile.behavior ?? '',
    type: profile.type,
    communicationType: profile.communicationType,
    jobName: profile.jobName ?? '',
    jobSite: profile.jobSite ?? undefined,
    jobDescription: profile.jobDescription ?? '',
  };
}

const outOfSync = () =>
  new DomainError(
    'AGENT_OUT_OF_SYNC',
    'O agente não foi encontrado no GPTMaker; fale com o suporte',
    HttpStatus.CONFLICT,
  );

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
    settings: row.settings,
    status: row.status as AgentView['status'],
    inactiveReason: row.inactiveReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
