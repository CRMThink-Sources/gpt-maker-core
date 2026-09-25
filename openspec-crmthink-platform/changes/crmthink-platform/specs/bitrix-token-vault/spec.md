## ADDED Requirements

### Requirement: Entrega de token aos apps
O sistema MUST expor `GET /v1/installations/{id}/token` retornando `{accessToken, expiresAt, domain, clientEndpoint}` da instalação, restrito ao `appCode` da chave de API, para que o app chame o Bitrix diretamente. Os apps SHOULD guardar o token em cache até `expiresAt - 5 minutos`.

#### Scenario: Token válido
- **WHEN** o app pede o token de uma instalação `ACTIVE`
- **THEN** o sistema retorna o access token vigente e sua expiração

#### Scenario: Instalação desinstalada
- **WHEN** o app pede o token de uma instalação `UNINSTALLED`
- **THEN** o sistema responde 410 sem token

#### Scenario: Instalação em erro de autenticação
- **WHEN** o app pede o token de uma instalação `AUTH_ERROR`
- **THEN** o sistema responde 409 com o código `AUTH_ERROR`

### Requirement: Renovação sob demanda com single-flight
O sistema MUST expor `POST /v1/installations/{id}/token/refresh` com `{staleAccessToken}`, usado quando o Bitrix responde `expired_token`. Se o token guardado já for diferente do informado, o sistema MUST devolver o guardado sem renovar; senão MUST renovar via `oauth.bitrix.info` sob lock distribuído por instalação, garantindo uma única renovação por vez.

#### Scenario: Pedidos concorrentes
- **WHEN** três processos do app pedem renovação ao mesmo tempo com o mesmo token vencido
- **THEN** o sistema faz uma única renovação no Bitrix e devolve o mesmo token novo aos três

#### Scenario: Token já renovado
- **WHEN** o app pede renovação com um token que já foi substituído
- **THEN** o sistema devolve o token atual sem chamar o Bitrix

### Requirement: Renovação em segundo plano
O sistema MUST renovar, por job, os tokens que vencem em menos de 10 minutos, sob o mesmo lock por instalação. Somente a plataforma MUST renovar tokens, já que o Bitrix rotaciona o refresh_token. Após 5 falhas seguidas de uma instalação, o sistema MUST marcá-la `AUTH_ERROR` e emitir `installation.auth_error`; quando os tokens voltarem a funcionar (reinstalação ou reautorização), MUST voltar a `ACTIVE` e emitir `installation.auth_restored`.

#### Scenario: Renovação antecipada
- **WHEN** um token vence em 8 minutos
- **THEN** o job o renova e grava o novo access token, refresh token e expiração

#### Scenario: Falhas repetidas
- **WHEN** a renovação de uma instalação falha 5 vezes seguidas
- **THEN** a instalação fica `AUTH_ERROR` e `installation.auth_error` é emitido com o último erro

#### Scenario: Reautorização
- **WHEN** uma instalação `AUTH_ERROR` é reinstalada com sucesso
- **THEN** a instalação volta a `ACTIVE` e `installation.auth_restored` é emitido

### Requirement: Cifragem em repouso
O sistema MUST guardar access tokens, refresh tokens, `application_token`, `client_secret` dos apps e segredos HMAC cifrados com AES-256-GCM, com chave fora do banco (variável de ambiente) e formato versionado (`v1:`), e MUST NOT registrar tokens em logs. O sistema MUST falhar na inicialização se a chave de cifragem não estiver configurada.

#### Scenario: Leitura direta do banco
- **WHEN** alguém lê a tabela de credenciais sem a chave
- **THEN** nenhum token ou segredo é legível

#### Scenario: Chave ausente
- **WHEN** a plataforma inicia sem chave de cifragem
- **THEN** o processo não sobe e registra o motivo
