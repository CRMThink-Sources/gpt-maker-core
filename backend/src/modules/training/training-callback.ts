/**
 * Leitura do corpo do `callbackUrl` de treinamento, cujo formato o GPTMaker não documenta
 * (docs/gptmaker-api.md §4.2). Aceita as formas mais prováveis e, sem reconhecer nenhuma,
 * devolve `unknown`: o status local não muda e o corpo vai para o log, para ser capturado em
 * staging e esta leitura ser ajustada.
 */
export type CallbackOutcome =
  | { status: 'DONE'; gptmakerTrainingId?: string }
  | { status: 'FAILED'; error: string; gptmakerTrainingId?: string }
  | { status: 'unknown'; gptmakerTrainingId?: string };

const DONE = new Set([
  'DONE',
  'SUCCESS',
  'SUCCEEDED',
  'COMPLETED',
  'COMPLETE',
  'FINISHED',
  'TRAINED',
]);
const FAILED = new Set(['FAILED', 'FAILURE', 'FAIL', 'ERROR', 'ERRORED']);

const MAX_ERROR_LENGTH = 500;

export function interpretCallback(payload: unknown): CallbackOutcome {
  const body = asRecord(payload);
  // Alguns webhooks embrulham os dados em `data` ou `training`.
  const nested =
    [body.data, body.training].map(asRecord).find((entry) => Object.keys(entry).length) ?? {};
  const fields = { ...nested, ...body };
  // `id` solto no topo pode ser do evento, não do treinamento: só os explícitos contam.
  const gptmakerTrainingId = text(fields.trainingId) ?? text(nested.id);
  const withId = gptmakerTrainingId ? { gptmakerTrainingId } : {};

  const status = text(fields.status) ?? text(fields.state) ?? text(fields.event);
  const normalized = status?.toUpperCase().replace(/^TRAINING[._-]?/, '');
  const error = errorText(fields.error) ?? errorText(fields.message) ?? errorText(fields.reason);

  if (normalized && FAILED.has(normalized)) {
    return { status: 'FAILED', error: error ?? 'O GPTMaker não conseguiu processar', ...withId };
  }
  if (normalized && DONE.has(normalized)) return { status: 'DONE', ...withId };
  if (fields.success === false || (fields.success === undefined && fields.error)) {
    return { status: 'FAILED', error: error ?? 'O GPTMaker não conseguiu processar', ...withId };
  }
  if (fields.success === true) return { status: 'DONE', ...withId };
  return { status: 'unknown', ...withId };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function errorText(value: unknown): string | undefined {
  const raw = text(value) ?? text(asRecord(value).message);
  return raw?.slice(0, MAX_ERROR_LENGTH);
}
