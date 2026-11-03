import { z } from 'zod';
import {
  type FunctionAnswers,
  functionAnswersSchema,
  visibleFields,
} from './agent-function-answers';
import type { FunctionField, FunctionTemplateContent } from './agent-functions';
import { TRAINING_TEXT_MAX } from './trainings';

/**
 * Revisão por IA das respostas da função (spec agent-knowledge-review): contratos entre o app e o
 * backend. O resultado não é guardado; vive só na tela.
 */

/** Chave da sugestão num campo de texto simples (texto e item de lista); na base é o id do subcampo. */
export const REVIEW_TEXT_KEY = 'text';

/** De quem é a chave usada na revisão: do cliente (sem créditos) ou da CRMThink (cobra créditos). */
export const reviewKeySourceSchema = z.enum(['tenant', 'platform']);
export type ReviewKeySource = z.infer<typeof reviewKeySourceSchema>;

/** Códigos de erro da revisão; o app traduz cada um na mensagem do spec. */
export const reviewErrorCodeSchema = z.enum([
  'AI_KEY_REQUIRED',
  'AI_KEY_INVALID',
  'AI_KEY_SCOPE',
  'AI_NO_BALANCE',
  'AI_MODEL_UNAVAILABLE',
  'AI_UNAVAILABLE',
  'AI_BUSY',
  'AI_FIELD_TOO_LARGE',
  'AI_BAD_OUTPUT',
  'NO_CREDIT',
]);
export type ReviewErrorCode = z.infer<typeof reviewErrorCodeSchema>;

const fieldId = z.string().min(1).max(200);
const summary = z.string().trim().max(500);

/** Campos que a revisão lê: texto, lista de textos e base, com alguma resposta. */
export function reviewableFields(
  content: Pick<FunctionTemplateContent, 'fields'>,
  answers: FunctionAnswers,
): FunctionField[] {
  return visibleFields(content.fields, answers).filter((field) => {
    const value = answers[field.id];
    switch (field.kind) {
      case 'TEXT':
        return typeof value === 'string' && value.trim() !== '';
      case 'TEXT_LIST':
        return (
          Array.isArray(value) &&
          value.some((item) => typeof item === 'string' && item.trim() !== '')
        );
      case 'KNOWLEDGE':
        return (
          Array.isArray(value) &&
          value.some(
            (item) =>
              typeof item === 'object' &&
              item !== null &&
              'values' in item &&
              Object.values(item.values).some((text) => typeof text === 'string' && text.trim()),
          )
        );
      default:
        return false;
    }
  });
}

/** Criar a revisão: os campos que o cliente quer revisar. */
export const createReviewInputSchema = z.object({
  fieldIds: z.array(fieldId).min(1).max(60),
  /** Haverá análise de cobertura: a sessão guarda todos os campos de base, inclusive os vazios. */
  withGaps: z.boolean().optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewInputSchema>;

export const createReviewResultSchema = z.object({
  reviewId: z.uuid(),
  keySource: reviewKeySourceSchema,
  /** Preço por campo com a chave da CRMThink; com a do cliente nada é cobrado. */
  creditsPerField: z.number().int().nonnegative(),
});
export type CreateReviewResult = z.infer<typeof createReviewResultSchema>;

/** Revisar um campo: as respostas que estão na tela (salvas ou não). */
export const reviewFieldInputSchema = z.object({
  fieldId,
  answers: functionAnswersSchema,
});
export type ReviewFieldInput = z.infer<typeof reviewFieldInputSchema>;

const problemSchema = z.object({
  code: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(300),
});

/**
 * O que a IA devolve por campo (validado no backend, com uma nova tentativa se vier fora do
 * formato). `suggestion` troca o texto: por subcampo na base, `text` nos demais.
 */
export const reviewModelFieldOutputSchema = z.object({
  summary,
  items: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        problems: z.array(problemSchema).max(10).default([]),
        suggestion: z.record(z.string(), z.string().trim().max(TRAINING_TEXT_MAX)).optional(),
      }),
    )
    .max(50),
});
export type ReviewModelFieldOutput = z.infer<typeof reviewModelFieldOutputSchema>;

/** Sugestão entregue ao app; `applicable: false` quando não passa nos limites do campo. */
export const reviewSuggestionSchema = z.object({
  values: z.record(z.string(), z.string().max(TRAINING_TEXT_MAX)),
  applicable: z.boolean(),
});
export type ReviewSuggestion = z.infer<typeof reviewSuggestionSchema>;

