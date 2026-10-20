/**
 * Diálogo das conversas de teste (design T2): o contexto no GPTMaker é `<tenantId>:test-<id>`,
 * então o "diálogo" que volta em `{{chat_id}}` e nos webhooks é `test-<id>`. Esse prefixo
 * identifica a conversa de teste no backend inteiro (CRM, gatilhos, intenções).
 */
export const TEST_DIALOG_PREFIX = 'test-';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function testContextId(tenantId: string, conversationId: string): string {
  return `${tenantId}:${TEST_DIALOG_PREFIX}${conversationId}`;
}

/** É diálogo de conversa de teste (mesmo com id inválido: nunca tratar como Linha Aberta). */
export function isTestDialog(dialogId: string | null | undefined): boolean {
  return typeof dialogId === 'string' && dialogId.startsWith(TEST_DIALOG_PREFIX);
}

/** Id da conversa de teste no diálogo, ou `null` se não for de teste ou o id for inválido. */
export function testConversationIdFrom(dialogId: string | null | undefined): string | null {
  if (!isTestDialog(dialogId)) return null;
  const id = dialogId!.slice(TEST_DIALOG_PREFIX.length);
  return UUID.test(id) ? id : null;
}
