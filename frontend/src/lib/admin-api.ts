import { type ApiError, BACKOFFICE_HEADER } from '@gptmaker/contracts';
import { ApiRequestError } from './platform-session';

/**
 * Chamadas do backoffice à API: sessão no cookie httpOnly `gm_admin` (enviado com
 * `credentials: 'include'`) e o cabeçalho `X-Backoffice: 1` em toda escrita (CSRF).
 */
export function createAdminApi(apiBaseUrl: string) {
  return async function adminApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    if ((init.method ?? 'GET') !== 'GET') headers.set(BACKOFFICE_HEADER, '1');
    const response = await fetch(new URL(path, apiBaseUrl), {
      ...init,
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as ApiError | undefined;
      throw new ApiRequestError(
        response.status,
        body?.error.code ?? `HTTP_${response.status}`,
        body?.error.message ?? 'Erro ao falar com o servidor',
        body?.error.details,
      );
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
