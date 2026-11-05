import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, agentCrmAccess } from '../../shared/database/schema/index';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { GptMakerClient } from '../gptmaker';
import { TOOLS_VERSION } from './mcp.controller';
import { mcpConnection, systemIntention } from './system-intention';

const STATE_KEY = 'crm-tools:published';

/**
 * Mantém a intenção de sistema e a conexão MCP dos agentes conectados alinhadas com esta API
 * (design S4): mudou o `API_PUBLIC_URL`, a intenção é atualizada e a conexão MCP recriada (o
 * GPTMaker não tem atualização de conexão); mudou só a versão das ferramentas, `sync-tools`.
 * Roda no worker ao subir.
 */
@Injectable()
export class CrmToolsSync implements OnApplicationBootstrap {
  private readonly logger = new Logger(CrmToolsSync.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly gptmaker: GptMakerClient,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.lock = new DistributedLock(redis);
  }

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE === 'worker' && this.env.CRM_TOOLS_ENABLED) void this.runOnce();
  }

  async runOnce(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        await this.lock.runExclusive('job:crm-tools-sync', 10 * 60_000, () => this.sync());
      } catch (error) {
        this.logger.error({ err: error }, 'alinhamento das ferramentas do CRM falhou');
      }
    });
  }

  async sync(): Promise<{ updated: number; failed: number }> {
    const current = JSON.stringify({ version: TOOLS_VERSION, url: this.env.API_PUBLIC_URL });
    const published = await this.redis.get(STATE_KEY);
    if (published === current) return { updated: 0, failed: 0 };
    const previousUrl = published ? (JSON.parse(published) as { url?: string }).url : undefined;
    const urlChanged = previousUrl !== this.env.API_PUBLIC_URL;

    const rows = await this.db
      .select({ access: agentCrmAccess, gptmakerAgentId: agent.gptmakerAgentId })
      .from(agentCrmAccess)
      .innerJoin(agent, eq(agent.id, agentCrmAccess.agentId))
      .where(eq(agentCrmAccess.status, 'CONNECTED'));

    let updated = 0;
    let failed = 0;
    for (const { access, gptmakerAgentId } of rows) {
      const token = access.tokenEncrypted;
      if (!token || !access.gptmakerMcpId || !access.gptmakerIntentionId) continue;
      try {
        if (urlChanged) {
          await this.gptmaker.updateIntention(
            access.gptmakerIntentionId,
            systemIntention(this.env.API_PUBLIC_URL, token),
          );
          await this.gptmaker.deleteMcp(access.gptmakerMcpId).catch(() => undefined);
          const mcpId = await this.gptmaker.addMcp(
            gptmakerAgentId,
            mcpConnection(this.env.API_PUBLIC_URL, token),
          );
          await this.db
            .update(agentCrmAccess)
            .set({ gptmakerMcpId: mcpId })
            .where(eq(agentCrmAccess.agentId, access.agentId));
          for (const tool of await this.gptmaker.listMcpTools(mcpId)) {
            if (tool.active === false) await this.gptmaker.activateMcpTool(mcpId, tool.id);
          }
        } else {
          await this.gptmaker.syncMcpTools(access.gptmakerMcpId);
        }
        updated++;
      } catch (error) {
        failed++;
        this.logger.warn(
          { agentId: access.agentId, err: error },
          'ferramentas do CRM do agente não alinhadas; o administrador pode reativar o acesso',
        );
      }
    }
    if (!failed) await this.redis.set(STATE_KEY, current);
    if (updated || failed)
      this.logger.log({ updated, failed, urlChanged }, 'ferramentas do CRM alinhadas');
    return { updated, failed };
  }
}
