import { z } from 'zod';

/** Código do modelo no GPTMaker (valor de `prefferModel`), ex.: `GPT_5_MINI`. */
export const modelCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_]{2,64}$/, 'use letras maiúsculas, números e _ (ex.: GPT_5_MINI)');

const creditsPerResponseSchema = z.number().int().positive();

export const createModelSchema = z.object({
  code: modelCodeSchema,
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullish(),
  creditsPerResponse: creditsPerResponseSchema,
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  /** Confirma um código fora da lista conhecida do GPTMaker (modelo novo do provedor). */
  confirmUnknownCode: z.boolean().default(false),
});
export type CreateModelInput = z.input<typeof createModelSchema>;

/** O código não muda depois de criado: os agentes e o ledger o referenciam. */
export const updateModelSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable(),
    creditsPerResponse: creditsPerResponseSchema,
  })
  .partial();
export type UpdateModelInput = z.input<typeof updateModelSchema>;

export const removeModelSchema = z.object({
  /** Modelo ativo que passa a atender os agentes do modelo removido. */
  replacementModelId: z.uuid().optional(),
});
export type RemoveModelInput = z.input<typeof removeModelSchema>;

export const planAllowedModelsSchema = z.object({
  modelIds: z.array(z.uuid()).max(100),
});
export type PlanAllowedModelsInput = z.input<typeof planAllowedModelsSchema>;
