import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ReviewErrorCode, ReviewKeySource } from '@gptmaker/contracts';
import type Redis from 'ioredis';
import type { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DomainError } from '../../shared/http/api-exception.filter';
import { RateLimitExceededError, RedisRateLimiter } from '../../shared/redis/rate-limiter';
import { REDIS } from '../../shared/redis/redis.module';
import { BalanceReader, CreditAlerts, LedgerService } from '../billing';
import { VibecodeClient, VibecodeError, type VibecodeMessage } from '../vibecode';
import { AiKeyService } from './ai-key.service';
import { platformKey } from './platform-key';
import { reviewError } from './review-errors';

/** Campos por tenant na janela (design D7). */
export const TENANT_FIELDS_PER_WINDOW = 60;
export const TENANT_WINDOW_MS = 10 * 60 * 1000;
/**
 * Janela do limite global da chave da CRMThink. 10 s dão vagas inteiras para qualquer RPM razoável
 * (com 5 s, 20 por minuto virava 1 por janela: 12 por minuto). A espera cobre uma janela inteira.
 */
export const PLATFORM_WINDOW_MS = 10_000;
export const PLATFORM_MAX_WAIT_MS = 10_000;

const TEMPERATURE = 0.2;

/** Erros do Vibecode com a chave da CRMThink: o cliente não vê detalhes da conta dela (design D5). */
const PLATFORM_HIDDEN: ReadonlySet<ReviewErrorCode> = new Set([
  'AI_KEY_INVALID',
  'AI_KEY_SCOPE',
  'AI_NO_BALANCE',
  'AI_MODEL_UNAVAILABLE',
]);

/** Chave escolhida para uma operação de IA; presa a ela até o fim (sem trocar no meio). */
export type AiSession = {
  tenantId: string;
  keySource: ReviewKeySource;
  /** Nome da operação nos logs ("revisão" por padrão; ex.: "análise de alucinação"). */
  purpose?: string;
};

/** Débito de uma operação de IA no razão (só com a chave da CRMThink). */
export interface AiCharge {
  /** Chave de idempotência do razão. */
  key: string;
  amount: number;
  refType: string;
  refId: string;
  agentId: string | undefined;
  /** Para o log quando o débito falha (ex.: id do campo). */
  label: string;
  /** Quem lança o débito no razão; padrão `system:review`. */
  createdBy?: string;
}

/**
 * Núcleo de IA da revisão da função (spec agent-knowledge-review; design D3 a D9), compartilhado
 * com a análise de alucinação: escolha de chave (cliente ou CRMThink), chamada ao Vibecode com
 * validação de saída, limites por cliente e global, checagem de saldo e débito idempotente.
 */
