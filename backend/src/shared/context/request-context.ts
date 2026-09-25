import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/** Contexto propagado em requisições HTTP, mensagens da fila e jobs; os campos entram em todo log. */
export interface RequestContext {
  traceId: string;
  tenantId?: string;
  agentId?: string;
  dialogId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Acrescenta campos (ex.: `tenantId` após autenticar) ao contexto corrente. */
export function enrichContext(fields: Partial<Omit<RequestContext, 'traceId'>>): void {
  const context = storage.getStore();
  if (context) Object.assign(context, fields);
}

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;
const REQUEST_ID = /^[\w.-]{8,128}$/;

/** Reaproveita o trace id de `traceparent` (W3C) ou `x-request-id`; senão gera um novo. */
export function traceIdFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  const traceparent = first(headers['traceparent']);
  const match = traceparent ? TRACEPARENT.exec(traceparent) : null;
  if (match?.[1] && !/^0+$/.test(match[1])) return match[1];
  const requestId = first(headers['x-request-id']);
  if (requestId && REQUEST_ID.test(requestId)) return requestId;
  return newTraceId();
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
