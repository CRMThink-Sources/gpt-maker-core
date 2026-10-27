import { z } from 'zod';

// Contrato em docs/gptmaker-api.md (OpenAPI oficial). O OpenAPI quase não marca campos como
// obrigatórios, então as respostas são lidas de forma tolerante: campos opcionais e campos
// extras preservados (`loose`), para uma mudança do provedor não derrubar o fluxo.

export const agentTypeSchema = z.enum(['SUPPORT', 'SALE', 'PERSONAL']);
export const communicationTypeSchema = z.enum(['FORMAL', 'NORMAL', 'RELAXED']);

export const successSchema = z.object({ success: z.boolean() }).loose();

// ---- Workspace

export const workspaceSchema = z.object({ id: z.string(), name: z.string().optional() }).loose();
export type GptMakerWorkspace = z.infer<typeof workspaceSchema>;

export const workspaceStatusSchema = z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED']);
export type GptMakerWorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

export const workspaceCreditsSchema = z
  .object({ credits: z.number().int(), status: workspaceStatusSchema })
  .loose();
export type GptMakerWorkspaceCredits = z.infer<typeof workspaceCreditsSchema>;

// ---- Agente (`Assistant` / `NewAssistant`)

export const assistantSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    /** Fora do OpenAPI, observado na API real (ver `GPTMAKER_AGENT_STATUS`). String: valor novo não quebra a leitura. */
    status: z.string().nullish(),
    behavior: z.string().nullish(),
    avatar: z.string().nullish(),
    communicationType: z.string().nullish(),
    type: z.string().nullish(),
    jobName: z.string().nullish(),
    jobSite: z.string().nullish(),
    jobDescription: z.string().nullish(),
  })
  .loose();
export type GptMakerAgent = z.infer<typeof assistantSchema>;

/**
 * A documentação promete um array puro em `GET /workspace/{id}/agents`, mas a API real responde
 * `{ data: Assistant[], count }`. Aceita os dois formatos e devolve sempre o array.
 */
export const assistantListSchema = z.union([
  assistantSchema.array(),
  z
    .object({ data: assistantSchema.array() })
    .loose()
    .transform((body) => body.data),
]);

/** Valores de `status` do agente observados na API real, mapeados para o status local. */
export const GPTMAKER_AGENT_STATUS = { ACTIVE: 'ACTIVE', DISABLED: 'INACTIVE' } as const;

export const newAssistantSchema = z.object({
  name: z.string().min(1),
  avatar: z.string().optional(),
  behavior: z.string().optional(),
  communicationType: communicationTypeSchema,
  type: agentTypeSchema,
  jobName: z.string().optional(),
  jobSite: z.string().optional(),
  jobDescription: z.string().optional(),
});
export type GptMakerNewAgent = z.infer<typeof newAssistantSchema>;

// ---- Settings

/** `prefferModel` (grafia oficial). Lista do provedor muda com frequência: string, validada pelo catálogo. */
export const agentSettingsSchema = z
  .object({
    prefferModel: z.string().nullish(),
    timezone: z.string().nullish(),
    enabledHumanTransfer: z.boolean().nullish(),
    enabledReminder: z.boolean().nullish(),
    splitMessages: z.boolean().nullish(),
    enabledEmoji: z.boolean().nullish(),
    limitSubjects: z.boolean().nullish(),
    messageGroupingTime: z.string().nullish(),
    maxDailyMessages: z.number().int().nullish(),
    maxDailyMessagesLimitAction: z.string().nullish(),
    knowledgeByFunction: z.boolean().nullish(),
    onLackKnowLedge: z.string().nullish(),
  })
  .loose();
export type GptMakerAgentSettings = z.infer<typeof agentSettingsSchema>;

export const messageGroupingTimeSchema = z.enum([
  'NO_GROUP',
  'FIVE_SEC',
  'TEN_SEC',
  'THIRD_SEC',
  'ONE_MINUTE',
]);

