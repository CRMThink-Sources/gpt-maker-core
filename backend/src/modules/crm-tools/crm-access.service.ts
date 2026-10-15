import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CRM_SYSTEM_INTENTION_NAME,
  type CrmAccessInput,
  crmAccessInputSchema,
  type CrmAccessView,
} from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { agentCrmAccess } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import {
  type Agent,
  type AgentChange,
  type AgentChangeListener,
  AgentEvents,
  AgentRepository,
  hashWebhookToken,
} from '../agents';
import { collectAllPages, GptMakerClient, GptMakerError } from '../gptmaker';
import { mcpConnection, systemIntention } from './system-intention';

type Access = typeof agentCrmAccess.$inferSelect;

const LOCK_TTL_MS = 90_000;

const busy = () =>
  new DomainError(
    'CRM_ACCESS_BUSY',
    'O acesso ao CRM deste agente está sendo alterado; tente de novo em instantes',
    HttpStatus.CONFLICT,
  );

/** Hash da credencial do agente (o mesmo SHA-256 dos tokens de webhook). */
export const hashCredential = hashWebhookToken;

/**
 * Acesso do agente ao CRM (spec agent-crm-tools, design S3/S4): credencial exclusiva, intenção de
 * sistema e conexão MCP criadas no agente do GPTMaker pela API. Falha no meio desfaz o que foi
 * criado e deixa o estado `ERROR`; desativar invalida a credencial antes de qualquer chamada
 * remota.
 */
@Injectable()
export class CrmAccessService implements OnModuleInit, AgentChangeListener {
  readonly name = 'crm-tools';
  private readonly logger = new Logger(CrmAccessService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly agents: AgentRepository,
    private readonly gptmaker: GptMakerClient,
    private readonly agentEvents: AgentEvents,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.lock = new DistributedLock(redis);
  }

  onModuleInit(): void {
    this.agentEvents.register(this);
  }

  /** Agente removido: o GPTMaker apaga intenção e conexão junto; aqui, só a credencial. */
  async onAgentChanged(change: AgentChange): Promise<void> {
    if (change.kind !== 'removed') return;
    await this.db
      .update(agentCrmAccess)
      .set({
        status: 'DISABLED',
        tokenHash: null,
        tokenEncrypted: null,
        gptmakerIntentionId: null,
        gptmakerMcpId: null,
      })
      .where(eq(agentCrmAccess.agentId, change.agentId));
  }

  async view(tenantId: string, agentId: string): Promise<CrmAccessView> {
    const owner = await this.agents.getById(tenantId, agentId);
    return this.toView(await this.rowOf(owner.id));
  }

  async update(tenantId: string, agentId: string, raw: CrmAccessInput): Promise<CrmAccessView> {
    const input = crmAccessInputSchema.parse(raw);
    const owner = await this.agents.getById(tenantId, agentId);
    if (input.enabled && owner.status === 'OUT_OF_SYNC') {
      throw new DomainError(
        'AGENT_OUT_OF_SYNC',
        'O agente não foi encontrado no GPTMaker; fale com o suporte',
        HttpStatus.CONFLICT,
      );
    }
    const outcome = await this.lock.runExclusive(`crm-access:${owner.id}`, LOCK_TTL_MS, () =>
      input.enabled ? this.enable(owner) : this.disable(owner),
    );
    if (!outcome.ran) throw busy();
    return this.toView(outcome.result);
  }

  private async enable(owner: Agent): Promise<Access> {
    const current = await this.rowOf(owner.id);
    if (current?.status === 'CONNECTED') return current;
    // Restos de uma tentativa ou desativação anterior que não conseguiu limpar o GPTMaker.
    if (current) await this.removeRemote(current);

    const token = randomBytes(32).toString('base64url');
    const values = {
      status: 'CONNECTING' as const,
      tokenHash: hashCredential(token),
      tokenEncrypted: token,
      gptmakerIntentionId: null,
      gptmakerMcpId: null,
      lastError: null,
    };
    let [row] = await this.db
      .insert(agentCrmAccess)
      .values({ agentId: owner.id, tenantId: owner.tenantId, ...values })
      .onConflictDoUpdate({ target: agentCrmAccess.agentId, set: values })
      .returning();

    try {
      const intentionId = await this.createIntention(owner, token);
      row = await this.patch(owner.id, { gptmakerIntentionId: intentionId });
      // O GPTMaker já chama o /mcp aqui (initialize + tools/list) com a credencial nova.
      const mcpId = await this.gptmaker.addMcp(
        owner.gptmakerAgentId,
        mcpConnection(this.env.API_PUBLIC_URL, token),
      );
      row = await this.patch(owner.id, { gptmakerMcpId: mcpId });
      await this.activateTools(mcpId);
      row = await this.patch(owner.id, { status: 'CONNECTED' });
      this.logger.log({ agentId: owner.id }, 'acesso ao CRM conectado');
      return row;
    } catch (error) {
      this.logger.warn({ agentId: owner.id, err: error }, 'falha ao conectar o acesso ao CRM');
      await this.removeRemote(row!);
      return this.patch(owner.id, {
        status: 'ERROR',
        tokenHash: null,
        tokenEncrypted: null,
        gptmakerIntentionId: null,
        gptmakerMcpId: null,
        lastError: summarize(error),
      });
    }
  }

