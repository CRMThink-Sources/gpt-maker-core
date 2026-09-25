## ADDED Requirements

### Requirement: Página de instalação por app
O sistema MUST servir a página `/install/{appCode}`, usada como URL de instalação do app no Bitrix24, com identidade própria de cada app definida no cadastro (nome, logotipo, cores, título e texto de boas-vindas, link e texto dos termos de uso). O fluxo e as validações MUST ser os mesmos para todos os apps; só a apresentação muda. A página MUST ter apenas o botão "Instalar", sem formulário (o marketplace do Bitrix não aceita coleta de dados do cliente na instalação), com o aviso de que clicar aceita os termos de uso. A página MUST aceitar GET e POST (o Bitrix abre o app por POST). O clique MUST enviar `POST /v1/install` com `{appCode, auth: {accessToken, refreshToken, expiresIn, memberId, domain}, acceptedTerms}` obtido de `BX24.getAuth()` e a página só MUST chamar `BX24.installFinish()` quando a instalação ficar `ACTIVE`. A instalação MUST NOT coletar dados do cliente (e-mail, nome, telefone, empresa), nem pelo navegador nem pela API do Bitrix.

#### Scenario: Instalação concluída
- **WHEN** o administrador do portal clica em "Instalar" e a instalação fica `ACTIVE`
- **THEN** a página exibe a conclusão e chama `BX24.installFinish()`

#### Scenario: Identidade do app
- **WHEN** o Bitrix abre `/install/crmthink.gptmaker`
- **THEN** a página exibe logotipo, cores, textos e termos do GPTMaker, e não os de outro app

#### Scenario: App sem identidade cadastrada
- **WHEN** um app não tem cores ou textos cadastrados
- **THEN** a página usa o tema padrão da plataforma com nome e logotipo do app

#### Scenario: Termos não aceitos
- **WHEN** `POST /v1/install` chega sem `acceptedTerms: true`
- **THEN** o sistema recusa com erro de validação e nada é gravado

#### Scenario: App desconhecido ou inativo
- **WHEN** a página é aberta com um `appCode` não cadastrado ou inativo
- **THEN** a página exibe erro e nenhuma instalação é criada

### Requirement: Verificação da instalação no servidor
O sistema MUST NOT confiar em dados de identidade enviados pelo navegador. Antes de gravar a instalação, MUST chamar `app.info` e `profile` no domínio informado com o access token recebido, exigir que o `member_id` e o `client_id` do app retornados batam com o informado e com o app cadastrado, e normalizar a expiração do token (TTL, epoch em segundos ou em milissegundos).

#### Scenario: Token de outro app
- **WHEN** o access token enviado pertence a um app Bitrix diferente do `appCode` da página
- **THEN** o sistema recusa a instalação com 403 e registra a tentativa

#### Scenario: member_id divergente
- **WHEN** o `member_id` retornado pelo Bitrix difere do enviado pelo navegador
- **THEN** o sistema recusa a instalação com 403 e nada é gravado

#### Scenario: Bitrix indisponível na verificação
- **WHEN** `app.info` ou `profile` falham por indisponibilidade
- **THEN** o sistema responde erro recuperável e a página oferece nova tentativa

### Requirement: Registro da instalação e espelho no SPA 1060
O sistema MUST fazer upsert da instalação por (`appCode`, `memberId`) com status `INSTALLING`, tokens cifrados e domínio, fazer upsert do item no SPA 1060 (Instalações) com `APP_CODE`, `DOMAIN`, `MEMBER_ID`, contato e Ambiente, e usar o id desse item como `installationId`. O mesmo portal em apps diferentes MUST gerar instalações distintas.

#### Scenario: Primeira instalação
- **WHEN** um portal instala pela primeira vez um app cadastrado
- **THEN** o sistema cria a instalação e o item no SPA 1060 e usa o id do item como `installationId`

#### Scenario: Mesmo portal em apps diferentes
- **WHEN** o mesmo `memberId` instala `crmthink.thinkzap` e `crmthink.gptmaker`
- **THEN** existem duas instalações e dois itens distintos no SPA 1060

#### Scenario: Item removido manualmente do SPA
- **WHEN** chega `onCrmDynamicItemDelete` de um item do SPA 1060 com instalação vinculada
- **THEN** a instalação é desvinculada, chamadas de apps para aquele `installationId` respondem 404 e o vínculo é recriado na próxima reinstalação

