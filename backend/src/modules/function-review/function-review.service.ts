import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  assistFields,
  type AssistInput,
  assistModelOutputSchema,
  type AssistResult,
  type CreateReviewInput,
  type CreateReviewResult,
  type FunctionAnswers,
  type FunctionTemplateContent,
  GAPS_FIELD_ID,
  flattenFields,
  reviewableFields,
  visibleFields,
  type ReviewGapsInput,
  type ReviewGapsResult,
  reviewGapsModelOutputSchema,
  type ReviewCrossInput,
  type ReviewCrossResult,
  reviewCrossResultSchema,
  type ReviewErrorCode,
  type ReviewFieldInput,
  type ReviewFieldResult,
  type ReviewKeySource,
  reviewModelFieldOutputSchema,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { agentFunctionConfig } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { RateLimitExceededError, RedisRateLimiter } from '../../shared/redis/rate-limiter';
import { REDIS } from '../../shared/redis/redis.module';
import { AgentRepository } from '../agents';
import { FunctionCatalog } from '../agent-functions';
import { BalanceReader, CreditAlerts, LedgerService } from '../billing';
import { VibecodeClient, VibecodeError, type VibecodeMessage } from '../vibecode';
import { AiKeyService } from './ai-key.service';
import { assistMessages, toAssistResult } from './assist-prompt';
import {
  crossMessages,
  type FieldPromptContext,
  fieldMessages,
  gapBase,
  gapsMessages,
  otherBaseTitles,
  toGapsResult,
  reviewItems,
  type ReviewableField,
  toFieldResult,
} from './review-prompt';
import { reviewError } from './review-errors';
import { ReviewSessionStore } from './review-session.store';

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

type Session = { tenantId: string; keySource: ReviewKeySource };

const notFound = () =>
  new DomainError('REVIEW_NOT_FOUND', 'Revisão não encontrada ou expirada', HttpStatus.NOT_FOUND);

/**
 * Revisão por IA das respostas da função (spec agent-knowledge-review; design D3 a D9): o app cria
 * a revisão e depois pede campo a campo; cada campo é uma chamada ao Vibecode, cobrada à parte
 * quando a chave é a da CRMThink.
 */
@Injectable()
export class FunctionReviewService {
  private readonly logger = new Logger(FunctionReviewService.name);
  private readonly platformLimiter: RedisRateLimiter;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly agentRows: AgentRepository,
    private readonly catalog: FunctionCatalog,
    private readonly keys: AiKeyService,
    private readonly vibecode: VibecodeClient,
    private readonly sessions: ReviewSessionStore,
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

