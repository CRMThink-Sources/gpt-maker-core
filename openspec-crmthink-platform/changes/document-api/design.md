## Context

A plataforma é um Express 4 (`src/app.ts`) com rotas agrupadas por módulo (`installations/http/routes.ts`, `billing/http/routes.ts`, `registry/http/admin-routes.ts`) e validação de entrada por zod 4 (`installRequestSchema`, `checkoutRequestSchema`, `createItemSchema`, ...). As respostas não têm schema: são objetos montados pelos serviços. Erros saem por `HttpError` + `errorMiddleware` (`src/shared/http/errors.ts`) com envelope `{ error: { code, message, details } }`. Os tipos de evento aos apps estão em `src/modules/events/domain/event.ts` (`INSTALLATION_EVENT_TYPES`, `BILLING_EVENT_TYPES`). Os testes HTTP usam supertest via `src/test/app.ts` (`http(h)`).

Hoje o único documento de contrato é `docs/apps-integration.md` (guia narrativo para times de app). Não há documento de arquitetura. Públicos: times dos apps (GPTMaker, ThinkZap, ...) → referência da API; quem mantém/opera a plataforma → documentação técnica.

## Goals / Non-Goals

**Goals:**
- Referência OpenAPI 3.1 completa e confiável, que não envelhece em silêncio (testes de deriva).
- Reusar os schemas zod existentes; zero dependência nova em runtime.
- Documentação técnica navegável no GitHub (Markdown + Mermaid), apontando para o código.
- Uma fonte única para o catálogo de erros e os tipos de evento.

**Non-Goals:**
- Mudar comportamento, status ou formato de qualquer rota.
- Validar respostas em runtime na produção.
- Gerar SDK a partir do OpenAPI (os SDKs de `sdk/` continuam manuais).
- Portal de documentação externo (GitBook, site estático); `/docs` na própria API basta por ora.
- Traduzir a documentação para outros idiomas.

## Decisions

### 1. Code-first com registro explícito de operações
`src/docs/openapi/` terá um registro (`operations.ts`) com uma entrada por rota: `method`, `path` (formato OpenAPI `{id}`), `operationId`, `tag`, `summary/description`, `security`, `request` (schema zod importado da aplicação), `responses` (status → schema zod de resposta ou componente de erro) e `errors` (códigos do catálogo). `build.ts` monta o documento com `z.toJSONSchema()` (nativo do zod 4, alvo `draft-2020-12`, compatível com OpenAPI 3.1).

- *Alternativa: YAML escrito à mão.* Descartado: duplica os schemas de entrada e diverge.
- *Alternativa: `@asteasolutions/zod-to-openapi` ou `express-openapi-validator`.* Descartado: dependência nova, e a primeira ainda não acompanha totalmente o zod 4; `z.toJSONSchema` resolve.
- *Alternativa: decorar as rotas Express com metadados.* Descartado: mistura documentação no router e o Express 4 não expõe metadados de forma limpa; o teste de cobertura (decisão 4) já garante o vínculo.

### 2. Schemas de resposta em zod, usados só em documentação e testes
`src/docs/openapi/responses.ts` define os schemas de resposta (`installationSchema`, `tokenResponseSchema`, `subscriptionSchema`, `planSchema`, `checkoutSessionSchema`, `itemSchema`, ...). Não entram no caminho de runtime. Onde os serviços já têm tipos TypeScript, o schema recebe `satisfies z.ZodType<Tipo>` para o compilador acusar divergência estrutural.

Schemas zod hoje locais às rotas (`refreshSchema`, `resendSchema`, schema de `leadMinutes`) passam a ser exportados — mudança puramente de visibilidade.

### 3. Dois documentos gerados e versionados
`scripts/generate-openapi.ts` (`yarn docs:openapi`) grava `docs/api/openapi-admin.json` (tudo) e `docs/api/openapi.json` (sem tag `Operador`). JSON com chaves ordenadas e indentação fixa → diffs legíveis em PR e geração determinística. Versionar o arquivo permite revisar mudanças de contrato no diff e consumir o contrato sem subir a API.

- *Alternativa: gerar só em runtime.* Descartado: perde a revisão por diff.