### Requirement: Instalador do app
Após registrar a instalação, o sistema MUST fazer `event.bind` de `ONAPPUNINSTALL` para `POST /bitrix/events/{appCode}` e chamar o instalador do app de forma síncrona (`POST <installer_url>`, assinado com o mesmo esquema HMAC dos eventos) com `{installationId, memberId, domain, appCode, isReinstall}` e timeout de 60 segundos. Resposta 2xx MUST levar a instalação a `ACTIVE`; erro ou timeout MUST levar a `INSTALL_PENDING`, com opção na página de tentar novamente, que reexecuta apenas o instalador. Cada tentativa MUST ser registrada.

#### Scenario: Instalador conclui
- **WHEN** o instalador do app responde 2xx
- **THEN** a instalação fica `ACTIVE`

#### Scenario: Instalador falha
- **WHEN** o instalador do app responde erro ou excede 60 segundos
- **THEN** a instalação fica `INSTALL_PENDING`, a página mostra "tentar novamente" e `BX24.installFinish()` não é chamado

#### Scenario: Nova tentativa
- **WHEN** o administrador clica em "tentar novamente" numa instalação `INSTALL_PENDING`
- **THEN** o sistema chama apenas o instalador de novo e, com 2xx, conclui a instalação

#### Scenario: App usa token durante o instalador
- **WHEN** o instalador do app pede `GET /v1/installations/{id}/token` com a instalação em `INSTALLING` ou `INSTALL_PENDING`
- **THEN** o sistema entrega o token normalmente

### Requirement: Conclusão da instalação
Quando a instalação ficar `ACTIVE`, o sistema MUST criar o trial pelo módulo billing se o app tiver `trial_on_install` e a instalação nunca tiver usado trial, e MUST emitir `installation.created` na primeira instalação ou `installation.reinstalled` numa reinstalação.

#### Scenario: Primeira instalação do GPTMaker
- **WHEN** uma instalação nova de `crmthink.gptmaker` (com `trial_on_install`) fica `ACTIVE`
- **THEN** o sistema emite `installation.created`, cria o trial de 14 dias e emite `subscription.trial_started`

#### Scenario: Reinstalação após trial usado
- **WHEN** uma instalação que já usou trial é reinstalada
- **THEN** o sistema emite `installation.reinstalled` e nenhum trial é criado

### Requirement: application_token
O sistema MUST receber o evento `ONAPPINSTALL` em `POST /bitrix/events/{appCode}`, guardar cifrado o `application_token` da instalação correspondente e validar todo evento `ONAPPUNINSTALL` comparando o token em tempo constante.

#### Scenario: Token capturado
- **WHEN** chega `ONAPPINSTALL` para um portal em instalação
- **THEN** o `application_token` é guardado cifrado e passa a ser devolvido aos apps em `GET /v1/installations/{id}`

#### Scenario: Desinstalação forjada
- **WHEN** chega `ONAPPUNINSTALL` com `application_token` diferente do guardado
- **THEN** o sistema responde 401 e não altera a instalação

### Requirement: Desinstalação e reinstalação
Ao receber `ONAPPUNINSTALL` válido, o sistema MUST marcar a instalação `UNINSTALLED`, apagar os tokens e emitir `installation.removed`, sem cancelar assinatura Stripe. Uma reinstalação do mesmo portal no mesmo app MUST reaproveitar a instalação e o `installationId`.

#### Scenario: Desinstalação com assinatura ativa
- **WHEN** um portal com assinatura `active` desinstala o app
- **THEN** a instalação fica `UNINSTALLED`, os tokens são apagados, `installation.removed` é emitido e a assinatura permanece como está

#### Scenario: Reinstalação
- **WHEN** um portal `UNINSTALLED` instala o app de novo
- **THEN** o sistema reaproveita o `installationId`, grava os novos tokens e chama o instalador com `isReinstall = true`

### Requirement: Consulta de instalações pelos apps
O sistema MUST expor `GET /v1/installations/{id}` retornando `{installationId, appCode, memberId, domain, status, applicationToken}` e `GET /v1/installations?memberId=` para busca, restritos às instalações do `appCode` da chave de API.

#### Scenario: Busca por memberId
- **WHEN** o app GPTMaker busca `GET /v1/installations?memberId=abc`
- **THEN** o sistema retorna apenas a instalação de `crmthink.gptmaker` daquele portal, se existir

#### Scenario: Instalação de outro app
- **WHEN** o app GPTMaker consulta uma instalação de `crmthink.thinkzap`
- **THEN** o sistema responde 404
