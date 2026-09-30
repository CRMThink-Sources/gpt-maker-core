// Só tipos do SDK: a entrada dele usa `node:crypto` e não entra no bundle do navegador.
import type { components, PlatformErrorBody } from '@crmthink-sources/platform-sdk';
import { APP_CODE, type ApiError } from '@gptmaker/contracts';
import { bx24Auth } from './bx24';

type PlatformSession = components['schemas']['Session'];

export interface ClientConfig {
  /** Base do crmthink-platform (`POST /v1/sessions`). */
  platformUrl: string;
  /** Base da API do app. */
  apiBaseUrl: string;
}

/** Renova antes de vencer para as chamadas não esbarrarem no `exp` (JWT de 15 min). */
const RENEW_BEFORE_MS = 60_000;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Sessão do iframe (design D3): `BX24.getAuth()` → `POST /v1/sessions` da plataforma → JWT
 * enviado à API do app. Renovação transparente: antes do vencimento, e uma vez quando a API
 * responde 401 (com auth nova do BX24). Várias chamadas simultâneas compartilham a renovação.
 */
export class PlatformSessionClient {
  private session: PlatformSession | undefined;
  private pending: Promise<PlatformSession> | undefined;

  constructor(private readonly config: ClientConfig) {}

  async current(): Promise<PlatformSession> {
    const session = this.session;
    if (session && new Date(session.expiresAt).getTime() - RENEW_BEFORE_MS > Date.now()) {
      return session;
    }
    return this.renew(false);
  }

  /** `fetch` para a API do app com `Authorization: Bearer <JWT>`; lança `ApiRequestError`. */
  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response = await this.send(path, init, await this.current());
    if (response.status === 401) response = await this.send(path, init, await this.renew(true));
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as ApiError | undefined;
      throw new ApiRequestError(
        response.status,
        body?.error.code ?? `HTTP_${response.status}`,
        body?.error.message ?? 'Erro ao falar com o servidor',
      );
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  private send(path: string, init: RequestInit, session: PlatformSession): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${session.token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetch(`${this.config.apiBaseUrl.replace(/\/+$/, '')}${path}`, { ...init, headers });
  }

  private renew(freshAuth: boolean): Promise<PlatformSession> {
    this.pending ??= this.create(freshAuth).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async create(freshAuth: boolean): Promise<PlatformSession> {
    const auth = await bx24Auth(freshAuth);
    const response = await fetch(`${this.config.platformUrl.replace(/\/+$/, '')}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appCode: APP_CODE,
        accessToken: auth.access_token,
        domain: auth.domain,
        memberId: auth.member_id,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as PlatformErrorBody | undefined;
      throw new ApiRequestError(
        response.status,
        body?.error.code ?? `HTTP_${response.status}`,
        body?.error.message ?? 'Não foi possível iniciar a sessão',
      );
    }
    this.session = (await response.json()) as PlatformSession;
    return this.session;
  }
}
