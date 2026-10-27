import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { GptMakerError, kindFromStatus, parseRetryAfter } from './gptmaker.errors';
import { GptMakerResilience } from './gptmaker.resilience';
import {
  assistantListSchema,
  assistantSchema,
  agentSettingsSchema,
  conversationRequestSchema,
  conversationResponseSchema,
  createTrainingSchema,
  creditsSpentSchema,
  errorBodySchema,
  GptMakerAgent,
  GptMakerAgentSettings,
  GptMakerConversationRequest,
  GptMakerConversationResponse,
  GptMakerCreateTraining,
  GptMakerCreditsSpent,
  GptMakerIntention,
  GptMakerMcpAdd,
  GptMakerMcpTool,
  GptMakerWriteIntention,
  intentionListSchema,
  intentionWriteAckSchema,
  mcpAddAckSchema,
  mcpAddSchema,
  mcpToolListSchema,
  GptMakerNewAgent,
  GptMakerTraining,
  GptMakerTrainingType,
  GptMakerTransferRule,
  GptMakerWriteTransferRule,
  transferRuleListSchema,
  transferRuleSchema,
  writeTransferRuleSchema,
  GptMakerUpdateAgentSettings,
  GptMakerUpdateTextTraining,
  GptMakerWebhooks,
  GptMakerWorkspace,
  GptMakerWorkspaceCredits,
  newAssistantSchema,
  successSchema,
  trainingListSchema,
  updateAgentSettingsSchema,
  writeIntentionSchema,
  updateTextTrainingSchema,
  webhooksSchema,
  workspaceCreditsSchema,
  workspaceSchema,
} from './gptmaker.schemas';

export interface GptMakerClientOptions {
  /** Base com a versão, ex.: `https://api.gptmaker.ai/v2`. */
  baseUrl: string;
  token: string;
  workspaceId: string;
  timeoutMs: number;
  conversationTimeoutMs: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  query?: string;
}

interface Request<S extends z.ZodType> {
  operation: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  response: S;
  timeoutMs?: number;
}

const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'DELETE']);

/**
 * Cliente da API GPTMaker v2 (contrato em docs/gptmaker-api.md). Um token de partner e um
 * workspace para todos os tenants; isolamento entre tenants é responsabilidade de quem chama.
 */
export class GptMakerClient {
  private readonly logger = new Logger(GptMakerClient.name);

