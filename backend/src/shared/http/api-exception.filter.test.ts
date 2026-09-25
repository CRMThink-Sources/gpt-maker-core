import { HttpStatus, NotFoundException } from '@nestjs/common';
import { apiErrorSchema } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { ApiExceptionFilter, DomainError } from './api-exception.filter';

const filter = new ApiExceptionFilter();

describe('ApiExceptionFilter', () => {
  it('mantém código de erro de domínio', () => {
    const { status, body } = filter.toResponse(
      new DomainError('TENANT_AGENT_LIMIT', 'Limite de agentes atingido', HttpStatus.CONFLICT),
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe('TENANT_AGENT_LIMIT');
    expect(apiErrorSchema.safeParse(body).success).toBe(true);
  });

  it('mapeia HttpException do Nest', () => {
    const { status, body } = filter.toResponse(new NotFoundException());
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('não vaza mensagem de erro inesperado', () => {
    const { status, body } = filter.toResponse(new Error('senha do banco'));
    expect(status).toBe(500);
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Erro interno' });
  });
});
