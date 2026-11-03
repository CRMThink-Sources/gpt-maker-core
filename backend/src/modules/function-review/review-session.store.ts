import { Inject, Injectable } from '@nestjs/common';
import type { ReviewKeySource } from '@gptmaker/contracts';
import type Redis from 'ioredis';
import { REDIS } from '../../shared/redis/redis.module';

/** Validade da revisão: depois disso o app cria outra (design D3). */
export const REVIEW_TTL_SECONDS = 30 * 60;

export interface ReviewSession {
  tenantId: string;
  agentId: string;
  keySource: ReviewKeySource;
  /** Campos que a revisão pode ler, escolhidos na criação. */
  fieldIds: string[];
  /** Campos de base (todos, inclusive vazios) onde a análise de cobertura pode sugerir itens. */
  gapFieldIds?: string[];
  /** O que o cliente espera do agente; só aqui (30 min), contexto das revisões desta sessão. */
  expectation?: string;
}

const sessionKey = (reviewId: string) => `review:${reviewId}`;
const fieldKey = (reviewId: string, fieldId: string) => `review:${reviewId}:field:${fieldId}`;

/**
 * A revisão vive só no Redis (design D3): quem, qual chave e quais campos, mais a marca de cada
 * campo já reservado. Um campo só é chamado uma vez por revisão (`SET NX`): reusar o `reviewId` não
 * revisa de novo sem cobrar.
 */
@Injectable()
export class ReviewSessionStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async create(reviewId: string, session: ReviewSession): Promise<void> {
    await this.redis.set(sessionKey(reviewId), JSON.stringify(session), 'EX', REVIEW_TTL_SECONDS);
  }

  async find(reviewId: string): Promise<ReviewSession | null> {
    const raw = await this.redis.get(sessionKey(reviewId));
    return raw ? (JSON.parse(raw) as ReviewSession) : null;
  }

  /** `true` se o campo ainda não tinha sido reservado nesta revisão. */
  async reserve(reviewId: string, fieldId: string): Promise<boolean> {
    const reserved = await this.redis.set(
      fieldKey(reviewId, fieldId),
      '1',
      'EX',
      REVIEW_TTL_SECONDS,
      'NX',
    );
    return reserved === 'OK';
  }

  /** Falha do campo libera a reserva, para o app tentar de novo na mesma revisão. */
  async release(reviewId: string, fieldId: string): Promise<void> {
    await this.redis.del(fieldKey(reviewId, fieldId));
  }
}
