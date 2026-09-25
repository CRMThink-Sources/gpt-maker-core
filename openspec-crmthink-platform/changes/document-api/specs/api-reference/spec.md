## ADDED Requirements

### Requirement: Contrato OpenAPI gerado do código
O sistema MUST produzir um documento OpenAPI 3.1 a partir do próprio código, reutilizando os schemas zod de validação das rotas para os corpos e parâmetros de entrada e schemas zod de resposta mantidos junto do registro de operações. Cada operação MUST ter `operationId` estável, tag por área (`Instalação`, `Sessão`, `Tokens`, `Cobrança`, `Webhooks recebidos`, `Infraestrutura`, `Operador`), descrição em pt-br, parâmetros de caminho e query, corpo de requisição com `content-type` real da rota (JSON, `form-urlencoded` ou corpo cru), respostas de sucesso com schema e respostas de erro com os códigos estáveis que a rota pode devolver.

#### Scenario: Gerar o contrato
- **WHEN** um desenvolvedor executa `yarn docs:openapi`
- **THEN** o sistema grava `docs/api/openapi.json` (sem rotas de operador) e `docs/api/openapi-admin.json` (todas as rotas), ambos OpenAPI 3.1 válidos, com saída determinística (mesma entrada gera bytes idênticos)

#### Scenario: Schema de entrada reaproveitado
- **WHEN** o schema zod `checkoutRequestSchema` ganha um campo novo
- **THEN** o contrato regenerado passa a descrever o campo em `POST /v1/checkout-sessions` sem edição manual da documentação

#### Scenario: Rota com corpo não-JSON
- **WHEN** o contrato descreve `POST /webhooks/stripe` e `POST /bitrix/events/{appCode}`
- **THEN** o corpo aparece respectivamente como bytes crus (`application/octet-stream`/`application/json` assinado) e como `application/x-www-form-urlencoded`

### Requirement: Esquemas de segurança descritos
O contrato MUST declarar os esquemas de segurança e aplicá-los por operação: `appApiKey` (Bearer com chave de API do app) nas rotas servidor-a-servidor, `adminToken` (Bearer de operador) em `/admin/*` e `POST /v1/installations/{id}/trial`, verificação por `Stripe-Signature` no webhook do Stripe, autenticação do Bitrix (`auth` do evento) nos eventos do Bitrix, e ausência de autenticação (com a restrição de origem CORS descrita) em `POST /v1/sessions`, página de instalação, `POST /v1/install`, JWKS e health.

#### Scenario: Rota servidor-a-servidor
- **WHEN** um leitor consulta `GET /v1/installations/{id}/token` no contrato
- **THEN** a operação exige `appApiKey` e lista as respostas 401 (`UNAUTHORIZED`), 403 (`APP_INACTIVE`) e 404 (`INSTALLATION_NOT_FOUND`)

#### Scenario: Rota de operador
- **WHEN** um leitor consulta `POST /admin/apps`
- **THEN** a operação exige `adminToken`, consta apenas em `openapi-admin.json` e a descrição avisa que `apiKey` e `webhookSecret` só aparecem nessa resposta

### Requirement: Envelope de erro e catálogo de códigos
O contrato MUST definir um componente único para o envelope de erro `{ error: { code, message, details? } }`, incluindo o formato de `details` de `VALIDATION_ERROR` (`[{ path, message }]`), e MUST listar em cada operação os códigos estáveis que ela pode devolver. O sistema MUST manter um catálogo de códigos de erro (código, status HTTP, significado, ação esperada do app) e MUST falhar os testes se um código lançado no código-fonte não estiver no catálogo.

#### Scenario: Código novo sem catálogo
- **WHEN** um desenvolvedor adiciona `conflict('ITEM_LOCKED')` em um serviço sem registrar o código no catálogo
- **THEN** a suíte de testes falha apontando `ITEM_LOCKED`

#### Scenario: Erro de validação
- **WHEN** um leitor consulta qualquer operação com corpo JSON
- **THEN** a resposta 400 `VALIDATION_ERROR` aparece referenciando o componente de erro com `details` de validação

### Requirement: Eventos de saída documentados
O contrato MUST documentar, na seção `webhooks` do OpenAPI, os eventos que a plataforma envia ao `webhookUrl` de cada app: o envelope (`eventId`, `type`, `appCode`, `installationId`, `memberId`, `occurredAt`, `subscription`, `data`), os headers `X-Platform-Signature`, `X-Platform-Event-Id` e `X-Platform-Event-Type`, o schema de `data` de cada tipo de evento e a resposta esperada do app (2xx). A chamada síncrona ao instalador do app (`installerUrl`) MUST ser documentada do mesmo modo.

#### Scenario: Tipo de evento novo
- **WHEN** o código passa a emitir um tipo de evento que não está no contrato
- **THEN** a suíte de testes falha apontando o tipo ausente

#### Scenario: Consulta de evento
- **WHEN** um leitor consulta `subscription.plan_changed` no contrato
- **THEN** encontra o schema de `data` com `previousPlanId`, `planId`, `effective` (`immediate`|`next_period`) e `remainingFraction` opcional

### Requirement: Cobertura total das rotas
O sistema MUST garantir por teste que o conjunto de pares método+caminho montados em `createApp` é igual ao conjunto de operações do contrato completo (`openapi-admin.json`), ignorando apenas `OPTIONS` de preflight explícito e o fallback 404.

#### Scenario: Rota nova sem documentação
- **WHEN** um desenvolvedor adiciona `GET /v1/purchases` ao router sem registrar a operação
- **THEN** o teste de cobertura falha listando a rota não documentada

#### Scenario: Operação órfã
- **WHEN** uma rota é removida do router mas continua no registro de operações
- **THEN** o teste de cobertura falha listando a operação sem rota

### Requirement: Arquivo versionado sincronizado
O sistema MUST falhar os testes quando `docs/api/openapi.json` ou `docs/api/openapi-admin.json` versionados diferirem do resultado da geração atual.

#### Scenario: Esqueceu de regenerar
- **WHEN** um schema de rota muda e o desenvolvedor não executa `yarn docs:openapi`
- **THEN** o teste de sincronia falha e indica o comando a executar

### Requirement: Respostas conferidas com o contrato
Os testes de integração HTTP existentes MUST validar o corpo das respostas das rotas documentadas contra o schema de resposta do contrato para o status recebido.

#### Scenario: Resposta diverge do contrato
- **WHEN** um serviço passa a devolver `trialEndsAt` como número em vez de string ISO
- **THEN** o teste de integração da rota falha com o caminho do campo divergente

### Requirement: Contrato servido pela API
A API MUST servir `GET /openapi.json` com o contrato sem rotas de operador e `GET /docs` com uma página HTML navegável desse contrato, ambos sem autenticação e com cache curto. O contrato de operador MUST NOT ser servido pela API.

#### Scenario: Time de app consulta a referência
- **WHEN** alguém abre `https://<plataforma>/docs`
- **THEN** vê as operações públicas, servidor-a-servidor e os eventos, com `servers` apontando para `PUBLIC_BASE_URL`, e nenhuma rota `/admin/*`

#### Scenario: Tentativa de obter contrato de operador
- **WHEN** alguém requisita `GET /openapi-admin.json` na API
- **THEN** não recebe o contrato: a rota não existe (401 sem chave de API, 404 com chave, como qualquer rota inexistente)
