## ADDED Requirements

### Requirement: Criação de sessão verificada no servidor
O sistema MUST expor `POST /v1/sessions` recebendo `{appCode, accessToken, domain, memberId}` do `BX24.getAuth()`, com CORS liberado apenas para as origens configuradas por variável de ambiente (`SESSION_CORS_ORIGINS`, lista por ambiente) e ainda restrito às origens associadas ao `appCode` na mesma configuração. O sistema MUST chamar `user.current` e `user.admin` com esse token no domínio informado e conferir que o `member_id` corresponde a uma instalação `ACTIVE` do `appCode`. Identidade e condição de admin MUST vir somente do Bitrix, nunca do navegador.

#### Scenario: Usuário comum
- **WHEN** um usuário não administrador abre o app e o frontend chama `POST /v1/sessions`
- **THEN** o sistema emite a sessão com `isAdmin = false`, conforme `user.admin`

#### Scenario: Tentativa de se passar por admin
- **WHEN** o navegador envia campos extras dizendo que o usuário é admin
- **THEN** os campos são ignorados e `isAdmin` reflete apenas a resposta de `user.admin`

#### Scenario: Instalação inexistente ou inativa
- **WHEN** o `member_id` não corresponde a uma instalação `ACTIVE` do app
- **THEN** o sistema responde 403 sem emitir sessão

#### Scenario: Origem não cadastrada
- **WHEN** a chamada vem de uma origem fora da lista configurada para o app
- **THEN** o navegador bloqueia a resposta por CORS e o sistema não emite sessão

### Requirement: JWT RS256 de curta duração
O sistema MUST emitir JWT assinado com RS256, validade de 15 minutos, com as claims `iss`, `aud` (= `appCode`), `sub` (= id do usuário Bitrix), `installationId`, `memberId`, `domain`, `isAdmin`, `name`, `departmentIds` e `exp`. A renovação MUST ser um novo `POST /v1/sessions` com o auth atualizado do BX24. O sistema MUST falhar na inicialização se não houver chave de assinatura ativa.

#### Scenario: Sessão expirada
- **WHEN** o app recebe um JWT com `exp` no passado
- **THEN** o app rejeita a requisição e o frontend cria nova sessão com o auth atual do BX24

#### Scenario: Token de outro app
- **WHEN** o app GPTMaker recebe um JWT com `aud = crmthink.thinkzap`
- **THEN** o app rejeita o token

### Requirement: JWKS com rotação de chaves
O sistema MUST publicar as chaves públicas em `/.well-known/jwks.json` com `kid`, permitir rotação publicando a nova chave antes de assinar com ela e manter a chave anterior publicada até expirarem os tokens emitidos com ela. Os apps MUST validar assinatura, `iss`, `aud` e `exp` localmente.

#### Scenario: Rotação de chave
- **WHEN** um operador rotaciona a chave de assinatura
- **THEN** a nova chave aparece no JWKS antes do primeiro token assinado com ela, e a antiga continua publicada por pelo menos 15 minutos depois da troca

#### Scenario: App com JWKS em cache
- **WHEN** o app recebe um JWT com `kid` desconhecido no seu cache
- **THEN** o app recarrega o JWKS e valida o token