  private async disable(owner: Agent): Promise<Access | undefined> {
    const current = await this.rowOf(owner.id);
    if (!current) return undefined;
    // A credencial morre antes de qualquer chamada remota (spec: recusa imediata).
    const revoked = await this.patch(owner.id, {
      status: 'DISABLED',
      tokenHash: null,
      tokenEncrypted: null,
      lastError: null,
    });
    const cleaned = await this.removeRemote(revoked);
    return cleaned
      ? this.patch(owner.id, { gptmakerIntentionId: null, gptmakerMcpId: null })
      : revoked;
  }

  /** Remove a intenção e a conexão no GPTMaker; ausente lá conta como removida. */
  private async removeRemote(row: Access): Promise<boolean> {
    let ok = true;
    const attempt = async (call: () => Promise<void>, what: string) => {
      try {
        await call();
      } catch (error) {
        if (error instanceof GptMakerError && error.kind === 'NOT_FOUND') return;
        ok = false;
        this.logger.warn({ agentId: row.agentId, err: error }, `não removeu ${what} no GPTMaker`);
      }
    };
    if (row.gptmakerMcpId) {
      const id = row.gptmakerMcpId;
      await attempt(() => this.gptmaker.deleteMcp(id), 'a conexão MCP');
    }
    if (row.gptmakerIntentionId) {
      const id = row.gptmakerIntentionId;
      await attempt(() => this.gptmaker.deleteIntention(id), 'a intenção de sistema');
    }
    return ok;
  }

  private async createIntention(owner: Agent, token: string): Promise<string> {
    const created = await this.gptmaker.createIntention(
      owner.gptmakerAgentId,
      systemIntention(this.env.API_PUBLIC_URL, token),
    );
    if (created) return created;
    // Formato antigo da API (sem id): localiza pelo nome, que é reservado.
    const remote = await collectAllPages(
      (page, pageSize) => this.gptmaker.listIntentions(owner.gptmakerAgentId, { page, pageSize }),
      100,
      20,
    );
    const found = remote.find(
      (item) =>
        (item.description ?? '').trim().toLowerCase() === CRM_SYSTEM_INTENTION_NAME.toLowerCase(),
    );
    if (!found) throw new Error('intenção de sistema criada, mas não localizada no GPTMaker');
    return found.id;
  }

  /** Ferramentas descobertas pelo GPTMaker; as inativas são ativadas. Nenhuma ⇒ falha. */
  private async activateTools(mcpId: string): Promise<void> {
    const tools = await this.gptmaker.listMcpTools(mcpId);
    if (!tools.length) {
      throw new Error('o GPTMaker não encontrou as ferramentas do servidor MCP');
    }
    for (const tool of tools.filter((item) => item.active === false)) {
      await this.gptmaker.activateMcpTool(mcpId, tool.id);
    }
  }

  private async rowOf(agentId: string): Promise<Access | undefined> {
    const [row] = await this.db
      .select()
      .from(agentCrmAccess)
      .where(eq(agentCrmAccess.agentId, agentId));
    return row;
  }

  private async patch(agentId: string, values: Partial<Access>): Promise<Access> {
    const [row] = await this.db
      .update(agentCrmAccess)
      .set(values)
      .where(eq(agentCrmAccess.agentId, agentId))
      .returning();
    return row!;
  }

  private toView(row: Access | undefined): CrmAccessView {
    return {
      available: this.env.CRM_TOOLS_ENABLED,
      status: row?.status ?? 'DISABLED',
      lastError: row?.lastError ?? null,
      lastCallAt: row?.lastCallAt?.toISOString() ?? null,
    };
  }
}

/** Motivo resumido para o painel e o suporte (sem dados do cliente). */
function summarize(error: unknown): string {
  const text =
    error instanceof GptMakerError
      ? `GPTMaker (${error.operation}): ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  return text.slice(0, 300);
}
