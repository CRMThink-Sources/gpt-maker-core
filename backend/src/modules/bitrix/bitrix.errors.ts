export type BitrixErrorKind =
  /** App removido do portal (410 da plataforma): não há mais token. */
  | 'UNINSTALLED'
  /** Credencial do portal inválida (409 `AUTH_ERROR`): o portal precisa reinstalar. */
  | 'AUTH_ERROR'
  /** Instalação desconhecida ou de outro app (404 da plataforma). */
  | 'NOT_FOUND'
  /** Limite do portal ou local (`QUERY_LIMIT_EXCEEDED`). */
  | 'RATE_LIMITED'
  /** Bitrix ou plataforma fora do ar, 5xx, tempo esgotado. */
  | 'UNAVAILABLE'
  /** Erro de negócio do método (`error` no corpo): parâmetro inválido, sem permissão etc. */
  | 'API_ERROR';

/** Erro de domínio do cliente Bitrix; `code` é o `error` do Bitrix ou da plataforma. */
export class BitrixError extends Error {
  constructor(
    readonly kind: BitrixErrorKind,
    readonly method: string,
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(`Bitrix ${method}: ${code} ${message}`.trim());
    this.name = 'BitrixError';
  }

  get isTransient(): boolean {
    return this.kind === 'UNAVAILABLE' || this.kind === 'RATE_LIMITED';
  }
}