  async create(
    tenantId: string,
    agentId: string,
    input: CreateReviewInput,
  ): Promise<CreateReviewResult> {
    const { content } = await this.template(tenantId, agentId);
    const reviewable = new Set(
      flattenFields(content.fields)
        .filter(isReviewable)
        .map((field) => field.id),
    );
    const refused = input.fieldIds.filter((id) => !reviewable.has(id));
    if (refused.length) {
      throw new DomainError(
        'REVIEW_FIELD_NOT_REVIEWABLE',
        `Estes campos não podem ser revisados: ${refused.join(', ')}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const keySource = await this.chooseKey(tenantId);
    const reviewId = randomUUID();
    // Cobertura: todos os campos de base, inclusive os vazios (nao entram em `fieldIds`).
    const gapFieldIds = input.withGaps
      ? flattenFields(content.fields)
          .filter((field) => field.kind === 'KNOWLEDGE')
          .map((field) => field.id)
      : undefined;
    await this.sessions.create(reviewId, {
      tenantId,
      agentId,
      keySource,
      fieldIds: [...new Set(input.fieldIds)],
      ...(gapFieldIds ? { gapFieldIds } : {}),
      ...(input.expectation ? { expectation: input.expectation } : {}),
    });
    return { reviewId, keySource, creditsPerField: this.env.REVIEW_CREDITS_PER_FIELD };
  }

  async reviewField(
    tenantId: string,
    agentId: string,
    reviewId: string,
    input: ReviewFieldInput,
  ): Promise<ReviewFieldResult> {
    const session = await this.session(tenantId, agentId, reviewId);
    if (!session.fieldIds.includes(input.fieldId)) throw notFound();

    const { content, functionName, functionDescription, agentName } = await this.template(
      tenantId,
      agentId,
    );
    // O template é o da versão a que a configuração está presa, nunca o que vem do app.
    const { answers, issues } = validateFunctionAnswers(content, input.answers as FunctionAnswers, {
      partial: true,
    });
    if (issues.length) {
      throw new DomainError(
        'FUNCTION_ANSWERS_INVALID',
        'As respostas têm erros; corrija antes de revisar',
        HttpStatus.UNPROCESSABLE_ENTITY,
        issues,
      );
    }
    const field = reviewableFields(content, answers).find((entry) => entry.id === input.fieldId);
    if (!field || !isReviewable(field)) {
      throw new DomainError(
        'REVIEW_FIELD_NOT_REVIEWABLE',
        'Este campo não tem o que revisar',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await this.tenantLimit(tenantId);
    if (!(await this.sessions.reserve(reviewId, field.id))) {
      throw new DomainError(
        'REVIEW_FIELD_RESERVED',
        'Este campo já foi revisado nesta revisão',
        HttpStatus.CONFLICT,
      );
    }
    try {
      return await this.run(session, reviewId, agentId, field, answers, {
        functionName,
        agentName,
        functionDescription,
        expectation: session.expectation,
        otherTitles: otherBaseTitles(
          flattenFields(content.fields).filter(
            (entry): entry is Extract<typeof entry, { kind: 'KNOWLEDGE' }> =>
              entry.kind === 'KNOWLEDGE',
          ),
          answers,
          field.id,
        ),
      });
    } catch (error) {
      // Falha libera o campo, para o app poder tentar de novo na mesma revisão.
      await this.sessions.release(reviewId, field.id).catch(() => undefined);
      throw error;
    }
  }

  /** Contradições entre campos: uma chamada só com os resumos, sem cobrança (design D3). */
  async cross(
    tenantId: string,
    agentId: string,
    reviewId: string,
    input: ReviewCrossInput,
  ): Promise<ReviewCrossResult> {
    const session = await this.session(tenantId, agentId, reviewId);
    const { content } = await this.template(tenantId, agentId);
    const labels = new Map(flattenFields(content.fields).map((field) => [field.id, field.label]));
    const summaries = input.summaries.map((entry) => {
      if (!session.fieldIds.includes(entry.fieldId)) throw notFound();
      return { ...entry, label: labels.get(entry.fieldId) ?? entry.fieldId };
    });

    const apiKey = await this.apiKey(session);
    await this.tenantLimit(tenantId);
    const output = await this.ask(
      session,
      apiKey,
      crossMessages(summaries),
      reviewCrossResultSchema,
    );
    const known = new Set(session.fieldIds);
    // O modelo às vezes cita o nome do campo em vez do id: aceita os dois.
    const byLabel = new Map(
      summaries.map((entry) => [entry.label.trim().toLowerCase(), entry.fieldId]),
    );
    const toId = (ref: string) => (known.has(ref) ? ref : byLabel.get(ref.trim().toLowerCase()));
    const contradictions = output.contradictions
      .map((entry) => ({
        ...entry,
        fields: [...new Set(entry.fields.map(toId).filter((id): id is string => !!id))],
      }))
      .filter((entry) => entry.fields.length > 0);
    this.logger.log(
      { tenantId, raw: output.contradictions.length, kept: contradictions.length },
      'revisão: contradições conferidas',
    );
    return { contradictions };
  }

  /**
   * Cobertura da base (spec agent-knowledge-gaps): compara a expectativa com os campos de base e
   * sugere os itens que faltam. Uma chamada, cobrada como um campo (design D6).
   */
  async gaps(
    tenantId: string,
    agentId: string,
    reviewId: string,
    input: ReviewGapsInput,
  ): Promise<ReviewGapsResult> {
    const session = await this.session(tenantId, agentId, reviewId);
    if (!session.gapFieldIds?.length) {
      throw new DomainError(
        'REVIEW_GAPS_NOT_ENABLED',
        'Esta revisão não inclui a análise de cobertura',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    for (const entry of input.summaries) {
      if (!session.fieldIds.includes(entry.fieldId)) throw notFound();
    }
    const { content, functionName, agentName } = await this.template(tenantId, agentId);
    const { answers, issues } = validateFunctionAnswers(content, input.answers as FunctionAnswers, {
      partial: true,
    });
    if (issues.length) {
      throw new DomainError(
        'FUNCTION_ANSWERS_INVALID',
        'As respostas têm erros; corrija antes de revisar',
        HttpStatus.UNPROCESSABLE_ENTITY,
        issues,
      );
    }
    const expectation = input.expectation ?? session.expectation;
    if (!expectation) {
      throw new DomainError(
        'REVIEW_EXPECTATION_REQUIRED',
        'Descreva o que você espera do agente para analisar a cobertura',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const summaries = new Map(input.summaries.map((entry) => [entry.fieldId, entry.summary]));
    const allowed = new Set(session.gapFieldIds);
    const bases = visibleFields(content.fields, answers)
      .filter(
        (field): field is Extract<typeof field, { kind: 'KNOWLEDGE' }> =>
          field.kind === 'KNOWLEDGE',
      )
      .filter((field) => allowed.has(field.id))
      .map((field) => gapBase(field, answers, summaries.get(field.id)));
    if (bases.length === 0) return { gaps: [], covered: [] };

    await this.tenantLimit(tenantId);
    if (!(await this.sessions.reserve(reviewId, GAPS_FIELD_ID))) {
      throw new DomainError(
        'REVIEW_FIELD_RESERVED',
        'A análise de cobertura já foi feita nesta revisão',
        HttpStatus.CONFLICT,
      );
    }
    try {
      await this.assertBalance(session);
      const apiKey = await this.apiKey(session);
      const output = await this.ask(
        session,
        apiKey,
        gapsMessages(expectation, bases, { functionName, agentName }),
        reviewGapsModelOutputSchema,
      );
      const result = toGapsResult(output, bases);
      await this.charge(session, reviewId, agentId, GAPS_FIELD_ID);
      return result;
    } catch (error) {
      await this.sessions.release(reviewId, GAPS_FIELD_ID).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Ajuda da IA: rascunho dos campos de texto vazios, sem sessão. A chave é escolhida na hora; cada
   * campo gerado é cobrado à parte (chave `assist:<id>:<campo>`), só depois da saída válida.
   */
  async assist(tenantId: string, agentId: string, input: AssistInput): Promise<AssistResult> {
    const { content, functionName, functionDescription, agentName } = await this.template(
      tenantId,
      agentId,
    );
    const { answers, issues } = validateFunctionAnswers(content, input.answers as FunctionAnswers, {
      partial: true,
    });
    if (issues.length) {
      throw new DomainError(
        'FUNCTION_ANSWERS_INVALID',
        'As respostas têm erros; corrija antes de pedir a ajuda',
        HttpStatus.UNPROCESSABLE_ENTITY,
        issues,
      );
    }
    const eligible = assistFields(content, answers);
    if (!content.assist.enabled || eligible.length === 0) {
      throw new DomainError(
        'ASSIST_NOT_ENABLED',
        'A ajuda da IA não está disponível para esta função',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const ids = [...new Set(input.fieldIds)];
    const eligibleIds = new Set(eligible.map((field) => field.id));
    const refused = ids.filter((id) => !eligibleIds.has(id));
    if (refused.length) {
      throw new DomainError(
        'ASSIST_FIELD_NOT_ELIGIBLE',
        `A ajuda da IA não se aplica a estes campos: ${refused.join(', ')}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const fields = eligible.filter((field) => ids.includes(field.id));

    const session: Session = { tenantId, keySource: await this.chooseKey(tenantId) };
    await this.tenantLimit(tenantId);
    const price = this.env.REVIEW_CREDITS_PER_FIELD;
    // Sem saldo para todos os campos pedidos, a IA nem é chamada.
    if (session.keySource === 'platform' && price > 0) {
      if ((await this.balance.total(tenantId)) < price * fields.length) {
        throw reviewError('NO_CREDIT');
      }
    }
    const apiKey = await this.apiKey(session);
    const output = await this.ask(
      session,
      apiKey,
      assistMessages({
        fields,
        about: input.about,
        interview: input.interview,
        context: { functionName, functionDescription, agentName },
      }),
      assistModelOutputSchema,
    );
    // O modelo às vezes cita o nome do campo em vez do id: aceita os dois; o resto é ignorado.
    const byLabel = new Map(fields.map((field) => [field.label.trim().toLowerCase(), field.id]));
    const toId = (ref: string) =>
      eligibleIds.has(ref) && ids.includes(ref) ? ref : byLabel.get(ref.trim().toLowerCase());
    const normalized = {
      fields: output.fields.flatMap((entry) => {
        const fieldId = toId(entry.fieldId);
        return fieldId ? [{ ...entry, fieldId }] : [];
      }),
    };
    const result = toAssistResult(fields, normalized);

    const assistId = randomUUID();
    // Cobra só o campo que a IA devolveu.
    const generated = fields.filter((field) =>
      normalized.fields.some((entry) => entry.fieldId === field.id),
    );
    for (const field of generated) {
      await this.charge(session, assistId, agentId, field.id, `assist:${assistId}:${field.id}`);
    }
    const credits = session.keySource === 'platform' && price > 0 ? price * generated.length : 0;
    return { fields: result, credits };
  }

  // Internos ---------------------------------------------------------------------------------

  /** Com a chave da CRMThink, sem saldo para um campo a IA nem é chamada (design D9). */
  private async assertBalance(session: Session): Promise<void> {
    const price = this.env.REVIEW_CREDITS_PER_FIELD;
    if (session.keySource !== 'platform' || price <= 0) return;
    if ((await this.balance.total(session.tenantId)) < price) throw reviewError('NO_CREDIT');
  }

  /** Débito de um campo (idempotente pela chave); só com a chave da CRMThink, depois da saída válida. */
  private async charge(
    session: Session,
    reviewId: string,
    agentId: string,
    fieldKey: string,
    key = `review:${reviewId}:${fieldKey}`,
  ): Promise<void> {
    const price = this.env.REVIEW_CREDITS_PER_FIELD;
    if (session.keySource !== 'platform' || price <= 0) return;
    const { tenantId } = session;
    try {
      const debit = await this.ledger.debit({
        tenantId,
        key,
        amount: price,
        // O razão exige o modelo no débito; aqui é o da revisão, que não casa com o catálogo de
        // atendimento (a reconciliação só olha os modelos do catálogo).
        modelCode: this.env.VIBECODE_REVIEW_MODEL,
        unitCost: price,
        agentId,
        refType: 'function_review',
        refId: reviewId,
        createdBy: 'system:review',
      });
      if (debit.applied) await this.alerts.afterDebit(tenantId, debit.balance);
    } catch (error) {
      // A IA já foi chamada e esse custo fica com a CRMThink; o cliente não recebe o resultado.
      this.logger.error(
        { alert: true, err: error, tenantId, reviewId, fieldKey },
        'débito da revisão falhou; sem resultado',
      );
      throw error;
    }
  }

  private async run(
    session: Session,
    reviewId: string,
    agentId: string,
    field: ReviewableField,
    answers: FunctionAnswers,
    context: FieldPromptContext,
  ): Promise<ReviewFieldResult> {
    // Sem saldo, o campo nem chega à IA (design D9).
    await this.assertBalance(session);

    const apiKey = await this.apiKey(session);
    const items = reviewItems(field, answers);
    const output = await this.ask(
      session,
      apiKey,
      fieldMessages(field, items, context),
      reviewModelFieldOutputSchema,
    );
    const result = toFieldResult(field, items, output);

    await this.charge(session, reviewId, agentId, field.id);
    return result;
  }

  /**
   * Pergunta ao Vibecode e valida a saída; fora do formato, uma nova tentativa com o erro da
   * validação, e de novo fora, `AI_BAD_OUTPUT` (design D4).
   */
  private async ask<S extends z.ZodType>(
    session: Session,
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

  private async chat(
    session: Session,
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
        'revisão: chamada ao Vibecode concluída',
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

  private async tenantLimit(tenantId: string): Promise<void> {
    const limiter = new RedisRateLimiter(this.redis, {
      name: `review:tenant:${tenantId}`,
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

  /** Erro do Vibecode → mensagem do spec; com a chave da CRMThink, sem detalhes da conta dela. */
  private translate(session: Session, error: unknown): unknown {
    if (!(error instanceof VibecodeError)) return error;
    if (session.keySource === 'platform' && PLATFORM_HIDDEN.has(error.code)) {
      this.logger.error(
        { alert: true, code: error.code, vibecodeCode: error.vibecodeCode, status: error.status },
        'chave da CRMThink recusada pelo Vibecode na revisão',
      );
      return reviewError('AI_UNAVAILABLE');
    }
    return reviewError(error.code);
  }

  /** Chave do cliente ou da CRMThink, a que ficou presa à revisão (sem trocar no meio). */
  private async apiKey(session: Session): Promise<string> {
    const key =
      session.keySource === 'tenant'
        ? await this.keys.find(session.tenantId)
        : this.env.VIBECODE_PLATFORM_API_KEY;
    if (!key) throw reviewError('AI_KEY_REQUIRED');
    return key;
  }

  private async chooseKey(tenantId: string): Promise<ReviewKeySource> {
    if (await this.keys.find(tenantId)) return 'tenant';
    if (this.env.VIBECODE_PLATFORM_API_KEY) return 'platform';
    throw reviewError('AI_KEY_REQUIRED');
  }

  private async session(
    tenantId: string,
    agentId: string,
    reviewId: string,
  ): Promise<Session & { fieldIds: string[]; gapFieldIds?: string[]; expectation?: string }> {
    const session = await this.sessions.find(reviewId);
    // Revisão de outro tenant ou de outro agente é como se não existisse.
    if (!session || session.tenantId !== tenantId || session.agentId !== agentId) throw notFound();
    return session;
  }

  /** Template da versão a que a configuração do agente está presa. */
  private async template(
    tenantId: string,
    agentId: string,
  ): Promise<{
    content: FunctionTemplateContent;
    functionName: string;
    functionDescription: string;
    agentName: string;
  }> {
    const agent = await this.agentRows.getById(tenantId, agentId);
    const [config] = await this.db
      .select({
        templateId: agentFunctionConfig.templateId,
        versionId: agentFunctionConfig.versionId,
      })
      .from(agentFunctionConfig)
      .where(eq(agentFunctionConfig.agentId, agentId));
    if (!config) {
      throw new DomainError(
        'FUNCTION_NOT_CONFIGURED',
        'Este agente não tem função configurada',
        HttpStatus.NOT_FOUND,
      );
    }
    const published = config.versionId
      ? await this.catalog.versionById(config.versionId)
      : await this.catalog.latestOfTemplate(config.templateId);
    return {
      content: published.content,
      functionName: published.name,
      functionDescription: published.description,
      agentName: agent.name,
    };
  }
}

function isReviewable(field: { kind: string }): field is ReviewableField {
  return field.kind === 'TEXT' || field.kind === 'TEXT_LIST' || field.kind === 'KNOWLEDGE';
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
