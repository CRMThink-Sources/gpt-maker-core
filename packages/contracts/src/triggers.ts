import { z } from 'zod';
import { templateErrors } from './templates';

/** Eventos do agente no GPTMaker que disparam gatilhos (grafia oficial, `onLackKnowLedge`). */
export const agentEventSchema = z.enum([
  'onNewMessage',
  'onLackKnowLedge',
  'onTransfer',
  'onFirstInteraction',
  'onStartInteraction',
  'onFinishInteraction',
  'onCreateEvent',
  'onCancelEvent',
]);
export type AgentEventName = z.infer<typeof agentEventSchema>;

export const triggerActionTypeSchema = z.enum([
  'CREATE_LEAD',
  'UPSERT_DEAL',
  'TIMELINE_COMMENT',
  'CREATE_TASK',
  'START_BIZPROC',
  'OUTBOUND_WEBHOOK',
]);
export type TriggerActionType = z.infer<typeof triggerActionTypeSchema>;

/** Máximo de ações por gatilho e de gatilhos por agente (não removidos). */
export const TRIGGER_MAX_ACTIONS = 10;
export const TRIGGER_MAX_PER_AGENT = 50;

/** Texto que pode levar variáveis do evento (`{{contact.name}}`, ver `templates.ts`). */
const template = z
  .string()
  .trim()
  .min(1)
  .max(5_000)
  .superRefine((value, ctx) => {
    for (const message of templateErrors(value)) ctx.addIssue({ code: 'custom', message });
  });
/** Campos do Bitrix (ex.: `TITLE`, `NAME`, `PHONE`) ⇒ template do valor. */
const fieldMap = z
  .record(z.string().trim().min(1).max(100), template)
  .refine((fields) => Object.keys(fields).length <= 50, 'no máximo 50 campos');
const positiveId = z.number().int().positive();

/** Configuração por tipo de ação; o `id` mantém a ação existente na edição (e o segredo dela). */
export const triggerActionInputSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.uuid().optional(),
    type: z.literal('CREATE_LEAD'),
    config: z.object({ fields: fieldMap.refine((f) => 'TITLE' in f, 'informe o campo TITLE') }),
  }),
  z.object({
    id: z.uuid().optional(),
    type: z.literal('UPSERT_DEAL'),
    config: z.object({
      /** Funil (`CATEGORY_ID`; 0 = funil geral). */
      categoryId: z.number().int().nonnegative(),
      /** Etapa (`STAGE_ID`, ex.: `NEW` ou `C3:NEW`). */
      stageId: z.string().trim().min(1).max(50),
      fields: fieldMap,
    }),
  }),
  z.object({
    id: z.uuid().optional(),
    type: z.literal('TIMELINE_COMMENT'),
    /** Comentário na entidade do CRM vinculada ao diálogo. */
    config: z.object({ text: template }),
  }),
  z.object({
    id: z.uuid().optional(),
    type: z.literal('CREATE_TASK'),
    config: z.object({
      title: template,
      description: template.optional(),
      responsibleId: positiveId,
      /** Prazo em dias a partir da execução. */
      deadlineDays: z.number().int().min(0).max(365).optional(),
    }),
  }),
  z.object({
    id: z.uuid().optional(),
    type: z.literal('START_BIZPROC'),
    config: z.object({
      templateId: positiveId,
      /** Entidade do CRM em que o processo roda (a vinculada ao diálogo). */
      documentType: z.enum(['LEAD', 'DEAL', 'CONTACT', 'COMPANY']),
      parameters: fieldMap.optional(),
    }),
  }),
  z.object({
    id: z.uuid().optional(),
    type: z.literal('OUTBOUND_WEBHOOK'),
    /** POST com o payload do evento, assinado com o segredo da ação (gerado pelo app). */
    config: z.object({
      url: z.url({ protocol: /^https?$/, message: 'informe um endereço http ou https' }).max(2000),
    }),
  }),
]);
export type TriggerActionInput = z.input<typeof triggerActionInputSchema>;

const actions = z
  .array(triggerActionInputSchema)
  .min(1, 'inclua ao menos uma ação')
  .max(TRIGGER_MAX_ACTIONS, `no máximo ${TRIGGER_MAX_ACTIONS} ações`);

export const createTriggerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  event: agentEventSchema,
  active: z.boolean().default(true),
  actions,
});
export type CreateTriggerInput = z.input<typeof createTriggerSchema>;

/** Campos ausentes ficam como estão; `actions`, quando vem, é a lista completa e na ordem. */
export const updateTriggerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    event: agentEventSchema,
    active: z.boolean(),
    actions,
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'nada para alterar');
export type UpdateTriggerInput = z.input<typeof updateTriggerSchema>;

export interface TriggerActionView {
  id: string;
  type: TriggerActionType;
  config: Record<string, unknown>;
  /** Webhook de saída: há segredo de assinatura (o valor só aparece na criação da ação). */
  hasSecret: boolean;
}

export interface TriggerView {
  id: string;
  agentId: string;
  name: string;
  event: AgentEventName;
  active: boolean;
  actions: TriggerActionView[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Resposta de criação e edição: segredos das ações de webhook criadas nesta chamada, por id da
 * ação. É a única vez que o valor aparece.
 */
export interface TriggerWriteResult {
  trigger: TriggerView;
  newSecrets: Record<string, string>;
}

export const triggerExecutionStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED']);

/** Uma ação executada para um evento (histórico do gatilho). */
export interface TriggerExecutionView {
  id: string;
  actionId: string;
  actionType: TriggerActionType;
  event: AgentEventName;
  dialogId: string | null;
  status: z.infer<typeof triggerExecutionStatusSchema>;
  attempts: number;
  error: string | null;
  /** Resultado da ação (ex.: `{ leadId }`, `{ taskId }`, `{ status }` do webhook). */
  result: unknown;
  createdAt: string;
  finishedAt: string | null;
  /** Próxima tentativa, quando pendente. */
  nextAttemptAt: string | null;
}
