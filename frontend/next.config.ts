import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Imagem Docker enxuta (server.js + dependências rastreadas).
  output: 'standalone',
  // Monorepo: rastreia a partir da raiz para incluir packages/contracts.
  outputFileTracingRoot: path.join(__dirname, '..'),
  poweredByHeader: false,
  // Só para o `next dev` aberto por túnel (hostname, sem esquema nem porta). O quick tunnel do
  // cloudflared muda de endereço a cada reinício, daí o curinga.
  allowedDevOrigins: ['*.trycloudflare.com', 'gptmaker-staging.crmthink.com.br'],
};

export default nextConfig;
