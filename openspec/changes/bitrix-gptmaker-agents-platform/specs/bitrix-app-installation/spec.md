## ADDED Requirements

### Requirement: Instalação delegada ao crmthink-platform
O sistema MUST delegar ao `crmthink-platform` (módulo `installations`) a instalação do app Bitrix24, a verificação da instalação junto ao Bitrix, o armazenamento e a renovação dos tokens OAuth, o `application_token` e a desinstalação. A URL de instalação do app no Bitrix MUST apontar para a página de instalação da plataforma (`/install/crmthink.gptmaker`). O sistema MUST NOT armazenar `access_token`, `refresh_token`, `client_secret` nem renovar tokens.

#### Scenario: Instalação iniciada no Bitrix
- **WHEN** um administrador instala o app no portal
- **THEN** o Bitrix abre a página de instalação da plataforma, que verifica a instalação, chama o instalador do app e conclui com `installFinish`

### Requirement: Instalador do app
O sistema MUST expor o endpoint de instalador chamado de forma síncrona pela plataforma, validar a assinatura HMAC da requisição e, de forma idempotente, criar ou reativar o tenant pelo `installationId`/`member_id`, gerar o `tenantCode` na primeira instalação e registrar os handlers de eventos do app no portal usando o token obtido da plataforma. O instalador MUST responder em até 60 segundos.

#### Scenario: Primeira instalação
- **WHEN** a plataforma chama o instalador com `isReinstall = false`
- **THEN** o sistema cria o tenant com status `ACTIVE`, gera o `tenantCode`, registra os handlers de eventos e responde 2xx; nenhum trial é criado na instalação: o tenant ativa o trial pelo formulário de cadastro (ver `payments-integration`)

#### Scenario: Reinstalação de portal existente
- **WHEN** a plataforma chama o instalador com `isReinstall = true`
- **THEN** o sistema reativa o tenant existente, registra novamente os handlers e os chatbots dos agentes ativos, e preserva histórico de agentes, ledger e saldo

#### Scenario: Falha parcial de registro
- **WHEN** o registro de algum handler falha
- **THEN** o instalador responde erro com identificador de rastreio, a plataforma mantém a instalação em `INSTALL_PENDING` e a nova tentativa pela página de instalação reexecuta o instalador sem duplicar registros

#### Scenario: Chamada sem assinatura válida
- **WHEN** o endpoint de instalador recebe requisição com assinatura HMAC inválida
- **THEN** o sistema responde 401 sem criar ou alterar tenant

### Requirement: Tokens obtidos da plataforma
O sistema MUST obter o `access_token` do portal pela API de tokens da plataforma, mantê-lo em cache até 5 minutos antes do vencimento e, ao receber `expired_token` do Bitrix, pedir renovação à plataforma informando o token vencido e repetir a chamada original uma única vez.

#### Scenario: Token expirado durante chamada
- **WHEN** uma chamada à API Bitrix retorna `expired_token`
- **THEN** o sistema chama `POST /v1/installations/{id}/token/refresh` com o token vencido, atualiza o cache e repete a chamada original

#### Scenario: Plataforma indisponível com token em cache
- **WHEN** a plataforma não responde e o token em cache ainda é válido
- **THEN** o sistema continua usando o token em cache e registra alerta

#### Scenario: Erro de autorização do portal
- **WHEN** chega o evento `installation.auth_error`
- **THEN** o tenant fica `AUTH_ERROR`, o processamento de mensagens do tenant é pausado e o app exibe aviso de reautorização; ao chegar `installation.auth_restored`, o processamento é retomado

### Requirement: Desinstalação do app
O sistema MUST tratar o evento `installation.removed` da plataforma marcando o tenant como `UNINSTALLED`, inativando os agentes no GPTMaker e descartando o cache de tokens.

#### Scenario: Desinstalação
- **WHEN** chega `installation.removed` com assinatura válida
- **THEN** o tenant fica `UNINSTALLED`, todos os agentes do tenant são inativados no GPTMaker e o cache de tokens do tenant é removido

### Requirement: Validação de eventos do Bitrix
O sistema MUST validar o `application_token` de todo evento recebido do portal (mensagens do chatbot e demais eventos do app) contra o `application_token` da instalação obtido da plataforma (`GET /v1/installations/{id}`, em cache), em comparação de tempo constante.

#### Scenario: Evento com token inválido
- **WHEN** um evento do Bitrix chega com `application_token` divergente
- **THEN** o sistema rejeita o evento sem processar e registra alerta de segurança

### Requirement: Autenticação do usuário no iframe
O sistema MUST autenticar o usuário que abre o app no Bitrix pela sessão emitida pela plataforma: o frontend obtém `BX24.getAuth()`, troca por um JWT em `POST /v1/sessions` da plataforma e envia o JWT ao backend, que valida localmente assinatura (JWKS da plataforma), emissor, audiência `crmthink.gptmaker` e expiração. Identidade e flag de administrador MUST vir somente do JWT.

#### Scenario: Acesso válido
- **WHEN** o frontend apresenta JWT válido emitido pela plataforma
- **THEN** o backend identifica tenant, usuário e flag de administrador do portal a partir das claims

#### Scenario: JWT expirado
- **WHEN** o JWT expira durante o uso
- **THEN** o frontend obtém nova autenticação do BX24 e troca por novo JWT sem interromper o usuário

#### Scenario: Acesso sem autenticação
- **WHEN** a API é chamada sem JWT, com JWT inválido ou de outra audiência
- **THEN** o sistema responde 401 e não expõe dados de nenhum tenant

### Requirement: Permissão de administração do app
O sistema MUST restringir ações de criação, edição, inativação, treinamento e gatilhos a usuários administradores do portal ou a usuários explicitamente autorizados pelo administrador.

#### Scenario: Usuário sem permissão
- **WHEN** um usuário não autorizado tenta alterar um agente
- **THEN** o sistema responde 403 e a interface exibe o agente em modo somente leitura
