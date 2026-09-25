> Rascunho criado no repositório `gpt-maker`; será movido para o repositório próprio do `crmthink-platform` quando ele for criado.

## Why

Todas as aplicações CRMThink (ThinkZap, ThinkAnalise, ImportSheet, ClickSign, GPTMaker e outras) repetem as mesmas duas peças: a instalação no Bitrix24 (página de instalação, OAuth, guarda e renovação de tokens, login do iframe, desinstalação) e a cobrança (Stripe e Smart Processes de pagamento do portal CRMThink). A instalação já foi reescrita em pelo menos cinco repositórios e três stacks (Express/TypeScript, Laravel e Next): `hub-core`, HubThink, hubthink-core, crmthink-extrator, vfp e vfp-node. Só o ThinkZap cobra hoje, com o código de pagamento preso no módulo `thinkzap` do `hub-core`.

O `hub-core` já é uma plataforma de fato para cinco apps (orquestrador `install-app.ts`, contrato `AppInstaller`, renovação de tokens comum), mas está acoplado aos módulos dos apps e tem falhas de segurança na instalação e na sessão: admin informado pelo navegador, JWT sem expiração, instalação sem verificação no servidor, `application_token` nunca guardado, tokens em texto puro, renovação sem lock e desinstalação não tratada.

Esta change cria o `crmthink-platform`: um serviço único, com os módulos `installations` e `billing`, que padroniza instalação e cobrança para todas as aplicações e corrige essas falhas uma vez. As aplicações passam a cuidar só do que é delas: seus binds no Bitrix, sua política de acesso e seu produto.

## What Changes

- Novo serviço `crmthink-platform` (repositório próprio), em Node 20 + TypeScript, mesma stack do `hub-core` para extrair o código já em produção. Um processo `api` (HTTP, página de instalação, webhooks) e um `worker` (filas, varreduras, renovação de tokens, entrega de eventos).
- **Módulo `installations`**:
  - Página de instalação comum (`/install/{appCode}`) com formulário de contato e aceite de termos.
  - Verificação da instalação no servidor (`app.info`, `profile`), sem confiar no navegador.
  - Instalação espelhada no SPA 1060 (Instalações), com campo Ambiente.
  - Chamada síncrona ao instalador de cada app, que faz os próprios binds (chatbot, eventos, placements), com estado `INSTALL_PENDING` e nova tentativa pela página.
  - `application_token` capturado no `ONAPPINSTALL`, guardado cifrado e usado para validar `ONAPPUNINSTALL`.
  - Desinstalação e reinstalação tratadas.
  - Cofre de tokens: os apps pedem o access token à plataforma; só a plataforma renova, com lock por instalação e renovação única (single-flight). Tokens e `client_secret` cifrados em repouso.
  - Sessão do iframe: a plataforma confere usuário e admin no Bitrix e emite JWT RS256 de 15 minutos; os apps validam localmente pelo JWKS.
  - Eventos de instalação aos apps: `installation.created`, `installation.reinstalled`, `installation.removed`, `installation.auth_error`, `installation.auth_restored`.
- **Módulo `billing`** (desenho anterior do `payments-service`):
  - SPAs do portal CRMThink como fonte da verdade (1134 Produtos, 1138 Planos, 1060 Instalações, 1142 Assinaturas, 1146 Itens de assinatura), alinhado ao ThinkZap.
  - Trial criado automaticamente na instalação quando o app tem `trial_on_install`.
  - Checkout embutido (assinatura e compra avulsa), Customer Portal, troca de plano, itens de assinatura, renovação por `invoice.paid`, `invoice.payment_failed`, estorno e contestação, aviso de fim de período para modalidade `manual`.
  - Webhooks Stripe centralizados e idempotentes; varredura Stripe ↔ SPA.
