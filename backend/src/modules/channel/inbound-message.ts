import { z } from 'zod';

/** Evento de nova mensagem num diálogo do bot (`imbot.v2`). */
export const MESSAGE_ADD_EVENT = 'ONIMBOTV2MESSAGEADD';
/**
 * Bot entrou no chat. Na Linha Aberta, cada sessão nova começa com o bot entrando (observado; a
 * documentação não fala de Linhas Abertas): é o sinal de que o atendimento humano anterior acabou.
 */
export const JOIN_CHAT_EVENT = 'ONIMBOTV2JOINCHAT';

/**
 * No modo webhook o Bitrix manda tudo como texto (form-urlencoded): número vira `"789"` e
 * booleano vira `"1"`/`"0"`. Aceita as duas formas, para o caso de chegar em JSON.
 */
const boolish = z
  .union([z.boolean(), z.string(), z.number()])
  .optional()
  .transform(
    (value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'Y',
  );
const id = z.coerce.number().int().nonnegative();
const text = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => (value === undefined ? '' : String(value)));

/** Só os campos usados; o resto do evento é ignorado. */
export const messageAddDataSchema = z.object({
  bot: z.object({ id }),
  message: z.object({
    id,
    authorId: id.optional(),
    text,
    isSystem: boolish,
    /** Anexos e outros dados da mensagem (formato dos arquivos não documentado na v2). */
    params: z.unknown().optional(),
  }),
  chat: z.object({
    id,
    dialogId: z.string().min(1),
    type: text,
    entityType: text,
    entityId: text,
    entityData1: text,
    entityData2: text,
    entityData3: text,
  }),
  user: z.object({
    id,
    name: text,
    bot: boolish,
    /** Usuário da Linha Aberta (cliente vindo de WhatsApp, site etc.). */
    connector: boolish,
  }),
  language: text,
});

/** `ONIMBOTV2JOINCHAT`: o diálogo vem na raiz (documentação) ou no `chat`. */
export const joinChatDataSchema = z
  .object({
    bot: z.object({ id }),
    dialogId: z.string().min(1).optional(),
    chat: z.object({ dialogId: z.string().min(1).optional() }).optional(),
  })
  .transform((data) => ({ botId: data.bot.id, dialogId: data.dialogId ?? data.chat?.dialogId }));

/** Mensagem publicada em `channel.inbound` para o worker (9.4). */
export interface InboundMessage {
  tenantId: string;
  agentId: string;
  botId: number;
  dialogId: string;
  chatId: number;
  messageId: number;
  text: string;
  params: unknown;
  user: { id: number; name: string; connector: boolean };
  chat: {
    type: string;
    entityType: string;
    entityId: string;
    entityData1: string;
    entityData2: string;
    entityData3: string;
  };
  language: string;
  receivedAt: string;
}

/** Chave do consistent hash: o mesmo diálogo cai sempre na mesma partição. */
export function dialogKey(message: Pick<InboundMessage, 'tenantId' | 'dialogId'>): string {
  return `${message.tenantId}:${message.dialogId}`;
}
