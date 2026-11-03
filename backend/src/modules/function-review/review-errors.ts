import { HttpStatus } from '@nestjs/common';
import type { ReviewErrorCode } from '@gptmaker/contracts';
import { DomainError } from '../../shared/http/api-exception.filter';
import { VibecodeError } from '../vibecode';

/** Mensagem ao cliente e status HTTP de cada falha da revisão por IA (spec agent-knowledge-review). */
const ERRORS: Record<ReviewErrorCode, { message: string; status: HttpStatus }> = {
  AI_KEY_REQUIRED: {
    message: 'Para revisar com IA, informe a chave do Vibecode.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  AI_KEY_INVALID: {
    message:
      'O Vibecode não aceitou a chave. Confira se ela foi copiada inteira e se ainda está ativa.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  AI_KEY_SCOPE: {
    message: 'A chave precisa ter o escopo vibe:ai.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  AI_NO_BALANCE: {
    message: 'A conta do Vibecode ficou sem saldo ou cota.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  AI_MODEL_UNAVAILABLE: {
    message: 'A chave não tem acesso ao modelo usado na revisão, ou ele está fora do ar.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  AI_UNAVAILABLE: {
    message: 'A revisão por IA está fora do ar agora. Tente de novo em instantes.',
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  AI_BUSY: {
    message: 'Muitas revisões agora. Tente de novo em instantes.',
    status: HttpStatus.TOO_MANY_REQUESTS,
  },
  AI_FIELD_TOO_LARGE: {
    message: 'Este campo é grande demais para a revisão.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  AI_BAD_OUTPUT: {
    message: 'Não foi possível revisar este campo.',
    status: HttpStatus.BAD_GATEWAY,
  },
  NO_CREDIT: {
    message: 'Seus créditos de IA acabaram. Adicione créditos para continuar.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
};

export function reviewError(code: ReviewErrorCode, message?: string): DomainError {
  const entry = ERRORS[code];
  return new DomainError(code, message ?? entry.message, entry.status);
}

/** Falha do Vibecode com a mensagem do spec; outros erros seguem como estão. */
export function fromVibecode(error: unknown): unknown {
  return error instanceof VibecodeError ? reviewError(error.code) : error;
}
