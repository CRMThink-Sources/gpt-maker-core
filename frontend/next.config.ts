import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Imagem Docker enxuta (server.js + dependências rastreadas).
  output: 'standalone',
  // Monorepo: rastreia a partir da raiz para incluir packages/contracts.
  outputFileTracingRoot: path.join(__dirname, '..'),
  poweredByHeader: false,
  allowedDevOrigins: [
    'http://localhost:3000',
    'https://spend-translation-bottles-ruling.trycloudflare.com',
    'https://gptmaker-staging.crmthink.com.br',
    'spend-translation-bottles-ruling.trycloudflare.com'
  ]
};

export default nextConfig;
