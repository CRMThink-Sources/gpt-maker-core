import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  assistFields,
  assistKnowledgeMode,
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
  type ReviewFieldInput,
  type ReviewFieldResult,
  reviewModelFieldOutputSchema,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { DomainError } from '../../shared/http/api-exception.filter';
import { REDIS } from '../../shared/redis/redis.module';
import { AgentRepository } from '../agents';
import { FunctionCatalog } from '../agent-functions';
import { BalanceReader, CreditAlerts, LedgerService } from '../billing';
import { VibecodeClient } from '../vibecode';
import { AiKeyService } from './ai-key.service';
import {
  type AssistableField,
  assistMessages,
  type KnowledgeMode,
  toAssistResult,
} from './assist-prompt';
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
import { type AgentFunctionTemplate, FunctionTemplateReader } from './function-template.reader';
import { type AiSession, ReviewAiRunner } from './review-ai.runner';
import { ReviewSessionStore } from './review-session.store';

export {
  PLATFORM_MAX_WAIT_MS,
  PLATFORM_WINDOW_MS,
  TENANT_FIELDS_PER_WINDOW,
  TENANT_WINDOW_MS,
} from './review-ai.runner';

type Session = AiSession;

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
  private readonly ai: ReviewAiRunner;
  private readonly templates: FunctionTemplateReader;

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
    // Os mesmos providers do módulo (um só limiter e um só log); sem eles (testes), nascem aqui.
    @Optional() runner?: ReviewAiRunner,
    @Optional() templates?: FunctionTemplateReader,
  ) {
    this.ai = runner ?? new ReviewAiRunner(env, redis, keys, vibecode, balance, ledger, alerts);
    this.templates = templates ?? new FunctionTemplateReader(db, agentRows, catalog);
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

    const keySource = await this.ai.chooseKey(tenantId);
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

    await this.ai.tenantLimit(tenantId);
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

    const apiKey = await this.ai.apiKey(session);
    await this.ai.tenantLimit(tenantId);
    const output = await this.ai.ask(
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

    await this.ai.tenantLimit(tenantId);
    if (!(await this.sessions.reserve(reviewId, GAPS_FIELD_ID))) {
      throw new DomainError(
        'REVIEW_FIELD_RESERVED',
        'A análise de cobertura já foi feita nesta revisão',
        HttpStatus.CONFLICT,
      );
    }
    try {
      await this.assertBalance(session);
      const apiKey = await this.ai.apiKey(session);
      const output = await this.ai.ask(
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
   * Ajuda da IA: rascunho dos campos de texto vazios, sem sessão. A chave é escolhida na hora; a
   * chamada gera um débito só (chave `assist:<uuid>`, preço por campo gerado), depois da saída válida.
   * Usa a versão mais recente do template, a mesma do formulário que o cliente vê.
   */
  async assist(tenantId: string, agentId: string, input: AssistInput): Promise<AssistResult> {
    const { content, functionName, functionDescription, agentName } = await this.template(
      tenantId,
      agentId,
      { latest: true },
    );
    return this.assistFor(
      tenantId,
      { content, functionName, functionDescription, agentName, agentId },
      input,
    );
  }

  /**
   * Mesma ajuda, para o assistente de criação, onde ainda não há agente: a função vem pelo código,
   * na última versão publicada e só se estiver disponível para o portal (senão 422 sem chamar a IA).
   */
  async assistByCode(tenantId: string, code: string, input: AssistInput): Promise<AssistResult> {
    const published = await this.catalog.latestPublished(code, tenantId);
    return this.assistFor(
      tenantId,
      {
        content: published.content,
        functionName: published.name,
        functionDescription: published.description,
      },
      input,
    );
  }

  private async assistFor(
    tenantId: string,
    source: {
      content: FunctionTemplateContent;
      functionName: string;
      functionDescription: string;
      agentName?: string;
      agentId?: string;
    },
    input: AssistInput,
  ): Promise<AssistResult> {
    const { content, functionName, functionDescription, agentName, agentId } = source;
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
    if (!content.assist?.enabled || eligible.length === 0) {
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
      const labels = new Map(flattenFields(content.fields).map((field) => [field.id, field.label]));
      const names = refused.flatMap((id) => {
        const label = labels.get(id);
        return label ? [label] : [];
      });
      const refusedMessage = names.length
        ? `A ajuda da IA não se aplica a estes campos: ${names.join(', ')}`
        : 'A ajuda da IA não se aplica a estes campos';
      throw new DomainError(
        'ASSIST_FIELD_NOT_ELIGIBLE',
        refusedMessage,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const fields = eligible.filter((field) => ids.includes(field.id));
    try {
      return await this.assistRun(
        tenantId,
        agentId,
        input,
        fields,
        { functionName, functionDescription, agentName },
        assistKnowledgeMode(content),
      );
    } catch (error) {
      throw helpWording(error);
    }
  }

  private async assistRun(
    tenantId: string,
    agentId: string | undefined,
    input: AssistInput,
    fields: AssistableField[],
    context: { functionName: string; functionDescription: string; agentName?: string },
    knowledgeMode: KnowledgeMode,
  ): Promise<AssistResult> {
    const ids = fields.map((field) => field.id);
    const eligibleIds = new Set(ids);
    const session: Session = { tenantId, keySource: await this.ai.chooseKey(tenantId) };
    await this.ai.tenantLimit(tenantId);
    const price = this.env.REVIEW_CREDITS_PER_FIELD;
    // Sem saldo para todos os campos pedidos, a IA nem é chamada.
    await this.ai.assertBalance(session, price * fields.length);
    const apiKey = await this.ai.apiKey(session);
    const output = await this.ai.ask(
      session,
      apiKey,
      assistMessages({
        fields,
        about: input.about,
        interview: input.interview,
        context,
        knowledgeMode,
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
    const result = toAssistResult(fields, normalized, { knowledgeMode });

    // Campo gerado = valor não vazio (texto acima do limite conta; base com algum valor conta);
    // um débito só por chamada.
    const filled = (item: unknown): boolean =>
      typeof item === 'string'
        ? item.trim() !== ''
        : typeof item === 'object' &&
          item !== null &&
          'values' in item &&
          Object.values((item as { values: Record<string, string> }).values).some(
            (text) => text.trim() !== '',
          );
    const generated = result.filter((entry) =>
      Array.isArray(entry.value) ? entry.value.some(filled) : filled(entry.value),
    ).length;
    const assistId = randomUUID();
    const amount = session.keySource === 'platform' ? price * generated : 0;
    if (amount > 0) {
      await this.charge(session, assistId, agentId, 'assist', `assist:${assistId}`, amount);
    }
    const credits = amount;
    return { fields: result, credits };
  }

  // Internos ---------------------------------------------------------------------------------

  /** Com a chave da CRMThink, sem saldo para um campo a IA nem é chamada (design D9). */
  private assertBalance(session: Session): Promise<void> {
    return this.ai.assertBalance(session, this.env.REVIEW_CREDITS_PER_FIELD);
  }

  /** Débito de um campo (idempotente pela chave); só com a chave da CRMThink, depois da saída válida. */
  private charge(
    session: Session,
    reviewId: string,
    agentId: string | undefined,
    fieldKey: string,
    key = `review:${reviewId}:${fieldKey}`,
    amount = this.env.REVIEW_CREDITS_PER_FIELD,
  ): Promise<void> {
    return this.ai.charge(session, {
      key,
      amount,
      refType: 'function_review',
      refId: reviewId,
      agentId,
      label: fieldKey,
    });
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

    const apiKey = await this.ai.apiKey(session);
    const items = reviewItems(field, answers);
    const output = await this.ai.ask(
      session,
      apiKey,
      fieldMessages(field, items, context),
      reviewModelFieldOutputSchema,
    );
    const result = toFieldResult(field, items, output);

    await this.charge(session, reviewId, agentId, field.id);
    return result;
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

  /** Template da versão a que a configuração do agente está presa (ou a mais recente, com `latest`). */
  private template(
    tenantId: string,
    agentId: string,
    options: { latest?: boolean } = {},
  ): Promise<AgentFunctionTemplate> {
    return this.templates.forAgent(tenantId, agentId, options);
  }
}

/** Mensagens da ajuda da IA no lugar das da revisão; o `code` e o status não mudam. */
const HELP_WORDING: Partial<Record<string, string>> = {
  AI_KEY_REQUIRED: 'Para usar a ajuda da IA, informe a chave do Vibecode.',
  AI_MODEL_UNAVAILABLE:
    'A chave não tem acesso ao modelo usado na ajuda da IA, ou ele está fora do ar.',
  AI_UNAVAILABLE: 'A ajuda da IA está fora do ar agora. Tente de novo em instantes.',
  AI_BUSY: 'Muitos pedidos de ajuda agora. Tente de novo em instantes.',
  AI_FIELD_TOO_LARGE: 'Este texto é grande demais para a ajuda da IA.',
  AI_BAD_OUTPUT: 'Não foi possível gerar o texto. Tente de novo.',
  REVIEW_RATE_LIMITED: 'Muitos pedidos de ajuda em pouco tempo. Aguarde alguns minutos.',
};

function helpWording(error: unknown): unknown {
  if (!(error instanceof DomainError)) return error;
  const message = HELP_WORDING[error.code];
  return message ? new DomainError(error.code, message, error.getStatus(), error.details) : error;
}

function isReviewable(field: { kind: string }): field is ReviewableField {
  return field.kind === 'TEXT' || field.kind === 'TEXT_LIST' || field.kind === 'KNOWLEDGE';
}