export const updateAgentSettingsSchema = z
  .object({
    prefferModel: z.string().min(1),
    timezone: z.string(),
    enabledHumanTransfer: z.boolean(),
    enabledReminder: z.boolean(),
    splitMessages: z.boolean(),
    enabledEmoji: z.boolean(),
    limitSubjects: z.boolean(),
    messageGroupingTime: messageGroupingTimeSchema,
    signMessages: z.boolean(),
    /** Valores aceitos pelo provedor: null (sem limite), 20, 50, 100, 200, 500, 1000. */
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
    onLackKnowLedge: z.string(),
  })
  .partial();
export type GptMakerUpdateAgentSettings = z.infer<typeof updateAgentSettingsSchema>;

// ---- Treinamentos

export const trainingTypeSchema = z.enum(['TEXT', 'WEBSITE', 'VIDEO', 'DOCUMENT']);
export type GptMakerTrainingType = z.infer<typeof trainingTypeSchema>;

export const trainingIntervalSchema = z.enum([
  'THIRTY_SECONDS',
  'NEVER',
  'ONE_HOUR',
  'FOUR_HOUR',
  'EIGHT_HOUR',
  'TWELVE_HOUR',
  'ONE_DAY',
  'ONE_WEEK',
  'ONE_MONTH',
]);

export const trainingSchema = z
  .object({
    id: z.string(),
    type: trainingTypeSchema,
    text: z.string().nullish(),
    image: z.string().nullish(),
    website: z.string().nullish(),
    trainingSubPages: z.string().nullish(),
    trainingInterval: z.string().nullish(),
    video: z.string().nullish(),
    documentUrl: z.string().nullish(),
    documentName: z.string().nullish(),
    documentMimetype: z.string().nullish(),
  })
  .loose();
export type GptMakerTraining = z.infer<typeof trainingSchema>;

/** Lista no envelope `{ data, count }` (o OpenAPI promete array); aceita os dois. */
export const trainingListSchema = z.union([
  trainingSchema.array(),
  z
    .object({ data: trainingSchema.array() })
    .loose()
    .transform((body) => body.data),
]);

const callbackUrl = z.url().optional();

export const createTrainingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TEXT'),
    text: z.string().min(1),
    image: z.url().optional(),
    callbackUrl,
  }),
  z.object({
    type: z.literal('WEBSITE'),
    website: z.url(),
    trainingSubPages: z.enum(['DISABLED', 'ACTIVE']),
    trainingInterval: trainingIntervalSchema,
    callbackUrl,
  }),
  z.object({ type: z.literal('VIDEO'), video: z.url(), callbackUrl }),
  z.object({
    type: z.literal('DOCUMENT'),
    documentUrl: z.url(),
    documentName: z.string().min(1),
    documentMimetype: z.string().min(1),
    callbackUrl,
  }),
]);
export type GptMakerCreateTraining = z.infer<typeof createTrainingSchema>;

export const updateTextTrainingSchema = z.object({
  text: z.string().min(1),
  image: z.url().optional(),
});
export type GptMakerUpdateTextTraining = z.infer<typeof updateTextTrainingSchema>;

// ---- Intenções (docs/gptmaker-api.md §10; campos fora do OpenAPI observados na API real)

export const intentionFieldSchema = z
  .object({
    name: z.string(),
    jsonName: z.string(),
    description: z.string().nullish(),
    type: z.string(),
    required: z.boolean().nullish(),
  })
  .loose();

const namedValueSchema = z.object({ name: z.string(), value: z.string().nullish() }).loose();

