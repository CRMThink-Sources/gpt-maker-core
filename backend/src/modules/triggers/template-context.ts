import { dialogChatId, type TemplateContext } from '@gptmaker/contracts';

type Payload = Record<string, unknown>;

function text(payload: Payload, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/**
 * Contexto dos templates a partir do evento gravado em `agent_event` (payloads observados em
 * `docs/gptmaker-api.md` §5.4.1): os nomes mudam entre eventos (`name` nos atendimentos,
 * `contactName` nas mensagens), e aqui viram nomes estáveis. O corpo cru fica em `payload`.
 */
export function buildTemplateContext(
  event: { event: string; dialogId: string | null; payload: unknown; receivedAt: Date },
  agent: { id: string; name: string },
): TemplateContext {
  const payload: Payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Payload)
      : {};
  return {
    contact: {
      name: text(payload, 'contactName', 'name', 'userName'),
      phone: text(payload, 'contactPhone', 'phone', 'whatsappPhone'),
    },
    message: { text: text(payload, 'message', 'prompt'), role: text(payload, 'role') },
    agent: { id: agent.id, name: agent.name },
    event: { name: event.event, date: event.receivedAt.toISOString() },
    dialog: { id: event.dialogId, chatId: dialogChatId(event.dialogId) },
    interaction: { id: text(payload, 'interactionId'), protocol: text(payload, 'protocol') },
    payload: event.payload,
  };
}