export const reviewFieldResultSchema = z.object({
  fieldId,
  summary,
  items: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        problems: z.array(problemSchema).max(10),
        suggestion: reviewSuggestionSchema.optional(),
      }),
    )
    .max(50),
});
export type ReviewFieldResult = z.infer<typeof reviewFieldResultSchema>;

/** Contradições entre campos: a chamada final recebe só o resumo de cada campo. */
export const reviewCrossInputSchema = z.object({
  summaries: z.array(z.object({ fieldId, summary })).min(2).max(60),
});
export type ReviewCrossInput = z.infer<typeof reviewCrossInputSchema>;

export const reviewContradictionSchema = z.object({
  fields: z.array(fieldId).min(1).max(10),
  text: z.string().trim().min(1).max(400),
});

export const reviewCrossResultSchema = z.object({
  contradictions: z.array(reviewContradictionSchema).max(20),
});
export type ReviewCrossResult = z.infer<typeof reviewCrossResultSchema>;

/** Chave `vibe_api_…` do cliente; só entra na hora de salvar e nunca volta. */
export const aiKeyInputSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .startsWith('vibe_api_', 'a chave começa com vibe_api_')
    .max(300, 'chave grande demais'),
});
export type AiKeyInput = z.infer<typeof aiKeyInputSchema>;

/** O que a tela vê da chave: nunca o valor dela. */
export const aiKeyViewSchema = z.object({
  configured: z.boolean(),
  last4: z.string().length(4).nullable(),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Preço por campo com a chave da CRMThink. */
  creditsPerField: z.number().int().nonnegative(),
  /** Há chave da CRMThink configurada: quem não tem chave própria ainda revisa. */
  platformAvailable: z.boolean(),
});
export type AiKeyView = z.infer<typeof aiKeyViewSchema>;

/**
 * Cobertura da base (spec agent-knowledge-gaps): a expectativa do cliente contra o que a base
 * cobre. A expectativa vive só na tela; o backend a usa na hora e não a guarda.
 */
export const EXPECTATION_MIN = 20;
export const EXPECTATION_MAX = 1000;

/** Campo reservado e chave de cobrança da análise de cobertura (não é id de campo de template). */
export const GAPS_FIELD_ID = '__gaps__';

export const reviewGapsInputSchema = z.object({
  expectation: z
    .string()
    .trim()
    .min(EXPECTATION_MIN, `descreva em pelo menos ${EXPECTATION_MIN} caracteres`)
    .max(EXPECTATION_MAX, `use até ${EXPECTATION_MAX} caracteres`),
  /** Respostas da tela (salvas ou não), para o backend conhecer os itens que a base já tem. */
  answers: functionAnswersSchema,
  /** Resumos dos campos já revisados; pode ser vazio (base ainda vazia). */
  summaries: z.array(z.object({ fieldId, summary })).max(60),
});
export type ReviewGapsInput = z.infer<typeof reviewGapsInputSchema>;

/** O que a IA devolve na cobertura; o backend valida e filtra antes de entregar. */
export const reviewGapsModelOutputSchema = z.object({
  gaps: z
    .array(
      z.object({
        fieldId,
        title: z.string().trim().min(1).max(120),
        why: z.string().trim().min(1).max(300),
        item: z.record(z.string(), z.string().trim().max(TRAINING_TEXT_MAX)),
      }),
    )
    .max(15)
    .default([]),
  covered: z
    .array(z.object({ text: z.string().trim().min(1).max(300) }))
    .max(10)
    .default([]),
});
export type ReviewGapsModelOutput = z.infer<typeof reviewGapsModelOutputSchema>;

/** Por que uma lacuna não tem "Adicionar": campo cheio, subcampo acima do limite ou obrigatório vazio. */
export const reviewGapReasonSchema = z.enum(['FULL', 'LIMIT', 'REQUIRED']);
export type ReviewGapReason = z.infer<typeof reviewGapReasonSchema>;

export const reviewGapSchema = z.object({
  fieldId,
  title: z.string().max(120),
  why: z.string().max(300),
  /** Rascunho do item: subcampo → texto, podendo conter `[preencher: …]`. */
  item: z.record(z.string(), z.string().max(TRAINING_TEXT_MAX)),
  applicable: z.boolean(),
  reason: reviewGapReasonSchema.optional(),
});
export type ReviewGap = z.infer<typeof reviewGapSchema>;

export const reviewGapsResultSchema = z.object({
  gaps: z.array(reviewGapSchema).max(15),
  covered: z.array(z.object({ text: z.string().max(300) })).max(10),
});
export type ReviewGapsResult = z.infer<typeof reviewGapsResultSchema>;
