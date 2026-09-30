import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { runWithContext, newTraceId } from '../../shared/context/request-context';
import { HealthRegistry } from '../../shared/health/health-registry';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { GptMakerClient } from './gptmaker.client';
import { GptMakerError } from './gptmaker.errors';
import { WorkspaceStatus, WorkspaceStatusStore } from './workspace-status.store';

/** Estado mais antigo que isso é tratado como desconhecido no `/health`. */
const STALE_AFTER_MS = 40 * 60 * 1000;

/**
 * Validação do workspace no boot (tarefa 4.4) e job `workspace-health` a cada 15 min (4.7).
 * Falhas não derrubam o processo: o componente fica `down` no `/health` e gera alerta.
 */
@Injectable()
export class WorkspaceHealthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkspaceHealthService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly client: GptMakerClient,
    private readonly store: WorkspaceStatusStore,
    private readonly registry: HealthRegistry,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  onApplicationBootstrap(): void {
    this.registry.register('gptmaker', async () => {
      const status = await this.store.load();
      if (!status) return { status: 'down', reason: 'workspace ainda não verificado' };
      const stale = Date.now() - Date.parse(status.checkedAt) > STALE_AFTER_MS;
      return {
        status: status.state === 'up' && !stale ? 'up' : 'down',
        ...status,
        ...(stale ? { reason: 'última verificação desatualizada' } : {}),
      };
    });
    // Em segundo plano: o boot não espera o GPTMaker responder. Se o Redis cair (ou a app fechar)
    // antes do fim, o erro vira log em vez de rejeição não tratada.
    void runWithContext({ traceId: newTraceId() }, () => this.validateWorkspace()).catch(
      (error: unknown) =>
        this.logger.warn({ err: error }, 'falha ao registrar a validação do workspace no boot'),
    );
  }

  /** Confirma que o workspace configurado existe e é acessível com o token do partner. */
  async validateWorkspace(): Promise<WorkspaceStatus> {
    try {
      const workspaces = await this.client.listWorkspaces();
      if (!workspaces.some((workspace) => workspace.id === this.client.workspaceId)) {
        return this.save({
          state: 'down',
          reason: `workspace ${this.client.workspaceId} não encontrado para o token configurado`,
        });
      }
      return await this.checkCredits();
    } catch (error) {
      return this.save({ state: 'down', reason: describe(error) });
    }
  }

  @Cron('*/15 * * * *', { name: 'workspace-health' })
  async runScheduled(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      const outcome = await this.lock.runExclusive('job:workspace-health', 5 * 60_000, () =>
        this.validateWorkspace(),
      );
      if (!outcome.ran) this.logger.debug('workspace-health já em execução em outro processo');
    });
  }

  private async checkCredits(): Promise<WorkspaceStatus> {
    try {
      const { credits, status } = await this.client.getWorkspaceCredits();
      return this.save({
        state: status === 'ACTIVE' ? 'up' : 'down',
        subscriptionStatus: status,
        credits,
        ...(status === 'ACTIVE' ? {} : { reason: `assinatura do workspace em ${status}` }),
      });
    } catch (error) {
      return this.save({ state: 'down', reason: describe(error) });
    }
  }

  private async save(status: Omit<WorkspaceStatus, 'checkedAt'>): Promise<WorkspaceStatus> {
    const full = { ...status, checkedAt: new Date().toISOString() };
    await this.store.save(full);
    return full;
  }
}

function describe(error: unknown): string {
  if (error instanceof GptMakerError) return `${error.kind}: ${error.message}`;
  return (error as Error)?.message ?? String(error);
}