export const intentionSchema = z
  .object({
    id: z.string(),
    /** Nome curto da intenção. */
    description: z.string().nullish(),
    /** Quando usar. */
    details: z.string().nullish(),
    /** Instrução de resposta (com `manualOutput`). */
    instructions: z.string().nullish(),
    manualOutput: z.boolean().nullish(),
    type: z.string().nullish(),
    httpMethod: z.string().nullish(),
    url: z.string().nullish(),
    requestBody: z.string().nullish(),
    autoGenerateParams: z.boolean().nullish(),
    autoGenerateBody: z.boolean().nullish(),
    fields: z.array(intentionFieldSchema).nullish(),
    headers: z.array(namedValueSchema).nullish(),
    params: z.array(namedValueSchema).nullish(),
    active: z.boolean().nullish(),
  })
  .loose();
export type GptMakerIntention = z.infer<typeof intentionSchema>;

/** Lista no envelope `{ data, count }` (o OpenAPI promete array); aceita os dois. */
export const intentionListSchema = z.union([
  intentionSchema.array(),
  z
    .object({ data: intentionSchema.array() })
    .loose()
    .transform((body) => body.data),
]);

/** Corpo de criação e atualização (`type` sempre `WEBHOOK` na etapa 1). */
export const writeIntentionSchema = z.object({
  description: z.string().min(1),
  details: z.string(),
  instructions: z.string().optional(),
  manualOutput: z.boolean(),
  type: z.literal('WEBHOOK'),
  httpMethod: z.enum(['GET', 'POST']),
  url: z.string().min(1),
  fields: z.array(
    z.object({
      name: z.string(),
      jsonName: z.string(),
      description: z.string(),
      type: z.enum(['STRING', 'URL', 'DATE_TIME', 'DATE', 'NUMBER', 'BOOLEAN']),
      required: z.boolean(),
    }),
  ),
  headers: z.array(z.object({ name: z.string(), value: z.string() })),
  params: z.array(z.object({ name: z.string(), value: z.string() })),
  requestBody: z.string().optional(),
  autoGenerateParams: z.boolean(),
  autoGenerateBody: z.boolean(),
  preprocessingMessage: z.literal('DISABLED'),
  active: z.boolean(),
});
export type GptMakerWriteIntention = z.infer<typeof writeIntentionSchema>;

/**
 * Resposta de criar/atualizar intenção. Em 2026-10-04 a API passou a responder `{ id, tenant }`
 * na criação e `{ tenant }` na atualização (antes `{ success }`); aceita as duas formas.
 */
export const intentionWriteAckSchema = z
  .object({ id: z.string().optional(), success: z.boolean().optional() })
  .loose();

// ---- MCP (docs/gptmaker-mcp.md)

/** Corpo de `POST /agent/{agentId}/mcp/add`. */
export const mcpAddSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  mcpUrl: z.string().min(1),
  urlType: z.enum(['SSE', 'STREAMABLEHTTP']),
  authType: z.enum(['NO_OAUTH', 'OAUTH', 'HEADERS']),
  headers: z.record(z.string(), z.string()).optional(),
});
export type GptMakerMcpAdd = z.infer<typeof mcpAddSchema>;

/** Resposta de `mcp/add`: `id` da conexão; `url` só no fluxo OAuth. */
export const mcpAddAckSchema = z
  .object({
    id: z.string().nullish(),
    success: z.boolean().nullish(),
    connected: z.boolean().nullish(),
    url: z.string().nullish(),
  })
  .loose();

export const mcpToolSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    description: z.string().nullish(),
    active: z.boolean().nullish(),
  })
  .loose();
export type GptMakerMcpTool = z.infer<typeof mcpToolSchema>;

/** Lista de ferramentas; aceita também o envelope `{ data }` usado nas outras listagens reais. */
export const mcpToolListSchema = z.union([
  mcpToolSchema.array(),
  z
    .object({ data: mcpToolSchema.array() })
    .loose()
    .transform((body) => body.data),
]);

// ---- Webhooks

