import type { ReviewErrorCode } from '@gptmaker/contracts';

/** Códigos que o Vibecode devolve no corpo do erro (docs/vibecode-observado.md). */
export type VibecodeErrorCode = Extract<
  ReviewErrorCode,
  | 'AI_KEY_INVALID'
  | 'AI_KEY_SCOPE'
  | 'AI_NO_BALANCE'
  | 'AI_MODEL_UNAVAILABLE'
  | 'AI_UNAVAILABLE'
  | 'AI_FIELD_TOO_LARGE'
>;

/**
 * Falha numa chamada ao Vibecode, já traduzida para o código da revisão. Nunca carrega a chave: a
 * mensagem e o corpo guardado não a contêm.
 */
export class VibecodeError extends Error {
  readonly status?: number;
  /** Código cru do Vibecode (`insufficient_balance`...), para o log. */
  readonly vibecodeCode?: string;

  constructor(
    readonly code: VibecodeErrorCode,
    readonly operation: string,
    message: string,
    details: { status?: number; vibecodeCode?: string } = {},
  ) {
    super(`Vibecode ${operation}: ${message}`);
    this.name = 'VibecodeError';
    this.status = details.status;
    this.vibecodeCode = details.vibecodeCode;
  }
}

/** Falha que tentar de novo pode resolver: sobrecarga, tempo esgotado, provedor fora do ar. */
export function isRetryable(status: number | undefined, vibecodeCode: string | undefined): boolean {
  if (vibecodeCode === 'model_unavailable') return false;
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

/**
 * Traduz status e código do corpo para o código da revisão (design D5). O formato do corpo do erro
 * ainda não foi visto de perto (tarefa 1.1): `vibecodeCode` pode ser desconhecido, e então vale o
 * status.
 */
export function translate(
  status: number | undefined,
  vibecodeCode: string | undefined,
): VibecodeErrorCode {
  switch (vibecodeCode) {
    case 'scope_missing':
      return 'AI_KEY_SCOPE';
    case 'insufficient_balance':
    case 'ai_quota_exhausted':
      return 'AI_NO_BALANCE';
    case 'ai_model_not_found':
    case 'model_unavailable':
    case 'ai_credentials_not_configured':
      return 'AI_MODEL_UNAVAILABLE';
    case 'ai_payload_too_large':
      return 'AI_FIELD_TOO_LARGE';
    default:
      break;
  }
  if (status === 401 || status === 403) return 'AI_KEY_INVALID';
  if (status === 402) return 'AI_NO_BALANCE';
  if (status === 404) return 'AI_MODEL_UNAVAILABLE';
  if (status === 413) return 'AI_FIELD_TOO_LARGE';
  return 'AI_UNAVAILABLE';
}
