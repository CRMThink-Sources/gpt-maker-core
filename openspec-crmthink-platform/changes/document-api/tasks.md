## 1. Base do gerador OpenAPI

- [x] 1.1 Criar `src/docs/openapi/` com tipos do registro de operações (`method`, `path`, `operationId`, `tag`, `summary`, `description`, `security`, `request`, `responses`, `errors`) e `build.ts` que monta o documento OpenAPI 3.1 com `z.toJSONSchema()` e saída determinística (chaves ordenadas)
- [x] 1.2 Declarar `components.securitySchemes` (`appApiKey`, `adminToken`) e as descrições de `Stripe-Signature`, auth do Bitrix e CORS da sessão
- [x] 1.3 Criar `src/docs/errors.ts` (catálogo `code → status, meaning, appAction, origin`) com todos os códigos atuais, incluindo os implícitos (`UNAUTHORIZED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `NOT_FOUND`), e o componente de envelope de erro com `details` de validação
- [x] 1.4 Exportar schemas zod hoje locais (`refreshSchema`, `resendSchema`, `leadMinutes` da rotação, `schema` de `src/config/env.ts`) sem mudar comportamento

## 2. Schemas de resposta

- [x] 2.1 `src/docs/openapi/responses.ts`: instalação, lista de instalações, token (get/refresh), resultado de install/retry, sessão, JWKS, health/ready
- [x] 2.2 Cobrança: plano, assinatura vigente, checkout session, billing portal, change-plan, item (lista/criação/atualização/remoção)
- [x] 2.3 Webhooks recebidos e operador: resposta do Stripe e dos SPAs, app (com e sem credenciais), rotação, trial, tentativas, eventos outbox, eventos Stripe, resend, signing key, sweeps
- [x] 2.4 Amarrar cada schema ao tipo TypeScript do serviço com `satisfies z.ZodType<...>` onde o tipo existir

## 3. Registro de operações

- [x] 3.1 Operações de instalação e sessão: `GET/POST /install/{appCode}`, `POST /v1/install`, `POST /v1/install/retry`, `POST /bitrix/events/{appCode}`, `GET /.well-known/jwks.json`, `POST /v1/sessions` (com nota do preflight CORS)
- [x] 3.2 Operações servidor-a-servidor de instalações e tokens: `GET /v1/installations`, `GET /v1/installations/{id}`, `GET /v1/installations/{id}/token`, `POST /v1/installations/{id}/token/refresh`
- [x] 3.3 Operações de cobrança: `/v1/plans`, subscription, checkout-sessions, billing-portal-sessions, change-plan, items (GET/POST/PATCH/DELETE)
- [x] 3.4 Webhooks recebidos e infraestrutura: `POST /webhooks/stripe` (corpo cru), `POST /bitrix/spa-events`, `/health`, `/health/ready`, `/metrics`
- [x] 3.5 Operações de operador: `/admin/apps*`, rotações, `POST /v1/installations/{id}/trial`, attempts, events, stripe-events, resend, signing-keys/rotate, sweeps/{kind}
- [x] 3.6 Listar em cada operação os códigos de erro do catálogo que ela pode devolver (conferindo serviços chamados)

## 4. Eventos de saída

- [x] 4.1 Schemas do envelope (`eventId`, `type`, `appCode`, `installationId`, `memberId`, `occurredAt`, `subscription`, `data`) e dos headers `X-Platform-Signature`, `X-Platform-Event-Id`, `X-Platform-Event-Type`
- [x] 4.2 Schema de `data` para cada tipo de `INSTALLATION_EVENT_TYPES` e `BILLING_EVENT_TYPES`, na seção `webhooks`
- [x] 4.3 Documentar a chamada síncrona ao instalador do app (`installerUrl`): corpo, assinatura, timeout e respostas esperadas

## 5. Geração e publicação

- [x] 5.1 `scripts/generate-openapi.ts` + `yarn docs:openapi`: grava `docs/api/openapi-admin.json`, `docs/api/openapi.json` (sem tag `Operador`) e a tabela gerada de `docs/technical/error-codes.md`
- [x] 5.2 Rotas `GET /openapi.json` (servers = `PUBLIC_BASE_URL`, cache 300 s) e `GET /docs` (HTML com Scalar via jsDelivr, versão fixada) em `src/app.ts`, antes do `appApi`; registrar ambas no próprio contrato
- [x] 5.3 Gerar e versionar os arquivos de `docs/api/`

## 6. Testes de deriva

- [x] 6.1 Função de introspecção de rotas (`app._router.stack`, routers aninhados, `:id` → `{id}`) com teste próprio
- [x] 6.2 Teste de cobertura: rotas de `createApp` == operações do contrato completo (ignora `OPTIONS /v1/sessions` e fallback 404); verificar que `/openapi-admin.json` não é servido (401/404, como qualquer rota inexistente)
- [x] 6.3 Teste de sincronia dos arquivos de `docs/api/` e de `error-codes.md` com mensagem `rode yarn docs:openapi`
- [x] 6.4 Teste do catálogo de erros: varredura de `src/**/*.ts` por códigos literais; falha também em código não literal
- [x] 6.5 Teste de eventos: chaves de `webhooks` == tipos de evento do domínio + instalador
- [x] 6.6 Teste estrutural do documento: `openapi: 3.1.x`, `operationId` únicos, `$ref` resolvíveis
- [x] 6.7 Hook em `http(h)` (`src/test/app.ts`) que valida o corpo da resposta com o schema da operação/status; corrigir schemas ou testes até a suíte passar
- [x] 6.8 Teste de fumaça (`contract-smoke.test.ts`) para as rotas que os testes de domínio não exercitam (health, métricas, página de instalação, itens, operador)

## 7. Documentação técnica

- [x] 7.1 `docs/technical/README.md`: público, índice com resumo de cada documento, ordem de leitura, link para `/docs` e `docs/api/`
- [x] 7.2 `architecture.md`: processos `api`/`worker`, módulos e portas, `bootstrap`/`container`, diagrama de componentes
- [x] 7.3 `request-lifecycle.md`: request id, contexto de log, ordem de montagem, parsers por rota (por que sem parser global), autenticação, `asyncHandler`, erros e 404, diagrama
- [x] 7.4 `security.md`: chave de API (hash), tokens de operador, AES-256-GCM `v1:`, HMAC e janela de 5 min, rotação com carência, JWT/JWKS, Stripe, CORS da sessão, o que nunca é logado
- [x] 7.5 `data-model.md`: cada modelo Prisma (propósito, relações, campos cifrados) com diagrama ER Mermaid
- [x] 7.6 `installation-and-tokens.md` e `iframe-session.md`: diagramas de sequência de instalação, retry, eventos do Bitrix, cofre de tokens, sessão e rotação de chave
- [x] 7.7 `billing.md`: checkout, webhooks Stripe, espelho nos SPAs, eventos dos SPAs, varreduras, trial, compras avulsas, reembolsos e disputas
- [x] 7.8 `async-processing.md`: filas e agendamentos do worker (frequência, concorrência, idempotência), outbox, retries, dead-letter e reenvio
- [x] 7.9 `observability.md`: campos de log, Loki, métricas Prometheus, `/health` vs `/health/ready`, alertas de `ops/prometheus-alerts.yml`
- [x] 7.10 `configuration.md`: todas as variáveis de `src/config/env.ts` (obrigatória, padrão, efeito) + teste que falha se faltar alguma

## 8. Integração com a documentação existente

- [x] 8.1 `docs/apps-integration.md`: links para a referência em cada seção e nota de que `/docs`/`docs/api/openapi.json` são a fonte oficial dos campos e códigos
- [x] 8.2 `README.md`: seção Documentação com referência da API, `/docs`, `yarn docs:openapi` e `docs/technical/`
- [x] 8.3 Rodar `yarn lint`, `yarn check-types` e `yarn test` e confirmar tudo verde
