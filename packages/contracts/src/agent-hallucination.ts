import { z } from 'zod';
import { conversationSourceSchema } from './agent-conversations';
import { functionAnswersSchema } from './agent-function-answers';
import { reviewGapReasonSchema } from './agent-knowledge-review';
import { TRAINING_TEXT_MAX } from './trainings';

/**
 * Análise de alucinação (spec agent-hallucination-analysis): contratos entre o app e o backend.
 * O resultado não é guardado; vive só na tela, como o da revisão por IA.
 */

export const HALLUCINATION_NOTE_MAX = 500;
export const HALLUCINATION_MAX_FLAGGED = 50;

const fieldId = z.string().min(1).max(200);
const itemValues = z.record(z.string(), z.string().trim().max(TRAINING_TEXT_MAX));

/** Pedido: a conversa, as marcações, a nota do cliente e as respostas da tela (salvas ou não). */
export const hallucinationRequestSchema = z.object({
  /** UUID gerado na tela: chave de idempotência do débito (a retentativa não cobra de novo). */
  analysisId: z.uuid(),
  source: conversationSourceSchema,
  conversationId: z.string().min(1).max(300),
  /** Respostas do agente marcadas como suspeitas; vazio analisa todas. */
  flaggedMessageIds: z.array(z.string().min(1).max(300)).max(HALLUCINATION_MAX_FLAGGED).default([]),
  note: z.string().trim().max(HALLUCINATION_NOTE_MAX).optional(),
  answers: functionAnswersSchema,
});
export type HallucinationRequest = z.input<typeof hallucinationRequestSchema>;

export const hallucinationVerdictSchema = z.enum(['SUPPORTED', 'UNSUPPORTED', 'CONTRADICTS']);
export type HallucinationVerdict = z.infer<typeof hallucinationVerdictSchema>;

export const hallucinationCauseSchema = z.enum([
  'MISSING_IN_BASE',
  'CONFLICTING_BASE',
  'PERMISSIVE_BEHAVIOR',
  'MODEL_EXTRAPOLATION',
]);
export type HallucinationCause = z.infer<typeof hallucinationCauseSchema>;

/**
 * O que a IA devolve (validado no backend, com uma nova tentativa se vier fora do formato).
 * `messageRef` é a referência curta da mensagem no prompt (`m1`, `m2`…), nunca o id real.
 */
export const hallucinationModelOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        messageRef: z.string().trim().min(1).max(20),
        claim: z.string().trim().min(1).max(300),
        verdict: hallucinationVerdictSchema,
        reason: z.string().trim().min(1).max(400),
        cause: hallucinationCauseSchema.optional(),
        source: z.object({ fieldId, index: z.number().int().nonnegative().optional() }).optional(),
        suggestion: z
          .discriminatedUnion('kind', [
            z.object({ kind: z.literal('ADD_ITEM'), fieldId, item: itemValues }),
            z.object({
              kind: z.literal('REPLACE_TEXT'),
              fieldId,
              index: z.number().int().nonnegative(),
              values: itemValues,
            }),
          ])
          .optional(),
      }),
    )
    .max(50)
    .default([]),
});
export type HallucinationModelOutput = z.infer<typeof hallucinationModelOutputSchema>;

/** Por que uma sugestão fica só para leitura (sem "Aplicar"). */
export const hallucinationSuggestionReasonSchema = reviewGapReasonSchema;

export const hallucinationSuggestionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ADD_ITEM'),
    fieldId,
    /** Rascunho: subcampo → texto, podendo conter `[preencher: …]`. */
    item: z.record(z.string(), z.string().max(TRAINING_TEXT_MAX)),
    applicable: z.boolean(),
    reason: hallucinationSuggestionReasonSchema.optional(),
  }),
  z.object({
    kind: z.literal('REPLACE_TEXT'),
    fieldId,
    /** Posição do item na resposta do cliente (a mesma da revisão). */
    index: z.number().int().nonnegative(),
    values: z.record(z.string(), z.string().max(TRAINING_TEXT_MAX)),
    applicable: z.boolean(),
    reason: hallucinationSuggestionReasonSchema.optional(),
  }),
]);
export type HallucinationSuggestion = z.infer<typeof hallucinationSuggestionSchema>;

export const hallucinationFindingSchema = z.object({
  /** Id real da mensagem (não a referência do prompt). */
  messageId: z.string(),
  claim: z.string().max(300),
  verdict: hallucinationVerdictSchema,
  reason: z.string().max(400),
  cause: hallucinationCauseSchema.nullable(),
  /** Onde a base é a origem provável, quando a IA apontou e o campo/item existe. */
  source: z.object({ fieldId, label: z.string(), index: z.number().int().nullable() }).nullable(),
  suggestion: hallucinationSuggestionSchema.nullable(),
});
export type HallucinationFinding = z.infer<typeof hallucinationFindingSchema>;

export const hallucinationResultSchema = z.object({
  analysisId: z.uuid(),
  findings: z.array(hallucinationFindingSchema).max(50),
  /** Créditos debitados (0 com a chave do cliente). */
  credits: z.number().int().nonnegative(),
  /** Mensagens anteriores que ficaram de fora da análise (conversa longa). */
  omitted: z.number().int().nonnegative(),
});
export type HallucinationResult = z.infer<typeof hallucinationResultSchema>;
