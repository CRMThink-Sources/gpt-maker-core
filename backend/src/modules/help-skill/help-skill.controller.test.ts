import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../../config/config.module';
import { FunctionCatalog } from '../agent-functions';
import { HelpSkillController } from './help-skill.controller';
import { HelpSkillService } from './help-skill.service';

describe('rotas públicas da skill de ajuda', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HelpSkillController],
      providers: [
        HelpSkillService,
        { provide: FunctionCatalog, useValue: { listPublicForms: async () => [] } },
        { provide: ENV, useValue: { API_PUBLIC_URL: 'https://api.exemplo.com' } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('entrega o conteúdo em Markdown, sem sessão e com cache curto', async () => {
    const response = await request(app.getHttpServer())
      .get('/public/help-skill/content')
      .expect(200);
    expect(response.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.text).toContain('## Criar um agente');
  });

  it('o guia não cita fornecedor, backoffice nem quantidade de créditos ou preço', async () => {
    const { text } = await request(app.getHttpServer()).get('/public/help-skill/content');
    expect(text).not.toMatch(/gpt ?maker|backoffice|R\$|\d+ créditos/i);
  });

  it('baixa o .zip como anexo', async () => {
    const response = await request(app.getHttpServer())
      .get('/public/help-skill/download')
      .expect(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="gptthink-ajuda.zip"',
    );
  });
});
