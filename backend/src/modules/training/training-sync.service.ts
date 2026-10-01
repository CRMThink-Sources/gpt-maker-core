import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, training } from '../../shared/database/schema/index';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { ObjectStorage } from '../../shared/storage/object-storage';
import { GptMakerClient, type GptMakerTraining } from '../gptmaker';
import {
  listRemoteTrainings,
  matcherFor,
  sameUrl,
  TRAINING_TYPES,
  type Training,
} from './training-remote';

/** Registro recém-criado pode ainda não aparecer na listagem do GPTMaker. */
const RECENT_MS = 10 * 60_000;
/** Sem id e sem correspondente depois disso, a criação é dada como perdida. */
const LOST_AFTER_MS = 60 * 60_000;
/**
 * Ausência na listagem só remove na segunda sync seguida: uma listagem incompleta do GPTMaker
 * (paginação não documentada) não pode apagar o treinamento de um cliente.
 */
const MISSING_MARK_TTL_S = 3 * 60 * 60;
/** O mesmo lock da criação, edição e remoção (TrainingService). */
const AGENT_LOCK_TTL_MS = 120_000;

type SyncAgent = { id: string; tenantId: string; gptmakerAgentId: string };

export interface TrainingSyncSummary {
  agents: number;
  agentsSkipped: number;
  agentsFailed: number;
  linked: number;
  imported: number;
  updated: number;
  removed: number;
  lost: number;
}

const emptySummary = (): TrainingSyncSummary => ({
  agents: 0,
  agentsSkipped: 0,
  agentsFailed: 0,
  linked: 0,
  imported: 0,
  updated: 0,
  removed: 0,
  lost: 0,
});

/**
 * Sincronização dos treinamentos com o GPTMaker, a fonte da verdade (spec agent-training). Por
 * agente: completa ids que a criação não identificou, importa treinamentos que só existem lá,
 * corrige o conteúdo divergente e remove os que sumiram de lá. Status de processamento não é
 * listado pela API: continua vindo do callback.
 */