  constructor(
    private readonly options: GptMakerClientOptions,
    private readonly resilience: GptMakerResilience,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get workspaceId(): string {
    return this.options.workspaceId;
  }

  get circuitOpen(): boolean {
    return this.resilience.circuitOpen;
  }

  // ---- Workspace

  listWorkspaces(): Promise<GptMakerWorkspace[]> {
    return this.request({
      operation: 'workspace.list',
      method: 'GET',
      path: '/workspaces',
      response: workspaceSchema.array(),
    });
  }

  getWorkspaceCredits(): Promise<GptMakerWorkspaceCredits> {
    return this.request({
      operation: 'workspace.credits',
      method: 'GET',
      path: `/workspace/${this.ws()}/credits`,
      response: workspaceCreditsSchema,
    });
  }

  listWorkspaceAgents(page: PageQuery = {}): Promise<GptMakerAgent[]> {
    return this.request({
      operation: 'workspace.agents',
      method: 'GET',
      path: `/workspace/${this.ws()}/agents`,
      query: { page: page.page, pageSize: page.pageSize, query: page.query },
      response: assistantListSchema,
    });
  }

  // ---- Agente

  async createAgent(input: GptMakerNewAgent): Promise<GptMakerAgent> {
    return this.request({
      operation: 'agent.create',
      method: 'POST',
      path: `/workspace/${this.ws()}/agents`,
      body: newAssistantSchema.parse(input),
      response: assistantSchema,
    });
  }

  getAgent(agentId: string): Promise<GptMakerAgent> {
    return this.request({
      operation: 'agent.get',
      method: 'GET',
      path: `/agent/${enc(agentId)}`,
      response: assistantSchema,
    });
  }

  async updateAgent(agentId: string, input: GptMakerNewAgent): Promise<GptMakerAgent> {
    return this.request({
      operation: 'agent.update',
      method: 'PUT',
      path: `/agent/${enc(agentId)}`,
      body: newAssistantSchema.parse(input),
      response: assistantSchema,
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.success('agent.delete', 'DELETE', `/agent/${enc(agentId)}`);
  }

  async activateAgent(agentId: string): Promise<void> {
    await this.success('agent.activate', 'PUT', `/agent/${enc(agentId)}/active`);
  }

  async inactivateAgent(agentId: string): Promise<void> {
    await this.success('agent.inactivate', 'PUT', `/agent/${enc(agentId)}/inactive`);
  }

  // ---- Settings

  getAgentSettings(agentId: string): Promise<GptMakerAgentSettings> {
    return this.request({
      operation: 'agent.settings.get',
      method: 'GET',
      path: `/agent/${enc(agentId)}/settings`,
      response: agentSettingsSchema,
    });
  }

  async updateAgentSettings(agentId: string, settings: GptMakerUpdateAgentSettings): Promise<void> {
    await this.success(
      'agent.settings.update',
      'PUT',
      `/agent/${enc(agentId)}/settings`,
      updateAgentSettingsSchema.parse(settings),
    );
  }

  // ---- Treinamentos

  listTrainings(
    agentId: string,
    type: GptMakerTrainingType,
    page: PageQuery = {},
  ): Promise<GptMakerTraining[]> {
    return this.request({
      operation: 'training.list',
      method: 'GET',
      path: `/agent/${enc(agentId)}/trainings`,
      query: { type, page: page.page, pageSize: page.pageSize, query: page.query },
      response: trainingListSchema,
    });
  }

  /**
   * A documentação promete `{ success }`, mas a API real responde outra coisa (corpo sem
   * `success`). Aceita qualquer 2xx e só falha com `success: false` explícito; se o corpo
   * trouxer o id do treinamento (`id`, `data.id` ou `training.id`), devolve-o, senão é
   * preciso listar para obtê-lo.
   */
  async createTraining(
    agentId: string,
    input: GptMakerCreateTraining,
  ): Promise<{ id: string | null }> {
    const body = await this.request({
      operation: 'training.create',
      method: 'POST',
      path: `/agent/${enc(agentId)}/trainings`,
      body: createTrainingSchema.parse(input),
      response: z.unknown(),
    });
    const record = asRecord(body);
    if (record?.success === false) {
      throw new GptMakerError('UNKNOWN', 'training.create', 'provedor respondeu success=false', {
        status: 200,
        body,
      });
    }
    const id = [record?.id, asRecord(record?.data)?.id, asRecord(record?.training)?.id].find(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    return { id: id ?? null };
  }

  /** Só treinamentos `TEXT` podem ser editados; os demais são removidos e recriados. */
  async updateTextTraining(trainingId: string, input: GptMakerUpdateTextTraining): Promise<void> {
    await this.success('training.update', 'PUT', `/training/${enc(trainingId)}`, {
      type: 'TEXT',
      ...updateTextTrainingSchema.parse(input),
    });
  }

  async deleteTraining(trainingId: string): Promise<void> {
    await this.success('training.delete', 'DELETE', `/training/${enc(trainingId)}`);
  }

  // ---- Intenções

  listIntentions(agentId: string, page: PageQuery = {}): Promise<GptMakerIntention[]> {
    return this.request({
      operation: 'intention.list',
      method: 'GET',
      path: `/agent/${enc(agentId)}/intentions`,
      query: { page: page.page, pageSize: page.pageSize, query: page.query },
      response: intentionListSchema,
    });
  }

  /** Responde só `{ success }`: o id vem da listagem. */
  /** Id da intenção criada, quando a resposta traz (senão vem da listagem). */
  async createIntention(agentId: string, input: GptMakerWriteIntention): Promise<string | null> {
    const ack = await this.intentionWrite(
      'intention.create',
      'POST',
      `/agent/${enc(agentId)}/intentions`,
      writeIntentionSchema.parse(input),
    );
    return ack.id ?? null;
  }

  async updateIntention(intentionId: string, input: GptMakerWriteIntention): Promise<void> {
    await this.intentionWrite('intention.update', 'PUT', `/intention/${enc(intentionId)}`, {
      id: intentionId,
      ...writeIntentionSchema.parse(input),
    });
  }

  /** `{ success: false }` com HTTP 200 continua sendo falha; sem `success`, vale o HTTP. */
  private async intentionWrite(
    operation: string,
    method: Request<z.ZodType>['method'],
    path: string,
    body: unknown,
  ): Promise<z.infer<typeof intentionWriteAckSchema>> {
    const ack = await this.request({
      operation,
      method,
      path,
      body,
      response: intentionWriteAckSchema,
    });
    if (ack.success === false) {
      throw new GptMakerError('UNKNOWN', operation, 'provedor respondeu success=false', {
        status: 200,
        body: ack,
      });
    }
    return ack;
  }

  async deleteIntention(intentionId: string): Promise<void> {
    await this.success('intention.delete', 'DELETE', `/intention/${enc(intentionId)}`);
  }

  // ---- Regras de transferência entre agentes (design D17)

  listTransferRules(agentId: string): Promise<GptMakerTransferRule[]> {
    return this.request({
      operation: 'transferRule.list',
      method: 'GET',
      path: `/agent/${enc(agentId)}/transfer-rules`,
      response: transferRuleListSchema,
    });
  }

  /** Id da regra criada (a resposta traz a regra inteira). */
  async createTransferRule(agentId: string, input: GptMakerWriteTransferRule): Promise<string> {
    const rule = await this.request({
      operation: 'transferRule.create',
      method: 'POST',
      path: `/agent/${enc(agentId)}/transfer-rules`,
      body: transferRuleBody(input),
      response: transferRuleSchema,
    });
    return rule.id;
  }

  /** Responde 204 sem corpo. */
  async updateTransferRule(
    agentId: string,
    ruleId: string,
    input: GptMakerWriteTransferRule,
  ): Promise<void> {
    await this.request({
      operation: 'transferRule.update',
      method: 'PUT',
      path: `/agent/${enc(agentId)}/transfer-rules/${enc(ruleId)}`,
      body: transferRuleBody(input),
      response: z.unknown(),
    });
  }

  async deleteTransferRule(agentId: string, ruleId: string): Promise<void> {
    await this.request({
      operation: 'transferRule.delete',
      method: 'DELETE',
      path: `/agent/${enc(agentId)}/transfer-rules/${enc(ruleId)}`,
      response: z.unknown(),
    });
  }

  // ---- MCP (docs/gptmaker-mcp.md)

  /** Conecta um servidor MCP ao agente; devolve o id da conexão (necessário para remover). */
  async addMcp(agentId: string, input: GptMakerMcpAdd): Promise<string> {
    const operation = 'mcp.add';
    const ack = await this.request({
      operation,
      method: 'POST',
      path: `/agent/${enc(agentId)}/mcp/add`,
      body: mcpAddSchema.parse(input),
      response: mcpAddAckSchema,
    });
    if (ack.success === false || !ack.id) {
      throw new GptMakerError('UNKNOWN', operation, 'conexão MCP não criada', {
        status: 200,
        body: ack,
      });
    }
    return ack.id;
  }

  listMcpTools(mcpId: string): Promise<GptMakerMcpTool[]> {
    return this.request({
      operation: 'mcp.tools',
      method: 'GET',
      path: `/mcp/${enc(mcpId)}/tools`,
      response: mcpToolListSchema,
    });
  }

  async activateMcpTool(mcpId: string, toolId: string): Promise<void> {
    await this.success('mcp.tool.active', 'GET', `/mcp/${enc(mcpId)}/tool/${enc(toolId)}/active`);
  }

  /** Relê as ferramentas do servidor (nome, descrição e esquema só mudam assim). */
  async syncMcpTools(mcpId: string): Promise<void> {
    await this.success('mcp.sync-tools', 'GET', `/mcp/${enc(mcpId)}/sync-tools`);
  }

  async deleteMcp(mcpId: string): Promise<void> {
    await this.success('mcp.delete', 'DELETE', `/mcp/${enc(mcpId)}`);
  }

  // ---- Webhooks

  getWebhooks(agentId: string): Promise<Partial<Record<string, string | null>>> {
    return this.request({
      operation: 'agent.webhooks.get',
      method: 'GET',
      path: `/agent/${enc(agentId)}/webhooks`,
      response: webhooksSchema,
    });
  }

  async updateWebhooks(agentId: string, webhooks: GptMakerWebhooks): Promise<void> {
    await this.success('agent.webhooks.update', 'PUT', `/agent/${enc(agentId)}/webhooks`, webhooks);
  }

  // ---- Conversa e atendimento humano

  /**
   * Não idempotente: não é retentado em timeout/5xx para não duplicar a resposta ao cliente final.
   * O GPTMaker responde 200 com `success: false` quando falha ao processar (ex.: não conseguiu
   * baixar a mídia: `java.net.ConnectException`); isso vira erro, não resposta.
   */
  async sendMessage(
    agentId: string,
    input: GptMakerConversationRequest,
  ): Promise<GptMakerConversationResponse> {
    const result = await this.request({
      operation: 'agent.conversation',
      method: 'POST',
      path: `/agent/${enc(agentId)}/conversation`,
      body: conversationRequestSchema.parse(input),
      response: conversationResponseSchema,
      timeoutMs: this.options.conversationTimeoutMs,
    });
    if ((result as { success?: unknown }).success === false) {
      const error = (result as { error?: unknown }).error;
      throw new GptMakerError(
        'UNKNOWN',
        'agent.conversation',
        `provedor respondeu success=false${typeof error === 'string' ? `: ${error}` : ''}`,
        { status: 200, body: result },
      );
    }
    return result;
  }

  async startHuman(chatId: string): Promise<void> {
    await this.success('chat.start-human', 'PUT', `/chat/${enc(chatId)}/start-human`);
  }

  async stopHuman(chatId: string): Promise<void> {
    await this.success('chat.stop-human', 'PUT', `/chat/${enc(chatId)}/stop-human`);
  }

  // ---- Consumo

  getCreditsSpent(
    agentId: string,
    period: { year?: number; month?: number; day?: number } = {},
  ): Promise<GptMakerCreditsSpent> {
    return this.request({
      operation: 'agent.credits-spent',
      method: 'GET',
      path: `/agent/${enc(agentId)}/credits-spent`,
      query: period,
      response: creditsSpentSchema,
    });
  }

  // ---- Transporte

  private ws(): string {
    return enc(this.options.workspaceId);
  }

  /** Rotas que respondem `{ success }`; `success: false` com HTTP 200 também é falha. */
  private async success(
    operation: string,
    method: Request<z.ZodType>['method'],
    path: string,
    body?: unknown,
  ): Promise<void> {
    const result = await this.request({ operation, method, path, body, response: successSchema });
    if (!result.success) {
      throw new GptMakerError('UNKNOWN', operation, 'provedor respondeu success=false', {
        status: 200,
        body: result,
      });
    }
  }

  private request<S extends z.ZodType>(req: Request<S>): Promise<z.infer<S>> {
    const url = new URL(`${this.options.baseUrl.replace(/\/+$/, '')}${req.path}`);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return this.resilience.execute(
      {
        operation: req.operation,
        idempotent: IDEMPOTENT_METHODS.has(req.method),
        timeoutMs: req.timeoutMs ?? this.options.timeoutMs,
      },
      async (signal) => {
        const started = Date.now();
        const response = await this.fetchFn(url, {
          method: req.method,
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            Accept: 'application/json',
            ...(req.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal,
        });
        const payload = await readBody(response);
        this.logger.debug(
          `${req.operation} ${req.method} ${url.pathname} -> ${response.status} em ${Date.now() - started}ms`,
        );

        if (!response.ok) {
          const message =
            errorBodySchema.safeParse(payload).data?.error ?? `HTTP ${response.status}`;
          throw new GptMakerError(kindFromStatus(response.status), req.operation, message, {
            status: response.status,
            body: payload,
            retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          });
        }

        const parsed = req.response.safeParse(payload);
        if (!parsed.success) {
          // O corpo recebido vai junto: os contratos do GPTMaker divergem da documentação.
          throw new GptMakerError('INVALID_RESPONSE', req.operation, 'resposta fora do contrato', {
            status: response.status,
            body: { issues: parsed.error.issues, received: truncated(payload) },
          });
        }
        return parsed.data as z.infer<S>;
      },
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Corpo para o log de erro, cortado. */
function truncated(payload: unknown): unknown {
  const json = JSON.stringify(payload ?? null) ?? 'null';
  return json.length > 2000 ? `${json.slice(0, 2000)}…` : payload;
}

/** Regra para outro agente: `userId` vai nulo, como a API documenta. */
function transferRuleBody(input: GptMakerWriteTransferRule) {
  return { ...writeTransferRuleSchema.parse(input), userId: null };
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
