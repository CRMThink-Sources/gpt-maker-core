/**
 * Templates dos gatilhos (`{{contact.name}}`): texto com variáveis do evento do agente,
 * resolvidas na execução (backend) e na prévia (frontend). Sem expressões nem código: só
 * caminhos e um valor padrão opcional, `{{contact.phone | "sem telefone"}}`.
 */

/** Contexto normalizado do evento: nomes estáveis, independentes do payload cru do GPTMaker. */
export interface TemplateContext {
  contact: { name: string | null; phone: string | null };
  /** Mensagem do evento (`onNewMessage`); `role` é `user` (cliente) ou `assistant` (agente). */
  message: { text: string | null; role: string | null };
  agent: { id: string; name: string };
  event: { name: string; date: string };
  /** Diálogo do Bitrix (ex.: `chat9498`), quando o evento traz o `contextId` do app. */
  dialog: { id: string | null };
  /** Atendimento no GPTMaker (`onFirstInteraction`, `onStartInteraction`...). */
  interaction: { id: string | null; protocol: string | null };
  /** Corpo do webhook como chegou, para campos que não estão acima. */
  payload: unknown;
}

/** Variáveis oferecidas ao usuário (UI e validação); `payload.*` aceita qualquer caminho. */
export const TEMPLATE_VARIABLES = [
  { path: 'contact.name', description: 'Nome do cliente' },
  { path: 'contact.phone', description: 'Telefone do cliente' },
  { path: 'message.text', description: 'Texto da mensagem (eventos de mensagem)' },
  { path: 'message.role', description: 'Autor da mensagem: user (cliente) ou assistant (agente)' },
  { path: 'agent.name', description: 'Nome do agente' },
  { path: 'agent.id', description: 'Id do agente no app' },
  { path: 'event.name', description: 'Evento que disparou o gatilho' },
  { path: 'event.date', description: 'Data e hora do evento (ISO 8601)' },
  { path: 'dialog.id', description: 'Diálogo da Linha Aberta no Bitrix24' },
  { path: 'interaction.id', description: 'Atendimento no GPTMaker' },
  { path: 'interaction.protocol', description: 'Protocolo do atendimento no GPTMaker' },
] as const;

const ROOTS = new Set(['contact', 'message', 'agent', 'event', 'dialog', 'interaction', 'payload']);
const KNOWN_PATHS = new Set<string>(TEMPLATE_VARIABLES.map((variable) => variable.path));

/** `{{ caminho }}` ou `{{ caminho | padrão }}`; o padrão pode vir entre aspas. */
const PLACEHOLDER = /\{\{\s*([^{}|]*?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g;
const PATH = /^[A-Za-z_][\w]*(\.[\w-]+)*$/;

function unquote(value: string): string {
  const match = /^"(.*)"$|^'(.*)'$/.exec(value);
  return match ? (match[1] ?? match[2] ?? '') : value;
}

function lookup(context: unknown, path: string): unknown {
  let current: unknown = context;
  for (const key of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Resolve as variáveis; ausente ou vazia ⇒ o padrão, ou texto vazio. */
export function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(PLACEHOLDER, (_match, path: string, fallback?: string) => {
    const value = stringify(lookup(context, path));
    return value !== '' ? value : unquote(fallback ?? '');
  });
}

/** Aplica `renderTemplate` em cada valor de um mapa de campos. */
export function renderFields(
  fields: Record<string, string>,
  context: TemplateContext,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, renderTemplate(value, context)]),
  );
}

/**
 * Problemas do template para mostrar ao salvar: chaves sem fechar, caminho malformado ou
 * variável desconhecida (fora da lista e fora de `payload.*`). Vazio ⇒ válido.
 */
export function templateErrors(template: string): string[] {
  const errors: string[] = [];
  const withoutPlaceholders = template.replace(PLACEHOLDER, '');
  if (withoutPlaceholders.includes('{{') || withoutPlaceholders.includes('}}')) {
    errors.push('chaves {{ }} sem par');
  }
  for (const [, path] of template.matchAll(PLACEHOLDER)) {
    const trimmed = (path ?? '').trim();
    if (!PATH.test(trimmed)) {
      errors.push(`variável inválida: {{${trimmed}}}`);
      continue;
    }
    const root = trimmed.split('.')[0]!;
    const known = KNOWN_PATHS.has(trimmed) || (root === 'payload' && trimmed !== 'payload');
    if (!ROOTS.has(root) || !known) errors.push(`variável desconhecida: {{${trimmed}}}`);
  }
  return errors;
}