- Registro de aplicações (`appCode`) com `client_id`/`client_secret` do app Bitrix, escopos, URL do instalador, URL e segredo de eventos, chave de API, produtos e trial.
- Entrega de eventos aos apps por webhook HTTP assinado (HMAC-SHA256), com outbox transacional, reenvio por até 24h, dead-letter e reenvio manual.
- Primeiro consumidor: aplicação GPTMaker. ThinkZap e demais apps vão para repositórios próprios e passam a consumir a plataforma, cada um em sua change; o `hub-core` é desativado aos poucos.
- As falhas de segurança do `hub-core` já nascem corrigidas na plataforma. No `hub-core` elas só são corrigidas durante a migração de cada app:
  - admin verificado no servidor;
  - JWT com expiração e segredo obrigatório (falha no boot se ausente);
  - instalação verificada no servidor;
  - `application_token` guardado e validado;
  - tokens cifrados;
  - renovação única com lock;
  - desinstalação tratada;
  - um único cliente Bitrix.

## Capabilities

### New Capabilities
- `app-registry`: cadastro das aplicações (credenciais do app Bitrix, escopos, instalador, webhook de eventos, chave de API, produtos, trial).
- `bitrix-installation`: página de instalação, verificação no servidor, espelho no SPA 1060, instalador do app, `INSTALL_PENDING` e nova tentativa, `application_token`, desinstalação e reinstalação.
- `bitrix-token-vault`: API de tokens por instalação, renovação única sob lock, renovação em segundo plano, `AUTH_ERROR` e cifragem em repouso.
- `iframe-session`: `POST /v1/sessions` com verificação de usuário e admin no servidor, JWT RS256 de 15 minutos e JWKS com rotação.
- `plan-catalog`: leitura de produtos (1134) e planos (1138), tipo do plano derivado do modelo de cobrança do produto (assinatura ou compra única), preços por ambiente.
- `subscription-lifecycle`: trial, checkout embutido, ativação, renovação, inadimplência, recuperação, cancelamento, encerramento, troca de plano, modalidade manual e aviso de fim de período.
- `subscription-items`: espelho de itens de assinatura no SPA 1146, cobráveis ou não.
- `one-time-purchases`: compras avulsas via Stripe Checkout em modo pagamento.
- `refunds-disputes`: estornos e contestações e notificação aos apps.
- `stripe-webhooks`: endpoint único, verificação de assinatura, idempotência e roteamento por app.
- `event-delivery`: eventos de instalação e de cobrança, outbox, assinatura HMAC, reenvio, dead-letter, deduplicação e ordenação por versão.
- `spa-sync`: eventos dos SPAs, anti-loop, validação de campos, separação por ambiente e varreduras de consistência.

### Modified Capabilities
<!-- Nenhuma: serviço novo. -->

## Impact

- **Código novo**: repositório `crmthink-platform` (API + worker + página de instalação), extraído parcialmente do `hub-core`.
- **Integrações**: Bitrix24 dos clientes (OAuth via `oauth.bitrix.info`, `app.info`, `profile`, `user.current`, `user.admin`, `event.bind`, eventos `ONAPPINSTALL`/`ONAPPUNINSTALL`), API REST do Bitrix24 CRMThink (`crm.item.*`, eventos `onCrmDynamicItem*`), Stripe (Checkout embutido, Billing, Customer Portal, webhooks).
- **Apps consumidores**: GPTMaker primeiro. Cada app aponta a URL de instalação do seu app Bitrix para a plataforma, expõe um endpoint de instalador e um de eventos, busca tokens na plataforma, valida o JWT da sessão pelo JWKS e mantém sua política de acesso.
- **Caminho crítico**: apps dependem da plataforma para tokens do Bitrix (mitigado por cache até perto da expiração) e para login no iframe.
- **SPAs**: campos novos (trial usado, `billable`, `externalRef`, versão, `cancelAtPeriodEnd`, Ambiente em 1060/1142/1146); STATUS e TRIAL_* removidos do 1060; produtos "GPTMaker" (assinatura) e "Créditos GPTMaker" (compra única) e seus planos nos SPAs 1134/1138.
- **Infra**: MySQL, Redis, Docker, GitHub Actions, VPS (destino configurado nos GitHub Environments).
- **Segurança**: `client_secret` dos apps Bitrix, tokens dos portais, chaves Stripe, webhook do Bitrix CRMThink, chaves de API, segredos HMAC e chaves de assinatura do JWT fora do código e cifrados em repouso quando guardados no banco.
