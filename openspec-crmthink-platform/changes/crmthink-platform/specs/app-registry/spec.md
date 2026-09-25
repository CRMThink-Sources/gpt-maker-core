## ADDED Requirements

### Requirement: Cadastro de aplicações consumidoras
O sistema MUST manter o cadastro das aplicações que usam a plataforma, identificadas por `appCode` (ex.: `crmthink.thinkzap`, `crmthink.gptmaker`), com: nome, logotipo e tema da página de instalação (cores, título, texto de boas-vindas, link e texto dos termos, campos de contato exibidos e obrigatórios); `client_id` e `client_secret` do app Bitrix24 (secret cifrado); escopos esperados; URL do instalador (hook síncrono do app); URL de webhook de eventos e segredo HMAC (cifrado); chave de API; um ou mais produtos vinculados no SPA 1134 (ex.: GPTMaker com o produto de assinatura "GPTMaker" e o produto avulso "Créditos GPTMaker"); duração de trial em dias; `trial_on_install`; e flag de ativo.

#### Scenario: Registrar aplicação
- **WHEN** um operador cadastra a aplicação `crmthink.gptmaker` com `client_id`/`client_secret` do app Bitrix, escopos, URL do instalador, URL de webhook, seus dois produtos, trial de 14 dias e `trial_on_install`
- **THEN** o sistema gera chave de API e segredo de webhook, exibe ambos uma única vez, grava apenas o hash da chave e guarda `client_secret` e segredo cifrados

#### Scenario: Escopos insuficientes na instalação
- **WHEN** a instalação de um app retorna em `app.info` escopos diferentes dos esperados no cadastro
- **THEN** o sistema registra alerta operacional com os escopos faltantes e prossegue com a instalação

#### Scenario: Aplicação inativa
- **WHEN** uma aplicação é desativada
- **THEN** chamadas com a chave dela são recusadas com 403, novas instalações e sessões são recusadas e nenhum evento novo é entregue a ela

### Requirement: Autenticação por chave de API
O sistema MUST autenticar toda chamada servidor-a-servidor de aplicação por `Authorization: Bearer <api key>` e restringir cada chave às instalações, tokens, assinaturas, itens e compras do seu `appCode`. As rotas públicas de instalação (`/install/{appCode}`, `POST /v1/install`), de sessão (`POST /v1/sessions`), o JWKS e os eventos do Bitrix não usam chave de API e têm suas próprias verificações.

#### Scenario: Chave inválida
- **WHEN** uma chamada chega sem chave ou com chave desconhecida
- **THEN** o sistema responde 401 sem processar

#### Scenario: Acesso a instalação de outro app
- **WHEN** a aplicação `crmthink.gptmaker` consulta uma instalação pertencente a `crmthink.thinkzap`
- **THEN** o sistema responde 404

### Requirement: Rotação de credenciais
O sistema MUST permitir rotacionar a chave de API e o segredo de webhook de uma aplicação, aceitando a credencial anterior por um período de transição configurável.

#### Scenario: Rotação do segredo de webhook
- **WHEN** um operador rotaciona o segredo de webhook
- **THEN** as entregas passam a ser assinadas com o novo segredo e a antiga assinatura deixa de ser enviada ao fim do período de transição
