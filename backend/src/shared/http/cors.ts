import type {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface';

/** Rotas do servidor MCP (spec agent-crm-tools). */
const MCP_PATH = /^\/mcp(?:[/?#]|$)/;

/**
 * CORS da API. O frontend (app.) chama com o JWT da sessão no cabeçalho, sem cookies; só as
 * origens do frontend.
 *
 * O `/mcp` aceita qualquer origem: o painel do GPTMaker conecta ao servidor MCP direto do
 * navegador (sem isso, mostra "error on connect with mcp server" e nada chega à API). A
 * credencial é um token por agente no cabeçalho, nunca cookie, então liberar a origem não abre
 * acesso.
 */
export function corsOptions(frontendOrigins: string[]): CorsOptionsDelegate<{ url?: string }> {
  const app: CorsOptions = {
    origin: frontendOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['x-trace-id'],
    maxAge: 600,
  };
  const mcp: CorsOptions = {
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Mcp-Protocol-Version',
      'Mcp-Session-Id',
      'Last-Event-ID',
    ],
    exposedHeaders: ['Mcp-Session-Id', 'x-trace-id'],
    maxAge: 600,
  };
  return (req, callback) => callback(null, MCP_PATH.test(req.url ?? '') ? mcp : app);
}
