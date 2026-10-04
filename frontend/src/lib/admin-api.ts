import { type ApiError, BACKOFFICE_HEADER } from '@gptmaker/contracts';
import { ApiRequestError } from './platform-session';

/**
 * Chamadas do backoffice à API pelo repasse do próprio frontend (`/admin/x` ⇒ `/admin/api/x`,
 * route handler): mesma origem da página, então o cookie httpOnly `gm_admin` vai sozinho. Toda
 * escrita leva o cabeçalho `X-Backoffice: 1` (CSRF).
 */
export function createAdminApi() {
  return async function adminApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    if ((init.method ?? 'GET') !== 'GET') headers.set(BACKOFFICE_HEADER, '1');
    const response = await fetch(path.replace(/^\/admin\//, '/admin/api/'), {
      ...init,
      headers,
      credentials: 'same-origin',
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