@Injectable()
export class TrainingSyncService {
  private readonly logger = new Logger(TrainingSyncService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly gptmaker: GptMakerClient,
    private readonly storage: ObjectStorage,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  @Cron('30 * * * *', { name: 'training-sync' })
  async runScheduled(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive('job:training-sync', 50 * 60_000, () =>
          this.syncAll(),
        );
        if (outcome.ran) this.logger.log({ summary: outcome.result }, 'training-sync concluído');
      } catch (error) {
        this.logger.error({ alert: true, err: error }, 'training-sync falhou');
      }
    });
  }

  /** Agentes ativos e inativos; removidos e fora de sincronia não têm treinamentos no GPTMaker. */
  async syncAll(now = new Date()): Promise<TrainingSyncSummary> {
    const agents = await this.db
      .select({ id: agent.id, tenantId: agent.tenantId, gptmakerAgentId: agent.gptmakerAgentId })
      .from(agent)
      .where(inArray(agent.status, ['ACTIVE', 'INACTIVE']));
    const summary = emptySummary();
    for (const row of agents) {
      summary.agents++;
      try {
        // Criação ou edição em andamento no agente: fica para a próxima rodada.
        const outcome = await this.lock.runExclusive(`training:${row.id}`, AGENT_LOCK_TTL_MS, () =>
          this.syncAgent(row, now),
        );
        if (!outcome.ran) {
          summary.agentsSkipped++;
          continue;
        }
        for (const key of ['linked', 'imported', 'updated', 'removed', 'lost'] as const) {
          summary[key] += outcome.result[key];
        }
      } catch (error) {
        summary.agentsFailed++;
        this.logger.warn({ agentId: row.id, err: error }, 'sync de treinamentos do agente falhou');
      }
    }
    return summary;
  }

  /** Lista os quatro tipos antes de mudar qualquer coisa: falha na listagem não altera nada. */
  async syncAgent(
    owner: SyncAgent,
    now = new Date(),
  ): Promise<Omit<TrainingSyncSummary, 'agents' | 'agentsSkipped' | 'agentsFailed'>> {
    const remote: GptMakerTraining[] = [];
    for (const type of TRAINING_TYPES) {
      remote.push(...(await listRemoteTrainings(this.gptmaker, owner.gptmakerAgentId, type)));
    }
    const local = await this.db
      .select()
      .from(training)
      .where(and(eq(training.agentId, owner.id), isNull(training.deletedAt)));

    const result = { linked: 0, imported: 0, updated: 0, removed: 0, lost: 0 };
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const claimed = new Set(local.flatMap((row) => row.gptmakerTrainingId ?? []));

    for (const row of local) {
      if (!row.gptmakerTrainingId) continue;
      const item = remoteById.get(row.gptmakerTrainingId);
      if (item) {
        await this.redis.del(missingKey(row.id));
        if (await this.applyDrift(row, item)) result.updated++;
      } else if (await this.confirmGone(row, now)) {
        await this.markRemoved(row);
        result.removed++;
      }
    }

    // Sem id: casa pelo conteúdo com os que nenhum registro local reivindica.
    const unlinked = local.filter((row) => !row.gptmakerTrainingId);
    for (const row of unlinked) {
      const match = remote.find(
        (item) => !claimed.has(item.id) && item.type === row.type && matcherFor(row)(item),
      );
      if (match) {
        await this.link(row, match.id);
        claimed.add(match.id);
        result.linked++;
      }
    }
    // Um sem id e um novo do mesmo tipo, sem casar pelo conteúdo (texto normalizado lá): par único.
    for (const type of TRAINING_TYPES) {
      const rows = unlinked.filter((row) => row.type === type && !row.gptmakerTrainingId);
      const items = remote.filter((item) => item.type === type && !claimed.has(item.id));
      if (rows.length === 1 && items.length === 1) {
        await this.link(rows[0]!, items[0]!.id);
        claimed.add(items[0]!.id);
        result.linked++;
      }
    }

    for (const row of unlinked) {
      if (row.gptmakerTrainingId || row.status !== 'PROCESSING') continue;
      if (now.getTime() - row.createdAt.getTime() < LOST_AFTER_MS) continue;
      await this.db
        .update(training)
        .set({
          status: 'FAILED',
          error: 'O treinamento não apareceu no GPTMaker. Remova e envie de novo',
        })
        .where(and(eq(training.id, row.id), isNull(training.gptmakerTrainingId)));
      result.lost++;
    }

    for (const item of remote) {
      if (claimed.has(item.id)) continue;
      if (await this.importRemote(owner, item)) result.imported++;
    }
    return result;
  }

  /** Primeira ausência só marca (Redis, com validade); a segunda confirma. Recentes esperam. */
  private async confirmGone(row: Training, now: Date): Promise<boolean> {
    if (now.getTime() - row.createdAt.getTime() < RECENT_MS) return false;
    const marked = await this.redis.set(missingKey(row.id), '1', 'EX', MISSING_MARK_TTL_S, 'NX');
    return marked !== 'OK';
  }

  private async markRemoved(row: Training): Promise<void> {
    await this.db.update(training).set({ deletedAt: new Date() }).where(eq(training.id, row.id));
    await this.redis.del(missingKey(row.id));
    this.logger.warn(
      { trainingId: row.id, gptmakerTrainingId: row.gptmakerTrainingId },
      'treinamento ausente no GPTMaker; removido localmente',
    );
    if (!row.documentKey) return;
    try {
      await this.storage.delete(row.documentKey);
    } catch (error) {
      this.logger.error({ key: row.documentKey, err: error }, 'documento ficou órfão no storage');
    }
  }

  /** Conteúdo do GPTMaker vale sobre o local (ex.: editado direto lá). */
  private async applyDrift(row: Training, item: GptMakerTraining): Promise<boolean> {
    const patch: Partial<typeof training.$inferInsert> = {};
    if (row.type === 'TEXT' && item.text && item.text.trim() !== row.content) {
      patch.content = item.text.trim();
    }
    if (row.type === 'WEBSITE') {
      if (item.website && (!row.url || !sameUrl(item.website, row.url))) patch.url = item.website;
      const subPages = subPagesOf(item);
      if (subPages !== null && subPages !== row.trainingSubPages) patch.trainingSubPages = subPages;
      if (item.trainingInterval && item.trainingInterval !== row.trainingInterval) {
        patch.trainingInterval = item.trainingInterval;
      }
    }
    if (row.type === 'VIDEO' && item.video && (!row.url || !sameUrl(item.video, row.url))) {
      patch.url = item.video;
    }
    if (Object.keys(patch).length === 0) return false;
    await this.db.update(training).set(patch).where(eq(training.id, row.id));
    return true;
  }

  private async link(row: Training, gptmakerTrainingId: string): Promise<void> {
    await this.db
      .update(training)
      .set({ gptmakerTrainingId })
      .where(and(eq(training.id, row.id), isNull(training.gptmakerTrainingId)));
    row.gptmakerTrainingId = gptmakerTrainingId;
  }

  /**
   * Treinamento que só existe no GPTMaker (ex.: criado no painel de lá) passa a aparecer para o
   * tenant. Já existe lá, então entra como `DONE`; documento fica sem objeto no storage.
   * `false` se o id já pertence a um registro removido aqui.
   */
  private async importRemote(owner: SyncAgent, item: GptMakerTraining): Promise<boolean> {
    const inserted = await this.db
      .insert(training)
      .values({
        tenantId: owner.tenantId,
        agentId: owner.id,
        gptmakerTrainingId: item.id,
        type: item.type,
        content: item.type === 'TEXT' ? (item.text?.trim() ?? null) : null,
        url:
          item.type === 'WEBSITE'
            ? (item.website ?? null)
            : item.type === 'VIDEO'
              ? (item.video ?? null)
              : null,
        trainingSubPages: item.type === 'WEBSITE' ? subPagesOf(item) : null,
        trainingInterval: item.type === 'WEBSITE' ? (item.trainingInterval ?? null) : null,
        documentName: item.type === 'DOCUMENT' ? (item.documentName ?? null) : null,
        documentMimetype: item.type === 'DOCUMENT' ? (item.documentMimetype ?? null) : null,
        status: 'DONE',
      })
      .onConflictDoNothing({ target: training.gptmakerTrainingId })
      .returning({ id: training.id });
    return inserted.length > 0;
  }
}

const missingKey = (trainingId: string) => `training-missing:${trainingId}`;

function subPagesOf(item: GptMakerTraining): boolean | null {
  if (item.trainingSubPages === 'ACTIVE') return true;
  if (item.trainingSubPages === 'DISABLED') return false;
  return null;
}
