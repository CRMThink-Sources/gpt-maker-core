import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { TRAINING_DOCUMENT_MAX_BYTES } from '@gptmaker/contracts';
import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { DomainError } from '../../shared/http/api-exception.filter';
import { fileTooLarge } from './training.service';

/**
 * Recebe um arquivo no campo `file` (`multipart/form-data`) em memória, cortando o upload no
 * limite de tamanho. Erros do multer viram erros de domínio em pt-BR, com código estável.
 */
@Injectable()
export class DocumentUploadInterceptor implements NestInterceptor {
  private readonly upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TRAINING_DOCUMENT_MAX_BYTES, files: 1, fields: 5 },
  }).single('file');

  async intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    await new Promise<void>((resolve, reject) =>
      this.upload(http.getRequest<Request>(), http.getResponse<Response>(), (error: unknown) => {
        if (!error) return resolve();
        if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
          return reject(fileTooLarge());
        }
        reject(
          new DomainError(
            'TRAINING_FILE_INVALID',
            'Envie um único arquivo no campo "file"',
            HttpStatus.BAD_REQUEST,
          ),
        );
      }),
    );
    return next.handle();
  }
}
