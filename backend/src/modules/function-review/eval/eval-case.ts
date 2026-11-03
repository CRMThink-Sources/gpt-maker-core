import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type FunctionAnswers,
  type FunctionTemplateContent,
  reviewProblemCategorySchema,
  reviewProblemSeveritySchema,
} from '@gptmaker/contracts';
import { z } from 'zod';

/**
 * Casos de avaliação da revisão por IA (spec agent-review-evaluation): formulários fictícios do
 * Suporte, com o que se espera da revisão. Rodam sob demanda, com chave real, fora do CI; o CI só
 * valida o conjunto.
 */

export const evalCaseTypeSchema = z.enum([
  'good',
  'bad',
  'contradiction',
  'duplicate',
  'injection',
]);
export type EvalCaseType = z.infer<typeof evalCaseTypeSchema>;

const expectedProblemSchema = z.object({
  fieldId: z.string().min(1),
  itemIndex: z.number().int().nonnegative(),
  /** Qualquer uma dessas categorias conta como achado. */
  categories: z.array(reviewProblemCategorySchema).min(1),
  severity: reviewProblemSeveritySchema.optional(),
  /** Outros lugares onde o mesmo achado vale (por exemplo, o outro lado de uma repetição). */
  alternatives: z
    .array(z.object({ fieldId: z.string().min(1), itemIndex: z.number().int().nonnegative() }))
    .optional(),
});
export type ExpectedProblem = z.infer<typeof expectedProblemSchema>;

export const evalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  type: evalCaseTypeSchema,
  description: z.string().min(1),
  /** Texto simples ou lista de textos; na base, uma lista de itens `{ subcampo: texto }`. */
  answers: z.record(z.string(), z.unknown()),
  expected: z.array(expectedProblemSchema),
  /** Problemas a mais que ainda são tolerados (caso bom: poucos reparos leves). */
  maxProblems: z.number().int().nonnegative().optional(),
  /** Campos que a checagem entre campos deve apontar como contraditórios. */
  crossFields: z.array(z.string()).min(2).optional(),
  forbidden: z.object({ obey: z.string().min(3) }).optional(),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export function loadCases(): EvalCase[] {
  const raw = JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8')) as unknown;
  return z.array(evalCaseSchema).parse(raw);
}

/** Itens de base ganham o `itemKey` que as respostas da função exigem (fixo, para repetir o caso). */
export function toAnswers(testCase: EvalCase): FunctionAnswers {
  return Object.fromEntries(
    Object.entries(testCase.answers).map(([fieldId, value]) => {
      if (Array.isArray(value) && value.some((item) => typeof item === 'object' && item !== null)) {
        return [
          fieldId,
          value.map((values, index) => ({
            itemKey: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            values,
          })),
        ];
      }
      return [fieldId, value];
    }),
  ) as FunctionAnswers;
}

export type EvalTemplate = Pick<FunctionTemplateContent, 'fields'> & {
  name: string;
  description: string;
};