@Injectable()
export class ReviewAiRunner {
  private readonly logger = new Logger(ReviewAiRunner.name);
  private readonly platformLimiter: RedisRateLimiter;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly keys: AiKeyService,
    private readonly vibecode: VibecodeClient,
    private readonly balance: BalanceReader,
    private readonly ledger: LedgerService,
    private readonly alerts: CreditAlerts,
  ) {
    this.platformLimiter = new RedisRateLimiter(redis, {
      name: 'review:platform',
      perSecond: Math.max(1, Math.floor((env.VIBECODE_PLATFORM_RPM * PLATFORM_WINDOW_MS) / 60_000)),
      windowMs: PLATFORM_WINDOW_MS,
      maxWaitMs: PLATFORM_MAX_WAIT_MS,
    });
  }

  /** Chave do cliente, se houver; senão a da CRMThink; senão `AI_KEY_REQUIRED`. */
  async chooseKey(tenantId: string): Promise<ReviewKeySource> {
    if (await this.keys.find(tenantId)) return 'tenant';
    if (platformKey(this.env)) return 'platform';
    throw reviewError('AI_KEY_REQUIRED');
  }

  /** Chave do cliente ou da CRMThink, a que ficou presa à operação (sem trocar no meio). */
  async apiKey(session: AiSession): Promise<string> {
    const key =
      session.keySource === 'tenant'
        ? await this.keys.find(session.tenantId)
        : platformKey(this.env);
    if (!key) throw reviewError('AI_KEY_REQUIRED');
    return key;
  }

  /**
   * Com a chave da CRMThink, sem saldo para `amount` a IA nem é chamada (design D9). Valor zero ou
   * negativo (preço desligado) e chave do cliente não conferem saldo.
   */
  async assertBalance(session: AiSession, amount: number): Promise<void> {
    if (session.keySource !== 'platform' || amount <= 0) return;
    if ((await this.balance.total(session.tenantId)) < amount) throw reviewError('NO_CREDIT');
  }

  /** Débito idempotente (pela chave); só com a chave da CRMThink, depois da saída válida. */
  async charge(session: AiSession, charge: AiCharge): Promise<void> {
    if (session.keySource !== 'platform' || charge.amount <= 0) return;
    const { tenantId } = session;
    try {
      const debit = await this.ledger.debit({
        tenantId,
        key: charge.key,
        amount: charge.amount,
        // O razão exige o modelo no débito; aqui é o da revisão, que não casa com o catálogo de
        // atendimento (a reconciliação só olha os modelos do catálogo).
        modelCode: this.env.VIBECODE_REVIEW_MODEL,
        unitCost: charge.amount,
        agentId: charge.agentId,
        refType: charge.refType,
        refId: charge.refId,
        createdBy: charge.createdBy ?? 'system:review',
      });
      if (debit.applied) await this.alerts.afterDebit(tenantId, debit.balance);
    } catch (error) {
      // A IA já foi chamada e esse custo fica com a CRMThink; o cliente não recebe o resultado.
      this.logger.error(
        { alert: true, err: error, tenantId, reviewId: charge.refId, fieldKey: charge.label },
        `débito da ${session.purpose ?? 'revisão'} falhou; sem resultado`,
      );
      throw error;
    }
  }

  /**
   * Pergunta ao Vibecode e valida a saída; fora do formato, uma nova tentativa com o erro da
   * validação, e de novo fora, `AI_BAD_OUTPUT` (design D4).
   */
  async ask<S extends z.ZodType>(
    session: AiSession,
    apiKey: string,
    messages: VibecodeMessage[],
    schema: S,
  ): Promise<z.output<S>> {
    let conversation = messages;
    for (let attempt = 1; ; attempt++) {
      const content = await this.chat(session, apiKey, conversation);
      const checked = checkOutput(schema, content);
      if (checked.ok) return checked.data;
      if (attempt >= 2) {
        this.logger.warn({ tenantId: session.tenantId }, 'saída da IA fora do formato');
        throw reviewError('AI_BAD_OUTPUT');
      }
      conversation = [
        ...messages,
        { role: 'assistant', content },
        {
          role: 'user',
          content: `A resposta não segue o formato pedido (${checked.message}). Responda de novo, só com o JSON.`,
        },
      ];
    }
  }

  /**
   * Limite por cliente na janela. `name` separa a contagem de outros usos (a revisão usa
   * `review:tenant:<id>`); sem vaga, `REVIEW_RATE_LIMITED`.
   */
  async tenantLimit(tenantId: string, name = `review:tenant:${tenantId}`): Promise<void> {
    const limiter = new RedisRateLimiter(this.redis, {
      name,
      perSecond: TENANT_FIELDS_PER_WINDOW,
      windowMs: TENANT_WINDOW_MS,
      maxWaitMs: 0,
    });
    try {
      await limiter.acquire();
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new DomainError(
          'REVIEW_RATE_LIMITED',
          'Muitas revisões em pouco tempo. Aguarde alguns minutos.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }
  }

  private async chat(
    session: AiSession,
    apiKey: string,
    messages: VibecodeMessage[],
  ): Promise<string> {
    if (session.keySource === 'platform') await this.platformSlot();
    try {
      const result = await this.vibecode.chat({
        apiKey,
        model: this.env.VIBECODE_REVIEW_MODEL,
        messages,
        temperature: TEMPERATURE,
        json: true,
      });
      this.logger.log(
        { tenantId: session.tenantId, keySource: session.keySource, usage: result.usage },
        `${session.purpose ?? 'revisão'}: chamada ao Vibecode concluída`,
      );
      return result.content;
    } catch (error) {
      throw this.translate(session, error);
    }
  }

  /** Vaga no limite global da chave da CRMThink; sem vaga, `AI_BUSY` sem cobrança (design D7). */
  private async platformSlot(): Promise<void> {
    try {
      await this.platformLimiter.acquire();
    } catch (error) {
      if (error instanceof RateLimitExceededError) throw reviewError('AI_BUSY');
      throw error;
    }
  }

  /** Erro do Vibecode → mensagem do spec; com a chave da CRMThink, sem detalhes da conta dela. */
  private translate(session: AiSession, error: unknown): unknown {
    if (!(error instanceof VibecodeError)) return error;
    if (session.keySource === 'platform' && PLATFORM_HIDDEN.has(error.code)) {
      this.logger.error(
        { alert: true, code: error.code, vibecodeCode: error.vibecodeCode, status: error.status },
        `chave da CRMThink recusada pelo Vibecode na ${session.purpose ?? 'revisão'}`,
      );
      return reviewError('AI_UNAVAILABLE');
    }
    return reviewError(error.code);
  }
}

function checkOutput<S extends z.ZodType>(
  schema: S,
  content: string,
): { ok: true; data: z.output<S> } | { ok: false; message: string } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, message: 'não é um JSON válido' };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    message: parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`)
      .join('; '),
  };
}
