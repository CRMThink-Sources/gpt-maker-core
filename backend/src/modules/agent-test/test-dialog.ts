import { randomBytes } from 'node:crypto';

/**
 * Diálogo das conversas de teste (design T2): o contexto no GPTMaker é `<tenantId>:t-<chave>`,
 * então o "diálogo" que volta em `{{chat_id}}` e nos webhooks é `t-<chave>`. Esse prefixo
 * identifica a conversa de teste no backend inteiro (CRM, gatilhos, intenções).
 *
 * O contexto precisa ser curto: o GPTMaker monta o chat como `public-api-<agente>-<contexto>` e,
 * com 78 caracteres no contexto, responde `success: false` ("Transaction silently rolled back");
 * com 50 funciona (testado em staging, 2026-10-20). `<uuid do tenant>:t-<10 hex>` tem 49.
 */
export const TEST_DIALOG_PREFIX = 't-';

const KEY = /^[\da-f]{10}$/;

/** Chave aleatória da conversa de teste (40 bits; o contexto é único no banco). */
export function newTestDialogKey(): string {
  return randomBytes(5).toString('hex');
}

export function testContextId(tenantId: string, key: string): string {
  return `${tenantId}:${TEST_DIALOG_PREFIX}${key}`;
}

/** Diálogo (`t-<chave>`) a partir do contexto da conversa. */
export function testDialogOf(contextId: string): string {
  return contextId.slice(contextId.indexOf(':') + 1);
}

/** É diálogo de conversa de teste (mesmo com chave inválida: nunca tratar como Linha Aberta). */
export function isTestDialog(dialogId: string | null | undefined): boolean {
  return typeof dialogId === 'string' && dialogId.startsWith(TEST_DIALOG_PREFIX);
}

/** Chave da conversa de teste no diálogo, ou `null` se não for de teste ou a chave for inválida. */
export function testDialogKeyFrom(dialogId: string | null | undefined): string | null {
  if (!isTestDialog(dialogId)) return null;
  const key = dialogId!.slice(TEST_DIALOG_PREFIX.length);
  return KEY.test(key) ? key : null;
}
