import { z } from 'zod';

export const agentTypeSchema = z.enum(['SUPPORT', 'SALE', 'PERSONAL']);
export const communicationTypeSchema = z.enum(['FORMAL', 'NORMAL', 'RELAXED']);
export const agentStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'OUT_OF_SYNC']);

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Formulário de novo agente (spec agent-management). Sem `modelId`, vale o padrão do catálogo. */
export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  avatarUrl: z.url().max(2000).optional(),
  behavior: optionalText(10_000),
  type: agentTypeSchema,
  communicationType: communicationTypeSchema,
  jobName: optionalText(200),
  jobSite: z.url().max(2000).optional(),
  jobDescription: optionalText(5000),
  modelId: z.uuid().optional(),
});
export type CreateAgentInput = z.input<typeof createAgentSchema>;

/**
 * Settings do agente editáveis pelo tenant (`PUT /agents/{id}/settings` do GPTMaker, sem o
 * `prefferModel`, que vem do modelo escolhido). Campos omitidos mantêm o valor atual.
 */
export const agentSettingsSchema = z
  .object({
    timezone: z.string().trim().min(1).max(64),
    enabledHumanTransfer: z.boolean(),
    enabledReminder: z.boolean(),
    splitMessages: z.boolean(),
    enabledEmoji: z.boolean(),
    limitSubjects: z.boolean(),
    messageGroupingTime: z.enum(['NO_GROUP', 'FIVE_SEC', 'TEN_SEC', 'THIRD_SEC', 'ONE_MINUTE']),
    signMessages: z.boolean(),
    /** Valores aceitos pelo GPTMaker; `null` = sem limite. */
    maxDailyMessages: z.union([
      z.null(),
      z.literal(20),
      z.literal(50),
      z.literal(100),
      z.literal(200),
      z.literal(500),
      z.literal(1000),
    ]),
    maxDailyMessagesLimitAction: z.enum([
      'TEMP_BLOCK_30S',
      'TEMP_BLOCK_5M',
      'TEMP_BLOCK_10M',
      'TEMP_BLOCK_30M',
      'TEMP_BLOCK_1H',
      'BLOCK',
      'TRANSFER',
    ]),
    knowledgeByFunction: z.boolean(),
    onLackKnowLedge: z.string().trim().max(2000),
  })
  .partial();
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

const clearableText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Edição parcial: campo omitido mantém o valor; `null` limpa os textos opcionais. */
export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    avatarUrl: z.url().max(2000).nullable(),
    behavior: clearableText(10_000),
    type: agentTypeSchema,
    communicationType: communicationTypeSchema,
    jobName: clearableText(200),
    jobSite: z.url().max(2000).nullable(),
    jobDescription: clearableText(5000),
    modelId: z.uuid(),
    settings: agentSettingsSchema,
  })
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'informe ao menos um campo',
  });
export type UpdateAgentInput = z.input<typeof updateAgentSchema>;

/** Agente como o frontend o vê: nome sem o prefixo do tenant e sem ids do GPTMaker. */
export interface AgentView {
  id: string;
  name: string;
  avatarUrl: string | null;
  behavior: string | null;
  type: z.infer<typeof agentTypeSchema>;
  communicationType: z.infer<typeof communicationTypeSchema>;
  jobName: string | null;
  jobSite: string | null;
  jobDescription: string | null;
  model: { id: string; code: string; displayName: string; creditsPerResponse: number };
  settings: AgentSettings;
  status: z.infer<typeof agentStatusSchema>;
  inactiveReason: string | null;
  createdAt: string;
  updatedAt: string;
}
