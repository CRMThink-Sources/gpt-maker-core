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

/**
 * Esquemas das ações; `allowFields` libera `{{fields.<campo>}}` (intenções com ações no Bitrix).
 */
function actionSchemas(allowFields: boolean) {
  /** Texto que pode levar variáveis do evento (`{{contact.name}}`, ver `templates.ts`). */
  const template = z
    .string()
    .trim()
    .min(1)
    .max(5_000)
    .superRefine((value, ctx) => {
      for (const message of templateErrors(value, { allowFields }))
        ctx.addIssue({ code: 'custom', message });
    });
  /** Campos do Bitrix (ex.: `TITLE`, `NAME`, `PHONE`) ⇒ template do valor. */
  const fieldMap = z
    .record(z.string().trim().min(1).max(100), template)
    .refine((fields) => Object.keys(fields).length <= 50, 'no máximo 50 campos');
  const positiveId = z.number().int().positive();
  /** Um usuário ou vários em rodízio (design D15). */
  const users = z.union([
    positiveId,
    z
      .array(positiveId)
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'usuário repetido'),
  ]);

  /** Configuração por tipo de ação; o `id` mantém a ação existente na edição (e o segredo dela). */
  return [
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
        responsibleId: users,
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
        url: z
          .url({ protocol: /^https?$/, message: 'informe um endereço http ou https' })
          .max(2000),
      }),
    }),
    z.object({
      id: z.uuid().optional(),
      type: z.literal('CREATE_SPA_ITEM'),
      /** Item num processo inteligente (`crm.item.add`); só nas intenções por enquanto. */
      config: z.object({
        /** SPA (`entityTypeId`, os dinâmicos começam em 1030). */
        entityTypeId: positiveId,
        /** Funil do SPA; sem ele, o padrão. */
        categoryId: z.number().int().nonnegative().optional(),
        /** Etapa (`DT1204_180:NEW`); sem ela, a primeira do funil. */
        stageId: z.string().trim().min(1).max(50).optional(),
        title: template,
        /** Código do campo no portal (`ufCrm136_1750943184955`) ⇒ template do valor. */
        fields: fieldMap,
        /** Campo lista: texto do valor (`HIGH`) ⇒ id do item da lista escolhido pelo cliente. */
        lists: z
          .record(
            z.string().trim().min(1).max(100),
            z.record(z.string().min(1).max(100), positiveId),
          )
          .optional(),
      }),
    }),
  ] as const;
}

const [createLead, upsertDeal, timelineComment, createTask, startBizproc, outboundWebhook] =
  actionSchemas(false);
export const triggerActionInputSchema = z.discriminatedUnion('type', [
  createLead,
  upsertDeal,
  timelineComment,
  createTask,
  startBizproc,
  outboundWebhook,
]);

const intention = actionSchemas(true);

/** Lista de usuários: a ação gira entre eles (design D15). */
export function isUserList(value: unknown): value is number[] {
  return Array.isArray(value);
}

const userId = z.number().int().positive();

/**
 * Transferir a conversa para um atendente (só em intenções): depois que a resposta do agente é
 * entregue, o diálogo vai para o operador livre da Linha Aberta, para um usuário escolhido (ou o
 * próximo de uma lista, em rodízio) ou para a fila de um canal aberto (design D16).
 */
const transferToHuman = z.object({
  id: z.uuid().optional(),
  type: z.literal('TRANSFER_TO_HUMAN'),
  config: z
    .object({
      target: z.enum(['OPERATOR', 'USER', 'LINE']),
      /** Usuário do Bitrix que recebe a conversa (`target = USER`), ou vários em rodízio. */
      userId: z
        .union([
          userId,
          z
            .array(userId)
            .min(1)
            .max(20)
            .refine((ids) => new Set(ids).size === ids.length, 'usuário repetido'),
        ])
        .optional(),
      /** Canal aberto (id da configuração da Linha Aberta) que recebe a conversa (`target = LINE`). */
      lineId: userId.optional(),
    })
    .refine((config) => config.target !== 'USER' || config.userId !== undefined, {
      message: 'escolha o usuário que recebe a conversa',
      path: ['userId'],
    })
    .refine((config) => config.target !== 'LINE' || config.lineId !== undefined, {
      message: 'escolha o canal aberto que recebe a conversa',
      path: ['lineId'],
    }),
});

export const intentionActionTypeSchema = z.enum([
  'CREATE_LEAD',
  'UPSERT_DEAL',
  'TIMELINE_COMMENT',
  'CREATE_TASK',
  'START_BIZPROC',
  'CREATE_SPA_ITEM',
  'TRANSFER_TO_HUMAN',
]);
export type IntentionActionType = z.infer<typeof intentionActionTypeSchema>;

/**
 * Ações de uma intenção "Ação no Bitrix24": as dos gatilhos, com os campos coletados pelo agente,
 * mais o item de SPA e a transferência para atendente; sem webhook de saída (a intenção genérica
 * já chama APIs).
 */
export const intentionActionInputSchema = z.discriminatedUnion('type', [
  intention[0],
  intention[1],
  intention[2],
  intention[3],
  intention[4],
  intention[6],
  transferToHuman,
]);
export type IntentionActionInput = z.input<typeof intentionActionInputSchema>;

export type TriggerActionInput = z.input<typeof triggerActionInputSchema>;

/** Item de SPA (só intenções); o executor dos gatilhos também roda as ações das intenções. */
export type SpaItemActionInput = z.input<(typeof intention)[6]>;

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