export const WEBHOOK_EVENTS = [
  'onNewMessage',
  'onLackKnowLedge',
  'onTransfer',
  'onFirstInteraction',
  'onStartInteraction',
  'onFinishInteraction',
  'onCreateEvent',
  'onCancelEvent',
] as const;
export type GptMakerWebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhooksSchema = z
  .object(Object.fromEntries(WEBHOOK_EVENTS.map((event) => [event, z.string().nullish()])))
  .loose() as z.ZodType<Partial<Record<GptMakerWebhookEvent, string | null>>>;
export type GptMakerWebhooks = Partial<Record<GptMakerWebhookEvent, string>>;

// ---- Conversa

const conversationBase = {
  contextId: z.string().min(1),
  callbackUrl: z.url().optional(),
  onFinishCallback: z.url().optional(),
  chatName: z.string().optional(),
  chatPicture: z.string().optional(),
  phone: z.string().optional(),
};

/** Variantes do corpo de `/conversation`: texto, imagem, áudio, vídeo e documento. */
export const conversationRequestSchema = z.union([
  // O OpenAPI exige `prompt` na imagem, mas a API aceita sem (testado em 2026-10-01).
  z.object({ ...conversationBase, image: z.url(), prompt: z.string().optional() }),
  z.object({ ...conversationBase, audio: z.url() }),
  z.object({ ...conversationBase, video: z.url(), prompt: z.string().optional() }),
  z.object({ ...conversationBase, document: z.url(), prompt: z.string().optional() }),
  z.object({ ...conversationBase, prompt: z.string().min(1) }),
]);
export type GptMakerConversationRequest = z.infer<typeof conversationRequestSchema>;

export const conversationResponseSchema = z
  .object({
    message: z.string().nullish(),
    images: z.array(z.string()).nullish(),
    audios: z.array(z.string()).nullish(),
    documents: z.array(z.string()).nullish(),
  })
  .loose();
export type GptMakerConversationResponse = z.infer<typeof conversationResponseSchema>;

// ---- Consumo

export const creditsSpentSchema = z
  .object({
    total: z.number().int(),
    data: z
      .array(
        z
          .object({
            credits: z.number().int(),
            year: z.number().int(),
            month: z.number().int(),
            day: z.number().int(),
            model: z.string(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();
export type GptMakerCreditsSpent = z.infer<typeof creditsSpentSchema>;

export const errorBodySchema = z.object({ error: z.string() }).loose();

// ---- Modelos

/**
 * Valores de `prefferModel` conhecidos (docs/gptmaker-api.md §3). A lista do provedor muda com
 * frequência: o catálogo aceita código fora dela mediante confirmação do operador.
 */
export const GPTMAKER_KNOWN_MODELS: readonly string[] = [
  'GPT_5_6_SOL',
  'GPT_5_6_TERRA',
  'GPT_5_6_LUNA',
  'GPT_5_5',
  'GPT_5_4',
  'GPT_5_4_MINI',
  'GPT_5_2',
  'GPT_5_1',
  'GPT_5',
  'GPT_5_MINI',
  'GPT_4_1',
  'GPT_4_1_MINI',
  'OPEN_AI_O4_MINI',
  'OPEN_AI_O3',
  'OPEN_AI_O3_MINI',
  'OPEN_AI_O1',
  'GPT_4_O',
  'GPT_4_O_MINI',
  'GPT_4',
  'CLAUDE_5_SONNET',
  'CLAUDE_4_6_SONNET',
  'CLAUDE_4_5_SONNET',
  'CLAUDE_4_5_HAIKU',
  'CLAUDE_3_7_SONNET',
  'CLAUDE_3_5_SONNET',
  'CLAUDE_3_5_HAIKU',
  'DEEPINFRA_LLAMA3_3',
  'QWEN_2_5_MAX',
  'DEEPSEEK_V4_PRO',
  'DEEPSEEK_V4_FLASH',
  'DEEPSEEK_CHAT',
  'SABIA_3_1',
  'SABIA_3',
];
