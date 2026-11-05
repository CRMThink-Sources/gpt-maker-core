import { z } from 'zod';

export const agentTypeSchema = z.enum(['SUPPORT', 'SALE', 'PERSONAL']);
export const communicationTypeSchema = z.enum(['FORMAL', 'NORMAL', 'RELAXED']);
export const agentStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'OUT_OF_SYNC']);

const optionalText = (max: number) => z.string().trim().max(max).optional();
const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** Limites dos textos do agente no GPTMaker. */
export const AGENT_BEHAVIOR_MAX = 3000;
export const AGENT_JOB_DESCRIPTION_MAX = 500;

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

/**
 * Dados com que o backend cria o agente no GPTMaker (design D6): vêm da compilação da função,
 * nunca do cliente. Sem `modelId`, vale o padrão do catálogo.
 */
export const agentProvisionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  avatarUrl: z.url().max(2000).optional(),
  behavior: requiredText(AGENT_BEHAVIOR_MAX),
  type: agentTypeSchema,
  communicationType: communicationTypeSchema,
  jobName: optionalText(200),
  jobSite: z.url().max(2000).optional(),
  jobDescription: optionalText(AGENT_JOB_DESCRIPTION_MAX),
  modelId: z.uuid().optional(),
  /** Settings derivados da função, aplicados junto com o modelo. */
  settings: agentSettingsSchema.optional(),
});
export type AgentProvisionInput = z.input<typeof agentProvisionSchema>;

/**
 * Novo agente (spec agent-management): nome, avatar, modelo, a função e as respostas do formulário
 * dela. Comportamento, tipo, tom e dados da empresa saem da compilação.
 */
export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  avatarUrl: z.url().max(2000).optional(),
  modelId: z.uuid().optional(),
  functionCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  /** Validadas contra a versão publicada do template (`validateFunctionAnswers`). */
  answers: z.record(z.string(), z.unknown()),
});
export type CreateAgentInput = z.input<typeof createAgentSchema>;

/** Settings que a função do agente define (formulário ou template): fora da edição direta. */
export const FUNCTION_MANAGED_SETTINGS = [
  'enabledHumanTransfer',
  'enabledEmoji',
  'limitSubjects',
  'onLackKnowLedge',
  'knowledgeByFunction',
] as const;

/** Settings operacionais, editáveis direto na tela do agente. */
export const operationalSettingsSchema = agentSettingsSchema
  .omit({
    enabledHumanTransfer: true,
    enabledEmoji: true,
    limitSubjects: true,
    onLackKnowLedge: true,
    knowledgeByFunction: true,
  })
  .strict();

/**
 * Edição parcial de nome, avatar (`null` remove), modelo e settings operacionais. O resto vem da
 * publicação da função (spec agent-management, "Campo gerenciado pela função").
 */
export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    avatarUrl: z.url().max(2000).nullable(),
    modelId: z.uuid(),
    settings: operationalSettingsSchema,
  })
  .partial()
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'informe ao menos um campo',
  });
export type UpdateAgentInput = z.input<typeof updateAgentSchema>;

/** Modelo que o tenant pode escolher para o agente (`GET /app/models`). */
export interface AvailableModel {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  creditsPerResponse: number;
  isDefault: boolean;
}

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
