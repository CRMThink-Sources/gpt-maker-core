import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ConversationMessage,
  type FunctionAnswers,
  type FunctionTemplateContent,
  hallucinationModelOutputSchema,
  type HallucinationRequest,
  hallucinationRequestSchema,
  type HallucinationResult,
  validateFunctionAnswers,
  visibleFields,
} from '@gptmaker/contracts';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { enrichContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { training } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { ConversationSourceService } from './conversation-source.service';
import { FunctionTemplateReader } from './function-template.reader';
import {
  HALLUCINATION_TRAININGS_MAX,
  hallucinationMessages,
  type HallucinationBaseField,
  hasAgentReply,
  promptMessages,
  toHallucinationFindings,
} from './hallucination-prompt';
import { ReviewAiRunner } from './review-ai.runner';
import { type ReviewableField } from './review-prompt';

/** Débito da análise no razão (aparece no extrato como "Análise de alucinação"). */
export const HALLUCINATION_REF_TYPE = 'hallucination_analysis';

/**
 * Uma análise por vez por tenant: o `assertBalance` e o débito não são atômicos, então duas ao
 * mesmo tempo com saldo para uma só deixariam o saldo negativo. O TTL cobre a IA com retentativa.
 */
const RUN_LOCK_TTL_MS = 3 * 60_000;
/**
 * O `analysisId` vem do cliente. Reservado ao começar e mantido depois de concluída (a falha o
 * libera), reenviar uma análise já feita não roda a IA de novo: seria IA grátis, pois o razão só
 * ignora o segundo débito.
 */
const DONE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Análise de alucinação de uma conversa do agente (spec agent-hallucination-analysis): uma chamada
 * ao Vibecode com a base e a conversa, achados validados e sugestões aplicáveis no formulário. A
 * chave, o saldo, o débito e os limites são os da revisão por IA (`ReviewAiRunner`, design D1).
 * Nada da conversa, da base nem da nota é gravado ou logado (design D7).
 */
@Injectable()
export class HallucinationAnalysisService {
  private readonly logger = new Logger(HallucinationAnalysisService.name);
  private readonly lock: DistributedLock;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly ai: ReviewAiRunner,
    private readonly templates: FunctionTemplateReader,
    private readonly conversations: ConversationSourceService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  /** Preço por análise com a chave da CRMThink; sem preço próprio, o de um campo revisado. */
  get price(): number {
    return this.env.HALLUCINATION_CREDITS_PER_ANALYSIS ?? this.env.REVIEW_CREDITS_PER_FIELD;
  }

  async analyze(
    tenantId: string,
    agentId: string,
    raw: HallucinationRequest,
  ): Promise<HallucinationResult> {
    const input = hallucinationRequestSchema.parse(raw);
    const { content, functionName, agentName } = await this.templates.forAgent(tenantId, agentId);
    const { answers, issues } = validateFunctionAnswers(content, input.answers as FunctionAnswers, {
      partial: true,
    });
    if (issues.length) {
      throw new DomainError(
        'FUNCTION_ANSWERS_INVALID',
        'As respostas têm erros; corrija antes de analisar',
        HttpStatus.UNPROCESSABLE_ENTITY,
        issues,
      );
    }

    // A conversa é lida (e conferida como do tenant e do agente) antes de gastar IA ou crédito.
    const { messages, omitted } = await this.conversations.messages(
      tenantId,
      agentId,
      input.source,
      input.conversationId,
    );
    if (!hasAgentReply(messages)) {
      throw new DomainError(
        'HALLUCINATION_NOTHING_TO_ANALYZE',
        'Esta conversa não tem resposta do agente para analisar',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const agentReplyIds = new Set(
      messages.filter((message) => message.role === 'AGENT').map((message) => message.id),
    );
    const flagged = new Set(input.flaggedMessageIds.filter((id) => agentReplyIds.has(id)));
    if (input.flaggedMessageIds.length > 0 && flagged.size === 0) {
      throw new DomainError(
        'HALLUCINATION_FLAGGED_NOT_FOUND',
        'As respostas marcadas não estão nesta conversa',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    enrichContext({ tenantId, agentId });

    const outcome = await this.lock.runExclusive(
      `hallucination:run:${tenantId}`,
      RUN_LOCK_TTL_MS,
      () =>
        this.reserved(tenantId, input.analysisId, () =>
          this.execute({
            tenantId,
            agentId,
            input,
            content,
            functionName,
            agentName,
            answers,
            messages,
            omitted,
            flagged,
          }),
        ),
    );
    if (!outcome.ran) {
      throw new DomainError(
        'HALLUCINATION_IN_PROGRESS',
        'Já há uma análise em andamento. Aguarde terminar e tente de novo.',
        HttpStatus.CONFLICT,
      );
    }
    return outcome.result;
  }

  /**
   * Reserva o `analysisId` do tenant: análise já feita (ou em curso) é `HALLUCINATION_ALREADY_ANALYZED`.
   * Falha libera a reserva, para a tela repetir com o mesmo id; sucesso a mantém.
   */
  private async reserved<T>(
    tenantId: string,
    analysisId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = `hallucination:done:${tenantId}:${analysisId}`;
    const taken = await this.redis.set(key, '1', 'EX', DONE_TTL_SECONDS, 'NX');
    if (taken !== 'OK') {
      throw new DomainError(
        'HALLUCINATION_ALREADY_ANALYZED',
        'Esta análise já foi feita. Peça uma nova análise.',
        HttpStatus.CONFLICT,
      );
    }
    try {
      return await run();
    } catch (error) {
      await this.redis.del(key).catch(() => undefined);
      throw error;
    }
  }

  private async execute(context: {
    tenantId: string;
    agentId: string;
    input: ReturnType<typeof hallucinationRequestSchema.parse>;
    content: FunctionTemplateContent;
    functionName: string;
    agentName: string;
    answers: FunctionAnswers;
    messages: ConversationMessage[];
    omitted: number;
    flagged: ReadonlySet<string>;
  }): Promise<HallucinationResult> {
    const { tenantId, agentId, input, content, functionName, agentName, answers, messages } =
      context;
    await this.ai.tenantLimit(tenantId, `hallucination:tenant:${tenantId}`);
    const session = {
      tenantId,
      keySource: await this.ai.chooseKey(tenantId),
      purpose: 'análise de alucinação',
    };
    // Sem saldo, a IA nem é chamada (design D6).
    await this.ai.assertBalance(session, this.price);
    const apiKey = await this.ai.apiKey(session);

    const bases: HallucinationBaseField[] = visibleFields(content.fields, answers)
      .filter(isBase)
      .map((field) => ({ field, answers }));
    const conversation = promptMessages(messages, context.flagged);
    const output = await this.ai.ask(
      session,
      apiKey,
      hallucinationMessages({
        context: { agentName, functionName },
        fields: bases,
        manualTrainings: await this.manualTrainings(tenantId, agentId),
        conversation,
        ...(input.note ? { note: input.note } : {}),
      }),
      hallucinationModelOutputSchema,
    );
    const findings = toHallucinationFindings(output, conversation, bases);

    // Só depois da saída válida. A chave do razão leva o tenant: o índice único é global, e o
    // `analysisId` é escolhido pelo cliente (um UUID de outro tenant não pode colidir).
    await this.ai.charge(session, {
      key: `hallucination:${tenantId}:${input.analysisId}`,
      amount: this.price,
      refType: HALLUCINATION_REF_TYPE,
      refId: input.analysisId,
      agentId,
      label: 'analysis',
      createdBy: 'system:hallucination',
    });
    const credits = session.keySource === 'platform' ? this.price : 0;
    // Só identificadores, contagens e custo: nunca texto da conversa, da base ou da nota.
    this.logger.log(
      {
        tenantId,
        agentId,
        analysisId: input.analysisId,
        source: input.source,
        messages: messages.length,
        findings: findings.length,
        unsupported: findings.filter((entry) => entry.verdict === 'UNSUPPORTED').length,
        contradicts: findings.filter((entry) => entry.verdict === 'CONTRADICTS').length,
        keySource: session.keySource,
        credits,
      },
      'análise de alucinação concluída',
    );
    return { analysisId: input.analysisId, findings, credits, omitted: context.omitted };
  }

  /** Treinamentos de texto manuais do agente (não os gerados pela função), os mais antigos primeiro. */
  private async manualTrainings(tenantId: string, agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ content: training.content })
      .from(training)
      .where(
        and(
          eq(training.tenantId, tenantId),
          eq(training.agentId, agentId),
          eq(training.type, 'TEXT'),
          eq(training.managed, false),
          isNull(training.deletedAt),
        ),
      )
      .orderBy(asc(training.createdAt), asc(training.id))
      .limit(HALLUCINATION_TRAININGS_MAX);
    return rows.flatMap((row) => (row.content?.trim() ? [row.content] : []));
  }
}

function isBase(field: { kind: string }): field is ReviewableField {
  return field.kind === 'TEXT' || field.kind === 'TEXT_LIST' || field.kind === 'KNOWLEDGE';
}
