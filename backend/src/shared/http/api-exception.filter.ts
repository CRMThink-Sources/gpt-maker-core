import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@gptmaker/contracts';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';

/** Código estável de erro de domínio; vira `{ error: { code, message, details } }`. */
export class DomainError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

const STATUS_CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    if (status >= 500) this.logger.error(exception);
    res.status(status).json(body);
  }

  toResponse(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof DomainError) {
      return {
        status: exception.getStatus(),
        body: {
          error: { code: exception.code, message: exception.message, details: exception.details },
        },
      };
    }
    if (exception instanceof ZodValidationException) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Requisição inválida',
            details: (exception.getZodError() as { issues?: unknown }).issues,
          },
        },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: { error: { code: STATUS_CODES[status] ?? 'HTTP_ERROR', message: exception.message } },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } },
    };
  }
}