### 4. Testes de deriva
Em `src/docs/openapi/openapi.test.ts`:
- **Cobertura de rotas**: percorre `app._router.stack` (incluindo routers aninhados, como o `appApi`) de uma instância de `createApp` do harness, normaliza `:id` → `{id}` e compara com o registro. Ignora `OPTIONS /v1/sessions` (preflight; documentado como nota em `POST /v1/sessions`) e o fallback 404.
- **Sincronia de arquivo**: gera em memória e compara com os arquivos de `docs/api/`; falha com a mensagem `rode yarn docs:openapi`.
- **Catálogo de erros**: varre `src/**/*.ts` (fora testes) por `badRequest|forbidden|notFound|conflict|gone|unprocessable|upstream('CODE'`, `new HttpError(n, 'CODE'`, `intParam(..., 'CODE')` e objetos `{ code: 'CODE' }` literais nas rotas; todo código encontrado precisa estar em `src/docs/errors.ts`. Códigos implícitos (`UNAUTHORIZED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `NOT_FOUND`) são registrados à mão.
- **Eventos**: as chaves de `webhooks` precisam ser iguais a `INSTALLATION_EVENT_TYPES ∪ BILLING_EVENT_TYPES` (+ `installer`).
- **Validade**: checagem estrutural mínima do documento (versão, `operationId` únicos, `$ref` resolvíveis) sem dependência nova.
- **Variáveis de ambiente**: as chaves do schema de `src/config/env.ts` (exportar o `schema`) precisam aparecer em `docs/technical/configuration.md`.

### 5. Respostas validadas nos testes de integração
`http(h)` em `src/test/app.ts` ganha um hook opcional: após cada resposta, localiza a operação pelo método+caminho e faz `schema.safeParse(body)` do status recebido; em falha lança erro com os `issues`. Ligado por padrão; testes que montam respostas propositalmente inválidas podem desligar. Evita ajv: os schemas já são zod.

### 6. Catálogo de erros como fonte única
`src/docs/errors.ts`: `code → { status, meaning, appAction, origin }`. O build do OpenAPI usa o catálogo para montar as respostas de erro de cada operação e `docs/technical/error-codes.md` é **gerado** pelo mesmo script (tabela Markdown entre marcadores), para não existir cópia manual.

### 7. `/openapi.json` e `/docs` servidos pela API
Rotas montadas antes do `appApi` (sem auth), `Cache-Control: public, max-age=300`. `/openapi.json` serve o documento público construído no boot com `servers: [{ url: PUBLIC_BASE_URL }]`. `/docs` é um HTML mínimo que carrega o Scalar API Reference via jsDelivr com versão fixada e aponta para `/openapi.json`. Contrato de operador não é servido (evita expor superfície administrativa); fica em `docs/api/openapi-admin.json`.

- *Alternativa: Swagger UI via `swagger-ui-express`.* Descartado: dependência em runtime.
- *Alternativa: Redoc.* Viável; Scalar escolhido por ter "try it" e webhooks bem renderizados. Trocar é uma linha.

### 8. Estrutura da documentação técnica
`docs/technical/`: `README.md` (índice), `architecture.md`, `request-lifecycle.md`, `security.md`, `data-model.md`, `installation-and-tokens.md`, `iframe-session.md`, `billing.md`, `async-processing.md`, `observability.md`, `configuration.md`, `error-codes.md` (gerado). Diagramas em Mermaid (renderiza no GitHub). Cada documento abre com "Código:" listando os arquivos-fonte. O guia `docs/apps-integration.md` continua sendo o documento para os apps; passa a linkar a referência em vez de ser a fonte dos campos.

## Risks / Trade-offs

- [Schemas de resposta divergem do que os serviços devolvem] → validação nos testes de integração (decisão 5) + `satisfies` com os tipos dos serviços.
- [Introspecção de `app._router.stack` é API interna do Express 4] → isolada em uma função com teste próprio; na migração para Express 5 (`app.router`) só ela muda.
- [Varredura de códigos de erro por regex perde casos dinâmicos] → códigos são sempre literais no código atual; o teste também falha se encontrar chamada com código não literal, forçando literal.
- [`/docs` depende de CDN] → só afeta a visualização; `/openapi.json` e os arquivos versionados funcionam sem ela. Versão fixada evita quebra por atualização.
- [Custo de manutenção: toda rota nova exige entrada no registro] → é o objetivo; o teste de cobertura torna o passo impossível de esquecer.
- [Documentação técnica envelhece] → testes cobrem as partes mecânicas (env, erros, eventos, rotas); o restante é revisado junto das mudanças, com links para o código.

## Migration Plan

Aditivo, sem migração de dados. Deploy normal; `/openapi.json` e `/docs` passam a responder. Rollback: reverter o commit (nenhum consumidor depende das rotas novas).

## Open Questions

- `/docs` deve ficar acessível em produção ou só em homolog? Padrão proposto: ambos (o contrato público não contém segredos).
- Publicar o contrato também em um portal externo (GitBook) no futuro?
