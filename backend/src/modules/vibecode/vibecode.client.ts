import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { isRetryable, translate, VibecodeError } from './vibecode.errors';

export interface VibecodeClientOptions {
  /** Ex.: `https://vibecode.bitrix24.com`. */
  baseUrl: string;
  timeoutMs: number;
  /** Tentativas por chamada, a primeira inclusive. */
  maxAttempts?: number;
}

export interface VibecodeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface VibecodeChatInput {
  apiKey: string;
  model: string;
  messages: VibecodeMessage[];
  temperature?: number;
  /** Pede a resposta como um objeto JSON (`response_format: json_object`). */
  json?: boolean;
}

export interface VibecodeChatResult {
  content: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/** Teto da espera entre tentativas, para não prender a requisição do cliente. */
const MAX_WAIT_MS = 10_000;

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

const modelSchema = z.object({ id: z.string() });
const modelsResponseSchema = z.union([
  z.array(modelSchema),
  z.object({ data: z.array(modelSchema) }),
]);

/** Espera e escopos em formatos que a documentação não fixa: aceita `scopes` solto ou em `data`. */
const meSchema = z
  .object({
    scopes: z.array(z.string()).optional(),
    data: z.object({ scopes: z.array(z.string()).optional() }).optional(),
  })
  .loose();

/**
 * Cliente do Vibecode do Bitrix24 (docs/vibecode-observado.md): API no contrato da OpenAI, com a
 * chave `vibe_api_` em `Authorization: Bearer`. A chave vem a cada chamada (é do cliente ou da
 * CRMThink) e nunca é guardada nem registrada em log.
 */
export class VibecodeClient {
  private readonly logger = new Logger(VibecodeClient.name);

  constructor(
    private readonly options: VibecodeClientOptions,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async chat(input: VibecodeChatInput): Promise<VibecodeChatResult> {
    const body = {
      model: input.model,
      messages: input.messages,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.json ? { response_format: { type: 'json_object' } } : {}),
    };
    const parsed = await this.request(
      'chat',
      'POST',
      '/v1/chat/completions',
      input.apiKey,
      chatResponseSchema,
      body,
    );
    const content = parsed.choices[0]!.message.content;
    if (!content) throw new VibecodeError('AI_UNAVAILABLE', 'chat', 'resposta sem texto');
    return {
      content,
      ...(parsed.usage
        ? {
            usage: {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
              totalTokens: parsed.usage.total_tokens,
            },
          }
        : {}),
    };
  }

  /** Ids dos modelos que a chave enxerga. */
  async listModels(apiKey: string): Promise<string[]> {
    const parsed = await this.request('models', 'GET', '/v1/models', apiKey, modelsResponseSchema);
    return (Array.isArray(parsed) ? parsed : parsed.data).map((model) => model.id);
  }

  /** Escopos da chave (`GET /v1/me`); `null` quando a resposta não os traz. */
  async scopes(apiKey: string): Promise<string[] | null> {
    const parsed = await this.request('me', 'GET', '/v1/me', apiKey, meSchema);
    return parsed.scopes ?? parsed.data?.scopes ?? null;
  }

  private async request<S extends z.ZodType>(
    operation: string,
    method: 'GET' | 'POST',
    path: string,
    apiKey: string,
    schema: S,
    body?: unknown,
  ): Promise<z.output<S>> {
    const base = this.options.baseUrl;
    const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
    const maxAttempts = this.options.maxAttempts ?? 3;

    for (let attempt = 1; ; attempt++) {
      let response: Response | undefined;
      try {
        response = await this.fetchFn(url, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch {
        // Rede ou tempo esgotado: sem resposta.
      }
      if (response?.ok) return this.parse(operation, schema, await response.text());

      let failure: VibecodeError;
      let retryAfterMs: number | undefined;
      if (!response) {
        failure = new VibecodeError('AI_UNAVAILABLE', operation, 'sem resposta do Vibecode');
      } else {
        const vibecodeCode = await this.errorCode(response);
        retryAfterMs = retryAfter(response.headers.get('Retry-After'));
        const details = { status: response.status, vibecodeCode };
        const message = `HTTP ${response.status}${vibecodeCode ? ` (${vibecodeCode})` : ''}`;
        // Chave, saldo, modelo e tamanho: tentar de novo não muda nada.
        if (!isRetryable(response.status, vibecodeCode)) {
          throw new VibecodeError(
            translate(response.status, vibecodeCode),
            operation,
            message,
            details,
          );
        }
        // Sobrecarga e falha do provedor: esgotadas as tentativas, viram "fora do ar".
        failure = new VibecodeError('AI_UNAVAILABLE', operation, message, details);
      }
      if (attempt >= maxAttempts) throw failure;
      const wait = Math.min(retryAfterMs ?? 1000 * attempt, MAX_WAIT_MS);
      this.logger.warn(
        { operation, attempt, status: failure.status, code: failure.vibecodeCode, waitMs: wait },
        'chamada ao Vibecode falhou; tentando de novo',
      );
      await this.sleep(wait);
    }
  }

  private parse<S extends z.ZodType>(operation: string, schema: S, text: string): z.output<S> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new VibecodeError('AI_UNAVAILABLE', operation, 'resposta que não é JSON');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new VibecodeError('AI_UNAVAILABLE', operation, 'resposta em formato inesperado');
    }
    return parsed.data;
  }

  /** Código do corpo do erro (`{ error: { code } }`, `{ code }` ou `{ error: "code" }`). */
  private async errorCode(response: Response): Promise<string | undefined> {
    try {
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object') return undefined;
      const { error, code } = body as { error?: unknown; code?: unknown };
      if (typeof code === 'string') return code;
      if (typeof error === 'string') return error;
      if (
        error &&
        typeof error === 'object' &&
        typeof (error as { code?: unknown }).code === 'string'
      ) {
        return (error as { code: string }).code;
      }
    } catch {
      // Corpo vazio ou que não é JSON: vale o status.
    }
    return undefined;
  }
}

/** `Retry-After` em segundos ou data HTTP. */
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}
