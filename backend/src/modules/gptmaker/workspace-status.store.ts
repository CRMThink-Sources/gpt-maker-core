import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { Gauge } from 'prom-client';
import { metricsRegistry } from '../../shared/metrics/metrics';
import { REDIS } from '../../shared/redis/redis.module';
import type { GptMakerWorkspaceStatus } from './gptmaker.schemas';

export interface WorkspaceStatus {
  /** `up`: workspace acessível e com assinatura ACTIVE no GPTMaker. */
  state: 'up' | 'down';
  checkedAt: string;
  reason?: string;
  subscriptionStatus?: GptMakerWorkspaceStatus;
  credits?: number;
}

const KEY = 'gptmaker:workspace:status';

const statusGauge = new Gauge({
  name: 'gptmaker_workspace_up',
  help: '1 quando o workspace GPTMaker está acessível e ACTIVE',
  registers: [metricsRegistry],
});

const creditsGauge = new Gauge({
  name: 'gptmaker_workspace_credits',
  help: 'Créditos disponíveis no workspace GPTMaker (última consulta)',
  registers: [metricsRegistry],
});

/**
 * Último estado conhecido do workspace, no Redis: o worker atualiza (job a cada 15 min) e a API
 * lê no `/health`, sem cada processo consultar o GPTMaker.
 */
@Injectable()
export class WorkspaceStatusStore {
  private readonly logger = new Logger(WorkspaceStatusStore.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async save(status: WorkspaceStatus): Promise<void> {
    statusGauge.set(status.state === 'up' ? 1 : 0);
    if (status.credits !== undefined) creditsGauge.set(status.credits);
    if (status.state === 'down') {
      // `alert: true` marca o log para a regra de alerta operacional (seção 16).
      this.logger.error(
        { alert: true, workspace: status },
        `workspace GPTMaker indisponível: ${status.reason}`,
      );
    }
    await this.redis.set(KEY, JSON.stringify(status));
  }

  async load(): Promise<WorkspaceStatus | null> {
    const raw = await this.redis.get(KEY);
    return raw ? (JSON.parse(raw) as WorkspaceStatus) : null;
  }
}
