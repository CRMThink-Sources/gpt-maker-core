import { createServer, Server } from 'node:http';
import { metricsRegistry } from './metrics';

/** Servidor HTTP mínimo do worker: `/metrics` para o Prometheus e `/health/live` para o container. */
export function startWorkerHttpServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.url === '/metrics') {
      metricsRegistry
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
      return;
    }
    if (req.url === '/health/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return server.listen(port);
}
