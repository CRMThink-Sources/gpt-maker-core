import { z } from 'zod';

/** Destinatários dos avisos do app (spec credit-billing, "Destinatários de avisos"). */
export const notificationRecipientsSchema = z.object({
  bitrixUserIds: z.array(z.string().regex(/^\d+$/, 'id de usuário do Bitrix')).max(50),
});

export type NotificationRecipientsInput = z.infer<typeof notificationRecipientsSchema>;

export interface NotificationRecipientsView {
  /** Vazio: os avisos vão para os administradores do portal. */
  bitrixUserIds: string[];
}

export interface NotificationTestView {
  status: 'PENDING' | 'SENT' | 'FAILED';
  /** Ids do Bitrix que receberam o aviso de teste. */
  sentTo: string[];
}
