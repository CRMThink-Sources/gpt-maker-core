import { z } from 'zod';
import { functionAnswerValueSchema, functionAnswersSchema } from './agent-function-answers';
import { EXPECTATION_MAX, EXPECTATION_MIN } from './agent-knowledge-review';

/**
 * Ajuda da IA para preencher campos de texto vazios da função: contratos entre o app e o backend.
 * O resultado não é guardado; vive só na tela.
 */

const fieldId = z.string().min(1).max(200);

const aboutSchema = z
  .string()
  .trim()
  .min(EXPECTATION_MIN, `descreva em pelo menos ${EXPECTATION_MIN} caracteres`)
  .max(EXPECTATION_MAX, `use até ${EXPECTATION_MAX} caracteres`);

/** Pedir a ajuda: campos a preencher, o que o cliente conta do negócio e a mini-entrevista. */
export const assistInputSchema = z.object({
  fieldIds: z.array(fieldId).min(1).max(20),
  about: aboutSchema,
  interview: z
    .array(
      z.object({
        fieldId,
        answers: z
          .array(z.object({ question: z.string().max(200), answer: z.string().max(1000) }))
          .max(5),
      }),
    )
    .max(20),
  /** Respostas da tela (salvas ou não). */
  answers: functionAnswersSchema,
});
export type AssistInput = z.infer<typeof assistInputSchema>;

/** O que a IA devolve: `text` em campo de texto, `items` em lista, `rows` na base. O backend valida e filtra. */
export const assistModelOutputSchema = z.object({
  fields: z.array(
    z.object({
      fieldId: z.string(),
      text: z.string().optional(),
      items: z.array(z.string()).optional(),
      /** Base de conhecimento: um objeto por item, chave = id do subcampo. */
      rows: z.array(z.record(z.string(), z.string())).optional(),
    }),
  ),
});
export type AssistModelOutput = z.infer<typeof assistModelOutputSchema>;

/** Rascunho entregue ao app; `applicable: false` quando não passa nos limites do campo. */
export const assistResultSchema = z.object({
  fields: z.array(
    z.object({
      fieldId,
      value: functionAnswerValueSchema,
      applicable: z.boolean(),
      /** Quantos `[preencher: …]` o rascunho tem. */
      markers: z.number().int().nonnegative(),
    }),
  ),
  credits: z.number().int().nonnegative(),
});
export type AssistResult = z.infer<typeof assistResultSchema>;
