import 'reflect-metadata';
import {
  Controller,
  type INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { TRAINING_DOCUMENT_MAX_BYTES } from '@gptmaker/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiExceptionFilter } from '../../shared/http/api-exception.filter';
import { DocumentUploadInterceptor } from './document-upload.interceptor';

@Controller('upload')
class UploadController {
  @Post()
  @UseInterceptors(DocumentUploadInterceptor)
  receive(@UploadedFile() file: Express.Multer.File | undefined) {
    return { name: file?.originalname, size: file?.size };
  }
}

describe('upload de documento', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [DocumentUploadInterceptor, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('recebe o arquivo do campo file em memória', async () => {
    const res = await request(app.getHttpServer())
      .post('/upload')
      .attach('file', Buffer.from('%PDF-1.7'), 'manual.pdf');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'manual.pdf', size: 8 });
  });

  it('arquivo acima do limite: 413 TRAINING_FILE_TOO_LARGE', async () => {
    const res = await request(app.getHttpServer())
      .post('/upload')
      .attach('file', Buffer.alloc(TRAINING_DOCUMENT_MAX_BYTES + 1), 'grande.pdf');
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'TRAINING_FILE_TOO_LARGE' });
  });

  it('mais de um arquivo ou campo errado: 400 TRAINING_FILE_INVALID', async () => {
    const res = await request(app.getHttpServer())
      .post('/upload')
      .attach('documento', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'TRAINING_FILE_INVALID' });
  });
});
