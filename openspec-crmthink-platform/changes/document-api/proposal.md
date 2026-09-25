## Why

A API da plataforma (instalação, tokens, sessão do iframe, cobrança, webhooks e rotas de operador) só está descrita em prosa em `docs/apps-integration.md` e no próprio código: não há contrato formal com schemas de requisição/resposta, códigos de erro por rota nem uma visão técnica de como a plataforma funciona por dentro. Com o GPTMaker integrando agora e outros apps a caminho, cada time precisa ler o código para descobrir campos e erros, e quem mantém a plataforma não tem um documento de arquitetura para onboarding, revisão e operação.

## What Changes

- Referência da API em **OpenAPI 3.1**, gerada a partir dos schemas zod já usados nas rotas (entrada) e de novos schemas zod de resposta, cobrindo todas as rotas de `createApp`: públicas (instalação, eventos Bitrix, JWKS, sessão), servidor-a-servidor (instalações, tokens, planos, assinaturas, checkout, portal, itens), webhooks recebidos (Stripe, SPAs), infraestrutura (`/health`, `/metrics`) e operador (`/admin/*`, trial manual).
- Descrição formal dos esquemas de segurança (`Bearer` de app, `Bearer` de operador, `X-Platform-Signature`, `Stripe-Signature`, auth do Bitrix), do envelope de erro `{ error: { code, message, details } }` e dos códigos estáveis por rota.
- Documentação dos eventos enviados aos apps (webhooks de saída) com o envelope e o `data` de cada tipo, como `webhooks` do OpenAPI.
- Arquivos gerados versionados em `docs/api/` (`openapi.json` para apps, `openapi-admin.json` completo) e comando `yarn docs:openapi`.
- API passa a servir `GET /openapi.json` (sem rotas de operador) e `GET /docs` (visualização navegável).
- Testes de deriva: toda rota montada no Express precisa estar no contrato e vice-versa; o arquivo versionado precisa bater com o gerado; respostas dos testes de integração existentes validadas contra os schemas de resposta; todo código de erro lançado no código precisa constar no catálogo.
- Documentação técnica em `docs/technical/`: arquitetura (processos `api`/`worker`, módulos, container), ciclo da requisição, segurança e criptografia, modelo de dados, processamento assíncrono (filas, agendamentos, outbox), sincronização de cobrança Stripe ↔ SPAs, observabilidade, configuração (variáveis de ambiente) e catálogo de erros, com diagramas Mermaid.
- `docs/apps-integration.md` e `README.md` passam a apontar para a referência e para a documentação técnica.

Nenhuma mudança de comportamento das rotas existentes.

## Capabilities

### New Capabilities
- `api-reference`: contrato OpenAPI 3.1 gerado do código, publicado em arquivo e servido pela API, com garantias automáticas de que não diverge das rotas, respostas e códigos de erro reais.
- `technical-documentation`: documentação técnica interna da plataforma (arquitetura, fluxos, segurança, dados, filas, cobrança, observabilidade, configuração e erros), mantida no repositório.

### Modified Capabilities
<!-- Nenhuma: não há specs publicadas em openspec/specs/ e o comportamento das rotas não muda. -->

## Impact

- **Código novo**: `src/docs/openapi/` (registro de operações, schemas de resposta, geração), `scripts/generate-openapi.ts`, rotas `/openapi.json` e `/docs` em `src/app.ts`.
- **Código tocado (sem mudança de comportamento)**: exportar schemas zod hoje locais (`refreshSchema`, `resendSchema`, schema de rotação de chave) para reuso na documentação.
- **Testes**: novos testes de cobertura de rotas, de sincronia do arquivo gerado, de catálogo de erros; testes de integração existentes passam a validar respostas.
- **Dependências**: nenhuma em runtime (usa `z.toJSONSchema` do zod 4); a página `/docs` carrega o visualizador via CDN.
- **Docs**: `docs/api/*`, `docs/technical/*`, atualização de `docs/apps-integration.md` e `README.md`.
