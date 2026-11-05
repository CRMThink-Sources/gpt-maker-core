import { All, Controller, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { corsOptions } from './cors';

const FRONTEND = 'https://thinkflow-staging.crmthink.com.br';
const GPTMAKER = 'https://app.gptmaker.ai';

@Controller()
class AnyRoute {
  @All('*path')
  ok(): string {
    return 'ok';
  }
}

// CORS como no `main.api.ts` (enableCors com o delegate).
describe('corsOptions', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [AnyRoute] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.enableCors(corsOptions([FRONTEND]));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const preflight = (path: string, origin: string, headers = 'authorization,content-type') =>
    request(app.getHttpServer())
      .options(path)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', headers);

  it('/mcp aceita qualquer origem com os cabeçalhos do protocolo MCP', async () => {
    const res = await preflight(
      '/mcp',
      GPTMAKER,
      'authorization,content-type,mcp-protocol-version',
    );
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-headers']).toMatch(/Mcp-Protocol-Version/i);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('/mcp com query também', async () => {
    const res = await preflight('/mcp?t=x', GPTMAKER);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('a resposta do POST no /mcp libera a origem', async () => {
    const res = await request(app.getHttpServer()).post('/mcp').set('Origin', GPTMAKER);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('o resto da API só aceita o frontend', async () => {
    const other = await preflight('/app/session', GPTMAKER);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const frontend = await preflight('/app/session', FRONTEND);
    expect(frontend.headers['access-control-allow-origin']).toBe(FRONTEND);
    // Rota parecida não herda a regra do MCP.
    const lookalike = await preflight('/mcpx', GPTMAKER);
    expect(lookalike.headers['access-control-allow-origin']).toBeUndefined();
  });
});
