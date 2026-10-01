import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, gt, notInArray } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { agent } from '../../shared/database/schema/index';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { GptMakerClient, type GptMakerWebhooks, WEBHOOK_EVENTS } from '../gptmaker';
import { hashWebhookToken, webhookUrlsFor } from './agent.service';

/** Agentes por rodada (uma leitura no GPTMaker cada; o limite do token é global). */
const RECONCILE_BATCH = 100;
/** Último agente visto: cada rodada continua de onde a anterior parou e volta ao início no fim. */
const CURSOR_KEY = 'job:agent-webhooks-reconcile:cursor';

/**
 * Os webhooks de um agente no GPTMaker estão como esperado: os 8 eventos nesta API
 * (`API_PUBLIC_URL`), cada um com um token cujo hash é o guardado no agente.
 */
export function webhooksMatch(
  current: Partial<Record<string, string | null>>,
  base: string,
  tokenHash: string,
): boolean {
  return WEBHOOK_EVENTS.every((event) => {
    const url = current[event];
    const prefix = `${base}/gptmaker/webhooks/${event}?t=`;
    if (!url?.startsWith(prefix)) return false;
    const token = decodeURIComponent(url.slice(prefix.length));
    return hashWebhookToken(token) === tokenHash;
  });
}

/**
 * Mantém os webhooks dos agentes no GPTMaker apontando para esta API (spec agent-triggers).
 * Mudou o `API_PUBLIC_URL` (túnel novo em dev, domínio em produção) ou o token configurado não
 * é o do banco (falha no meio de uma troca anterior) ⇒ token novo, `PUT /agent/{id}/webhooks` e
 * o hash novo no agente. Como o token em claro nunca é guardado, corrigir sempre troca o token.
 * Roda no worker ao subir e a cada 15 min.
 */
@Injectable()
export class AgentWebhooksSync implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentWebhooksSync.name);
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
    if (this.env.APP_ROLE === 'worker') void this.runScheduled();
  }

  @Cron('*/15 * * * *', { name: 'agent-webhooks-reconcile' })
  async runScheduled(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive(
          'job:agent-webhooks-reconcile',
          14 * 60_000,
          () => this.reconcile(),
        );
        if (outcome.ran && (outcome.result.updated || outcome.result.failed)) {
          this.logger.log(outcome.result, 'webhooks dos agentes reconciliados');
        }
      } catch (error) {
        this.logger.error({ err: error }, 'reconciliação dos webhooks dos agentes falhou');
      }
    });
  }

  /** Agentes que existem no GPTMaker (não removidos nem `OUT_OF_SYNC`), em lotes por `id`. */
  async reconcile(): Promise<{ checked: number; updated: number; failed: number }> {
    const cursor = await this.redis.get(CURSOR_KEY);
    const live = notInArray(agent.status, ['DELETED', 'OUT_OF_SYNC']);
    const rows = await this.db
      .select({
        id: agent.id,
        gptmakerAgentId: agent.gptmakerAgentId,
        webhookTokenHash: agent.webhookTokenHash,
      })
      .from(agent)
      .where(cursor ? and(live, gt(agent.id, cursor)) : live)
      .orderBy(asc(agent.id))
      .limit(RECONCILE_BATCH);
    // Lote incompleto: chegou ao fim, a próxima rodada recomeça do início.
    const last = rows.length === RECONCILE_BATCH ? rows.at(-1)!.id : null;
    if (last) await this.redis.set(CURSOR_KEY, last);
    else await this.redis.del(CURSOR_KEY);
    const base = this.env.API_PUBLIC_URL;
    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const current = await this.gptmaker.getWebhooks(row.gptmakerAgentId);
        if (webhooksMatch(current, base, row.webhookTokenHash)) continue;
        await this.rotate(row);
        updated++;
      } catch (error) {
        failed++;
        this.logger.warn(
          { agentId: row.id, err: error },
          'webhooks do agente não reconciliados; próxima rodada tenta',
        );
      }
    }
    return { checked: rows.length, updated, failed };
  }

  /**
   * Token novo no GPTMaker e depois no banco. Entre os dois, eventos com o token novo são
   * recusados; se a gravação falhar, a próxima rodada vê o hash diferente e troca de novo.
   */
  private async rotate(row: { id: string; gptmakerAgentId: string }): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const urls: GptMakerWebhooks = webhookUrlsFor(this.env.API_PUBLIC_URL, token);
    await this.gptmaker.updateWebhooks(row.gptmakerAgentId, urls);
    await this.db
      .update(agent)
      .set({ webhookTokenHash: hashWebhookToken(token) })
      .where(eq(agent.id, row.id));
    this.logger.log({ agentId: row.id }, 'webhooks do agente apontados para esta API');
  }
}
