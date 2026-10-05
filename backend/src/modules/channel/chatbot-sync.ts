import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, agentBot, tenant } from '../../shared/database/schema/index';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { type AgentChange, type AgentChangeListener, AgentEvents } from '../agents';
import { type Tenant, TenantLifecycle, type TenantLifecycleListener } from '../tenancy';
import { ChatbotService, profileHashOf } from './chatbot.service';

/** Agentes por rodada da reconciliação (2 req/s por portal no Bitrix). */
const RECONCILE_BATCH = 200;

/**
 * Mantém os chatbots em dia com os agentes: reage na hora à mudança do agente e à
 * (re)instalação, e uma reconciliação periódica no worker cobre o que falhou (Bitrix fora do ar,
 * token expirado) sem bloquear a operação do agente.
 */
@Injectable()
export class ChatbotSync
  implements AgentChangeListener, TenantLifecycleListener, OnModuleInit, OnApplicationBootstrap
{
  readonly name = 'channel';
  private readonly logger = new Logger(ChatbotSync.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly chatbots: ChatbotService,
    private readonly agentEvents: AgentEvents,
    private readonly lifecycle: TenantLifecycle,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.lock = new DistributedLock(redis);
  }

  onModuleInit(): void {
    this.agentEvents.register(this);
    this.lifecycle.register(this);
  }

  /**
   * O worker reconcilia ao subir, sem esperar a rodada de 15 min: mudança do `API_PUBLIC_URL`
   * (túnel novo em dev, domínio em produção) chega aos webhooks dos bots no restart.
   */
  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE === 'worker') void this.runScheduled();
  }

  async onAgentChanged(change: AgentChange): Promise<void> {
    await this.chatbots.syncAgent(change.agentId);
  }

  async onUninstalled(tenantRow: Tenant): Promise<void> {
    await this.chatbots.forgetTenantBots(tenantRow.id);
  }

  /**
   * Reinstalação registra de novo os bots dos agentes (design D3). Falha no Bitrix não derruba o
   * instalador: a reconciliação tenta de novo.
   */
  async onInstalled(tenantRow: Tenant, event: { reinstall: boolean }): Promise<void> {
    if (!event.reinstall) return;
    await this.chatbots.forgetTenantBots(tenantRow.id);
    const agents = await this.db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.tenantId, tenantRow.id), ne(agent.status, 'DELETED')));
    for (const row of agents) await this.trySync(row.id);
  }

  @Cron('*/15 * * * *', { name: 'chatbot-reconcile' })
  async runScheduled(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive('job:chatbot-reconcile', 14 * 60_000, () =>
          this.reconcile(),
        );
        if (outcome.ran && outcome.result.synced) {
          this.logger.log(outcome.result, 'chatbots reconciliados');
        }
      } catch (error) {
        this.logger.error({ err: error }, 'reconciliação de chatbots falhou');
      }
    });
  }

  /**
   * Agentes cujo bot diverge: sem bot, perfil ou webhook mudado ou removido com bot ainda
   * registrado. Só de
   * tenants com o app instalado e credencial válida.
   */
  async reconcile(): Promise<{ pending: number; synced: number; failed: number }> {
    const rows = await this.db
      .select({
        id: agent.id,
        name: agent.name,
        avatarUrl: agent.avatarUrl,
        status: agent.status,
        profileHash: agentBot.profileHash,
        hasBot: agentBot.agentId,
      })
      .from(agent)
      .innerJoin(tenant, eq(tenant.id, agent.tenantId))
      .leftJoin(agentBot, eq(agentBot.agentId, agent.id))
      .where(inArray(tenant.status, ['ACTIVE', 'SUSPENDED']));
    const pending = rows.filter((row) =>
      row.status === 'DELETED'
        ? row.hasBot !== null
        : row.hasBot === null || row.profileHash !== profileHashOf(row, this.chatbots.webhookUrl()),
    );
    let synced = 0;
    let failed = 0;
    for (const row of pending.slice(0, RECONCILE_BATCH)) {
      if (await this.trySync(row.id)) synced++;
      else failed++;
    }
    return { pending: pending.length, synced, failed };
  }

  private async trySync(agentId: string): Promise<boolean> {
    try {
      await this.chatbots.syncAgent(agentId);
      return true;
    } catch (error) {
      this.logger.warn({ agentId, err: error }, 'chatbot não sincronizado; próxima rodada tenta');
      return false;
    }
  }
}
