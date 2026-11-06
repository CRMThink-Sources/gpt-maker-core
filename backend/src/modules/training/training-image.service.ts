import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { TrainingImageView } from '@gptmaker/contracts';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { newTraceId, runWithContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { training, trainingImage } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { ObjectStorage } from '../../shared/storage/object-storage';

export type TrainingImage = typeof trainingImage.$inferSelect;

/** Imagem enviada e não ligada a um treinamento (nem a uma resposta do formulário) é apagada. */
const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Imagens de treinamentos de texto (spec agent-training-image): guarda no storage privado, entrega
 * ao GPTMaker por URL de leitura temporária e apaga o arquivo quando deixa de ser usado.
 */
@Injectable()
export class TrainingImageService {
  private readonly logger = new Logger(TrainingImageService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly storage: ObjectStorage,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Pick<Env, 'API_PUBLIC_URL'>,
  ) {
    this.lock = new DistributedLock(redis);
  }

  async store(input: {
    tenantId: string;
    agentId: string;
    fileName: string;
    mimetype: string;
    ext: string;
    body: Buffer;
  }): Promise<TrainingImage> {
    const objectKey = this.storage.newTrainingKey(input.tenantId, `imagem.${input.ext}`);
    await this.storage.put({
      key: objectKey,
      body: input.body,
      contentType: input.mimetype,
      contentLength: input.body.length,
      fileName: input.fileName,
    });
    try {
      const [row] = await this.db
        .insert(trainingImage)
        .values({
          tenantId: input.tenantId,
          agentId: input.agentId,
          objectKey,
          publicToken: randomBytes(32).toString('base64url'),
          fileName: input.fileName,
          mimetype: input.mimetype,
          sizeBytes: input.body.length,
        })
        .returning();
      return row!;
    } catch (error) {
      await this.deleteObject(objectKey);
      throw error;
    }
  }

  /** Imagem não removida do agente (404 `TRAINING_IMAGE_NOT_FOUND` se de outro agente ou tenant). */
  async resolve(tenantId: string, agentId: string, imageId: string): Promise<TrainingImage> {
    const [row] = UUID.test(imageId)
      ? await this.db
          .select()
          .from(trainingImage)
          .where(
            and(
              eq(trainingImage.id, imageId),
              eq(trainingImage.tenantId, tenantId),
              eq(trainingImage.agentId, agentId),
              isNull(trainingImage.deletedAt),
            ),
          )
      : [];
    if (!row) {
      throw new DomainError(
        'TRAINING_IMAGE_NOT_FOUND',
        'Imagem não encontrada; envie a imagem de novo',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  async find(imageId: string): Promise<TrainingImage | undefined> {
    const [row] = await this.db
      .select()
      .from(trainingImage)
      .where(and(eq(trainingImage.id, imageId), isNull(trainingImage.deletedAt)));
    return row;
  }

  async findMany(imageIds: string[]): Promise<Map<string, TrainingImage>> {
    if (imageIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(trainingImage)
      .where(and(inArray(trainingImage.id, imageIds), isNull(trainingImage.deletedAt)));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Único ponto da URL enviada ao GPTMaker (design D6). O GPTMaker guarda a URL como veio (não
   * copia o arquivo) e, ao criar, a verifica com `HEAD`: por isso a URL é estável e da nossa API
   * (aceita `GET` e `HEAD`), não uma URL pré-assinada do storage, que expira e rejeita `HEAD`.
   */
  async imageUrlFor(image: Pick<TrainingImage, 'publicToken'>): Promise<string> {
    const base = this.env.API_PUBLIC_URL.replace(/\/+$/, '');
    return `${base}/public/training-images/${encodeURIComponent(image.publicToken)}`;
  }

  /** Arquivo da URL pública (`null` se o token não existe ou a imagem foi removida). */
  async readPublic(
    token: string,
  ): Promise<{ mimetype: string; body: Readable; contentLength?: number } | null> {
    const [row] = await this.db
      .select()
      .from(trainingImage)
      .where(and(eq(trainingImage.publicToken, token), isNull(trainingImage.deletedAt)));
    if (!row) return null;
    try {
      const object = await this.storage.getObject(row.objectKey);
      return { mimetype: row.mimetype, ...object };
    } catch (error) {
      this.logger.warn({ imageId: row.id, err: error }, 'imagem pública não encontrada no storage');
      return null;
    }
  }

  async view(image: TrainingImage): Promise<TrainingImageView> {
    return {
      id: image.id,
      url: await this.imageUrlFor(image),
      mimetype: image.mimetype,
      sizeBytes: image.sizeBytes,
    };
  }

  /** Marca como removida e apaga o arquivo; falha do storage só vai para o log (a limpeza repete). */
  async discard(imageId: string | null | undefined): Promise<void> {
    if (!imageId) return;
    try {
      const [row] = await this.db
        .update(trainingImage)
        .set({ deletedAt: new Date() })
        .where(and(eq(trainingImage.id, imageId), isNull(trainingImage.deletedAt)))
        .returning();
      if (row) await this.deleteObject(row.objectKey);
    } catch (error) {
      this.logger.error({ imageId, err: error }, 'imagem de treinamento não foi apagada');
    }
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.error({ key, err: error }, 'imagem ficou órfã no storage');
    }
  }

  @Cron('15 4 * * *', { name: 'training-image-cleanup' })
  async runScheduled(): Promise<void> {
    await runWithContext({ traceId: newTraceId() }, async () => {
      try {
        const outcome = await this.lock.runExclusive(
          'job:training-image-cleanup',
          30 * 60_000,
          () => this.cleanup(),
        );
        if (outcome.ran)
          this.logger.log({ summary: outcome.result }, 'limpeza de imagens concluída');
      } catch (error) {
        this.logger.error({ alert: true, err: error }, 'limpeza de imagens falhou');
      }
    });
  }

  /**
   * Apaga (a) imagens sem treinamento há mais de 24 h e que nenhuma resposta do formulário
   * (publicada ou rascunho) cita, e (b) as já removidas cujo arquivo ainda possa existir.
   */
  async cleanup(now = new Date()): Promise<{ orphans: number; retried: number }> {
    const cutoff = new Date(now.getTime() - ORPHAN_AFTER_MS);
    const orphans = await this.db
      .select({ id: trainingImage.id })
      .from(trainingImage)
      .where(
        and(
          isNull(trainingImage.deletedAt),
          lt(trainingImage.createdAt, cutoff),
          sql`not exists (select 1 from ${training} where ${training.imageId} = ${trainingImage.id} and ${training.deletedAt} is null)`,
          sql`not exists (select 1 from agent_function_config c where c.agent_id = ${trainingImage.agentId} and (c.answers::text like '%' || ${trainingImage.id}::text || '%' or c.draft_answers::text like '%' || ${trainingImage.id}::text || '%'))`,
        ),
      );
    for (const orphan of orphans) await this.discard(orphan.id);

    // Removida (treinamento apagado) cujo arquivo falhou ao sair: o delete é idempotente.
    const removed = await this.db
      .select({ objectKey: trainingImage.objectKey })
      .from(trainingImage)
      .where(
        sql`${trainingImage.deletedAt} is not null and ${trainingImage.deletedAt} > ${cutoff}`,
      );
    for (const row of removed) await this.deleteObject(row.objectKey);
    return { orphans: orphans.length, retried: removed.length };
  }
}
