## Context

- O `hub-core` atende hoje cinco apps (ThinkZap, ThinkAnalise, ImportSheet, ClickSign, GPTMaker). É um monólito modular em Node 20/TypeScript (Express, zod, Prisma 7 sobre MySQL, BullMQ + Redis, pino/Loki), com deploy Docker + GitHub Actions numa VPS. Não usa RabbitMQ.
- **Instalação no `hub-core`** (plataforma de fato, mas acoplada aos módulos dos apps):
  - A página `front/app/bitrix/install/page.tsx` monta o payload com `BX24.getAuth()`, `app.info` e o email, faz `POST /api/auth/install` e só então chama `installFinish()`.
  - O orquestrador `api/src/shared/application/install-app.ts` executa passos idempotentes sem rollback: resolve o app em `core_app_codes`, faz upsert de `core_domains`, `core_apps` e `core_credentials`, cria ou acha o item no SPA 1060 (`GetOrCreateSpa`) e roda o instalador do app.
  - O contrato por app é `shared/domain/app-installer.ts` (`AppInstaller.install(ctx)`), registrado em `shared/infra/setup-app-installers.ts`.
  - `client_id`/`client_secret` ficam em `core_app_codes` e são copiados em cada `core_credentials`.
  - A renovação de tokens é o job `shared/infra/scheduler/credential-refresh.job.ts` (cron por minuto, lock Redis por tick).
- **Falhas de segurança do `hub-core`**, corrigidas na plataforma e só na migração no `hub-core`:
  - Admin vem do navegador: `isBitrixAdmin` é aceito do payload (`modules/auth/application/resolve-bitrix-user-at-login.ts:83`) e dá permissão total no ThinkZap, inclusive `finance`.
  - JWT sem `expiresIn` e segredo com padrão `''` (`shared/application/jwt-token-generator.ts:10-11`, `middleware/auth.ts:33`).
  - `POST /api/auth/install` público confia em domínio, `member_id` e tokens enviados pelo navegador; não há handler de `ONAPPINSTALL`.
  - `application_token` nunca é guardado nem validado nos webhooks de eventos do Bitrix.
  - Tokens em texto puro em `core_credentials`, embora `shared/infra/crypto/token-cipher.ts` exista.
  - `modules/portal/application/resolve-bitrix-client-for-app.ts:39-55` renova token sem lock; como o Bitrix rotaciona o refresh_token, renovações concorrentes derrubam a credencial.
  - Desinstalação não tratada; várias classes e fábricas de cliente Bitrix.
- A mesma lógica de instalação/OAuth foi reescrita em HubThink, hubthink-core, crmthink-extrator (Laravel), vfp (Laravel) e vfp-node.
- **Cobrança no `hub-core`**: Checkout embutido (`ui_mode` embedded, `redirect_on_completion: never`), alteração de quantidade de item, Customer Portal e cancelamento no fim do período. Trata só `checkout.session.completed`, `customer.subscription.updated` e `customer.subscription.deleted` (`api/src/modules/thinkzap/infra/gateway/stripe-payment.gateway.ts:74-78`).
- **SPAs** do portal CRMThink são a fonte da verdade, com IDs hoje fixos em `api/src/config/env.ts:302-313`: 1134 Produtos, 1138 Planos, 1060 Instalações, 1142 Assinaturas, 1146 Itens. Não há estágios: status é campo UF de lista com IDs de enum gerados pelo portal (ex.: Assinaturas `ufCrm91Status` active 13617, trialing 13619, past_due 13621, cancelled 13623, trial_expired 14353; Itens `ufCrm93Status` active 13625, cancelled 13627).
- A porta de pagamento mora no módulo `thinkzap` e o módulo `application` depende de tipos do ThinkZap (`PlanProvider`, `ConnectorSettings`).
- Lacunas de cobrança do `hub-core`: sem reconciliação Stripe ↔ SPA (`openspec/changes/reconcile-gateway-to-spa` só proposta), sem tabela de eventos processados nem outbox, sem `invoice.paid`/`invoice.payment_failed`, compra avulsa, estorno, contestação, troca de plano, carência ou avisos de cobrança; ativação parcial após pagamento só se resolve manualmente.
- A aplicação GPTMaker (primeiro consumidor) precisa de instalação com chatbot, trial de 14 dias (créditos são do app), créditos por ciclo, pacotes avulsos, estorno e carência de 3 dias.

## Goals / Non-Goals

**Goals:**
- Um único ponto de instalação Bitrix24 e de cobrança (Stripe + SPAs) para todas as aplicações CRMThink.
- Instalação e sessão seguras por padrão: nada de identidade ou admin vindo do navegador, tokens cifrados, renovação única.
- Contrato estável (API + eventos + JWKS) independente da stack de cada app.
- Cobrir renovação, avulso, estorno/contestação, inadimplência, troca de plano, trial e modalidade manual.
- Consistência Stripe ↔ SPA garantida por varredura, não só por webhooks.
- Entrega confiável de eventos aos apps (pelo menos uma vez, deduplicável, ordenável).

**Non-Goals:**
- Binds específicos de cada app (chatbot, eventos, placements, robôs): feitos pelo instalador do app com o token da plataforma.
- Permissões finas dentro de cada app (ex.: `finance` no ThinkZap): ficam nos apps, a partir do JWT.
- Intermediar chamadas REST dos apps ao Bitrix (proxy).
- Política de acesso dos apps (carência, corte, limites, reativação) e créditos/saldo: ficam nos apps.
- Emissão de nota fiscal.
- Outros gateways além do Stripe: boleto, Pix e similares entram como modalidade `manual`, com humanos ou automações externas escrevendo nos SPAs.
- Telas de checkout: o app renderiza o Checkout embutido com o `clientSecret` recebido.
- Migração dos apps do `hub-core` e dos repositórios Laravel (changes separadas).

## Decisions

### D1. Um serviço, dois módulos
`crmthink-platform` com os módulos `installations` e `billing`, no mesmo repositório, banco e deploy.
- Instalação e cobrança compartilham a mesma entidade: a instalação (item do SPA 1060, `installationId`). Com dois serviços, seria preciso sincronizar IDs e eventos de instalação entre eles.
- Time pequeno: um deploy, um pipeline, uma observabilidade.
- Fronteira entre módulos por pastas e interfaces internas; `billing` só lê a instalação por uma porta do módulo `installations`.
- *Alternativa*: dois serviços (`installations-service` e `payments-service`). Rejeitada pelos motivos acima; os módulos podem ser separados depois se a carga ou o time justificarem.

### D2. Stack Node 20 + TypeScript, igual ao hub-core
Express, zod, Prisma, BullMQ + Redis, pino/Loki, vitest. Processos `api` (HTTP, página de instalação, webhooks) e `worker` (filas, varreduras, renovação de tokens, entrega de eventos).
Código extraído do `hub-core` e generalizado (sem tipos de apps):
- Instalação: orquestrador `install-app.ts`, normalização de `expires` (`resolve-bitrix-token-expires-at.ts`), cliente OAuth `shared/infra/clients/bitrix-oauth.client.ts`, `call-bitrix-idempotent.ts`, cifra `token-cipher.ts`.
- Cobrança: porta neutra `PaymentGateway` e `GatewayEvent` (`api/src/modules/thinkzap/domain/ports/payment-gateway.port.ts:188-287`), adaptador Stripe e decorator de cache (`stripe-payment.gateway.ts`, `cache-invalidating-payment.gateway.ts`).
- SPAs: entidades e mappers (`modules/application/domain/entities/*`, `modules/application/infra/bitrix/mappers/{subscription,subscription-item,plan,product}.mapper.ts`), guardas `ensure*Field` (falham alto se campo UF falta, já que `crm.item.update` descarta campo desconhecido sem erro), controller de eventos SPA (`spa-webhook.controller.ts`), `spa-calendar-date.ts`, `plan-price.ts`, repositórios cacheados e chaves de invalidação.
- Um único cliente REST Bitrix (substitui `BitrixClient`, `BitrixRestClient` e as três fábricas `makeBitrixClient*`).
- *Alternativa*: Java/Spring como o backend GPTMaker. Rejeitada: reescreveria o que já funciona em produção e dificultaria a migração dos apps TypeScript; como os apps falam com a plataforma só por HTTP e JWKS, a stack da plataforma não afeta os apps.

### D3. Fluxo de instalação
1. A URL de instalação do app Bitrix aponta para `/install/{appCode}` (frontend mínimo da plataforma). O handler de eventos de instalação do app aponta para `POST /bitrix/events/{appCode}`.
2. A página tem só o botão "Instalar" (o marketplace do Bitrix não aceita coleta de dados do cliente na instalação); o clique vale como aceite dos termos e chama `POST /v1/install` com o `BX24.getAuth()`. Nenhum dado do cliente é coletado.
3. O servidor chama `app.info` e `profile` no domínio informado com o access token, exige que `member_id` e o `client_id` do app batam e normaliza `expires` (TTL, epoch em segundos ou milissegundos).
4. Upsert da instalação por (`appCode`, `memberId`) com status `INSTALLING`, tokens cifrados e domínio; upsert do item no SPA 1060 com Ambiente; vínculo.
5. `event.bind` de `ONAPPUNINSTALL` para `POST /bitrix/events/{appCode}`.
6. `POST <installer_url>` síncrono e assinado com `{installationId, memberId, domain, appCode, isReinstall}`, timeout de 60s. O app usa a API de tokens para seus binds. 2xx ⇒ `ACTIVE`; erro ou timeout ⇒ `INSTALL_PENDING`, com botão "tentar novamente" que reexecuta só o instalador.
7. Em `ACTIVE`: se `trial_on_install` e o trial nunca foi usado, o `billing` cria o trial; a plataforma emite `installation.created` ou `installation.reinstalled`; a página chama `BX24.installFinish()`.
- `application_token` chega no evento `ONAPPINSTALL` e é guardado cifrado; `ONAPPUNINSTALL` é validado contra ele em tempo constante.
- `ONAPPUNINSTALL` válido ⇒ `UNINSTALLED`, tokens apagados, `installation.removed`. Não cancela assinatura Stripe. Reinstalação reaproveita o mesmo `installationId`.

### D4. Cofre de tokens (vending) em vez de proxy
- Apps pedem `GET /v1/installations/{id}/token` e guardam em cache até `expiresAt - 5 min`, chamando o Bitrix diretamente.
- `expired_token` no app ⇒ `POST /v1/installations/{id}/token/refresh` com o token velho. Renovação única (single-flight): se o token guardado já é outro, devolve o guardado; senão renova sob lock Redis por instalação via `oauth.bitrix.info`.
- Job renova tokens que vencem em menos de 10 min, sob o mesmo lock. Só a plataforma renova. 5 falhas seguidas ⇒ `AUTH_ERROR` e `installation.auth_error`; sucesso posterior ⇒ `installation.auth_restored`.
- Tokens, `application_token` e `client_secret` cifrados com AES-256-GCM, chave em env, formato versionado `v1:`.
- *Alternativa*: proxy de todas as chamadas REST dos apps pela plataforma. Rejeitada: acrescentaria latência e ponto de falha no caminho crítico dos apps (ex.: cada resposta do chatbot GPTMaker) e concentraria rate limits. Risco da escolha: plataforma fora do ar por mais tempo que a validade do token (cerca de 1h) quebra as chamadas dos apps ao Bitrix; mitigado por cache, renovação antecipada e monitoramento externo com alerta.

### D5. Sessão do iframe com JWT RS256 e JWKS
- O frontend do app chama `POST /v1/sessions` com `{appCode, accessToken, domain, memberId}` do `BX24.getAuth()`; CORS liberado só para as origens de `SESSION_CORS_ORIGINS` (env por ambiente, formato `appCode=https://origem1,https://origem2;...`), configurada nos GitHub Environments.
- A plataforma chama `user.current` e `user.admin` com esse token no domínio e confere `member_id` com uma instalação `ACTIVE`. Nada do navegador é aceito para identidade ou admin.
- JWT RS256 de 15 minutos: `{iss, aud=appCode, sub=bitrixUserId, installationId, memberId, domain, isAdmin, name, departmentIds, exp}`. Renovação: novo `POST /v1/sessions` com o auth atualizado do BX24.
- JWKS em `/.well-known/jwks.json` com `kid` e rotação (chave nova publicada antes de assinar com ela; chave antiga mantida até expirarem os tokens emitidos). Os apps validam `iss`, `aud`, `exp` e assinatura localmente.
- A plataforma não sobe sem chave de assinatura configurada.
- *Alternativa*: segredo HMAC compartilhado com cada app. Rejeitada: cada app poderia forjar sessões dos outros; com RS256 só a plataforma assina.

### D6. SPAs como fonte da verdade; banco próprio operacional
Instalações, assinaturas, itens e planos vivem nos SPAs (alinhado ao ThinkZap). O MySQL da plataforma (mesma infra do `hub-core`) guarda:
- Registro: `app(app_code PK, name, bitrix_client_id, bitrix_client_secret_enc, scopes, installer_url, webhook_url, webhook_secret_enc, api_key_hash, trial_days, trial_on_install, allowed_origins, active)` e `app_product(app_code, product_spa_id)`.
- Instalações: `installation(id PK = id do item SPA 1060, app_code, member_id, domain, status INSTALLING|INSTALL_PENDING|ACTIVE|UNINSTALLED|AUTH_ERROR, contact JSON, trial_used, installed_at, uninstalled_at, UNIQUE(app_code, member_id))`, `credential(installation_id PK, access_token_enc, refresh_token_enc, expires_at, client_endpoint, refresh_failures, last_refresh_error)`, `application_token(installation_id PK, token_enc, received_at)`, `install_attempt(id, installation_id, step, status, error, created_at)`, `signing_key(kid PK, public_jwk, private_key_enc, created_at, activated_at, retired_at)`.
- Cobrança: `stripe_event(event_id PK, type, received_at, processed_at, status)`, `subscription_version(subscription_spa_id PK, version)`, `sweep_run(kind, started_at, finished_at, fixed, errors)`, `period_notice(subscription_spa_id, period_end, days_left)` UNIQUE, `purchase(id, app_code, installation_id, plan_id, quantity, checkout_session_id UNIQUE, charge_id, amount, status)`.
- Eventos: `outbox_event(event_id PK, app_code, type, installation_id, subscription_id, version, payload JSON, created_at)` e `event_delivery(event_id, attempt, status_code, error, next_attempt_at, delivered_at)`.
- A tabela `installation` é cache operacional do item do SPA 1060 (status técnico e credenciais não vão ao SPA).
- *Alternativa*: banco como fonte da verdade e SPA como espelho. Rejeitada: diverge do ThinkZap, e os times comercial e de integração já operam pelos SPAs.

### D7. Entrega de eventos por webhook HTTP assinado + outbox
- Evento gravado em `outbox_event` na mesma transação da decisão; worker BullMQ entrega via `POST <webhook_url>` com `X-Platform-Signature: t=<unix>,v1=<hmac-sha256(secret, t + "." + body)>` (nome do header mantido do contrato v1 já adotado pelo GPTMaker). O mesmo esquema assina a chamada ao instalador do app.
- Backoff exponencial por até 24h; depois dead-letter + alerta; reenvio manual por endpoint administrativo.
- Pelo menos uma vez; apps deduplicam por `eventId` e ignoram `subscription.version` menor que a última aplicada. Eventos de instalação têm `subscription: null`.
- *Alternativa*: RabbitMQ compartilhado. Rejeitada por ora: poucos eventos e de baixo volume (dezenas/dia por app), apps em stacks e hosts diferentes, `hub-core` não usa Rabbit, e HTTP evita infraestrutura compartilhada e credenciais de broker em cada app. Revisitar se o volume crescer ou surgir necessidade de fan-out entre muitos consumidores.

### D8. Autenticação por app
`Authorization: Bearer <api key>`; chave armazenada como hash; cada chave vê apenas instalações do seu `appCode`. Endpoints administrativos com credencial separada. Stripe metadata sempre carrega `{appCode, installationId, planId, intent}` (hoje o ThinkZap usa `{domainId, appCode, planId, intent}` — `payment-gateway.port.ts:18-25`).

### D9. Trial por produto, criado na instalação
Duração em `app.trial_days` (ThinkZap 3, GPTMaker 14). Com `trial_on_install`, o trial é criado automaticamente quando a instalação fica `ACTIVE` pela primeira vez; `POST /v1/installations/{id}/trial` fica só como rota administrativa. Trial = assinatura `trialing` sem `gatewayId`, uma vez por instalação (`installation.trial_used` + campo no SPA). Expiração detectada por job, emitindo `subscription.ended` com `reason=trial_expired`. Créditos e limites do trial são do app.

### D10. Mapeamento de status e enums configurável
Stripe → SPA: `active`/`trialing` → `active`; `past_due`/`unpaid`/`incomplete`/`incomplete_expired`/`paused` → `past_due`; `canceled` → `cancelled` (como `handle-gateway-webhook-event.ts:41-50`). IDs de SPA, campos e IDs de enum vêm de configuração (env/arquivo), com padrões iguais aos atuais do `hub-core`; validados no boot.

### D11. Ambientes no portal único
- Planos mantêm dois IDs de preço (`ufCrm89GatewayId` produção, `ufCrm89GatewayIdHomolog`), com ambiente escolhido pelo prefixo da chave Stripe (`sk_live_`/`rk_live_` ⇒ produção), como `env.ts:32-36`.
- Instalações (1060), Assinaturas (1142) e Itens (1146) ganham campo de lista **Ambiente** (`production` | `homolog`). Cada instância tem `PLATFORM_ENVIRONMENT`; grava seu ambiente em todo item que cria e ignora (eventos, varreduras, consultas) itens de outro ambiente. Item sem ambiente conta como `production`, para não obrigar o time comercial a preencher em assinaturas manuais reais; itens de teste devem ser marcados `homolog`.
- Staging e produção usam apps Bitrix distintos (`client_id` próprios), cadastrados em cada instância.

### D12. Frontend mínimo
Só a página de instalação (`/install/{appCode}`) e os estados "instalando", "tentar novamente" e "concluído", servidos pela própria plataforma (Next ou páginas estáticas com `BX24.js`). Cada app tem página própria: tema (logotipo, cores, título, boas-vindas, termos, campos de contato) vem do registro do app; fluxo, validações e chamadas são únicos. Sem tema cadastrado, usa o tema padrão da plataforma. Telas de produto, planos e checkout ficam em cada app.

### D13. Transição com o hub-core
- Stripe: o Stripe aceita múltiplos endpoints; a plataforma tem o seu, o `hub-core` mantém o dele até migrar. Cada lado processa somente eventos do próprio `appCode` e ignora os demais com 200.
- Instalação: o app GPTMaker usa um app Bitrix apontado para a plataforma desde o início. Apps do `hub-core` trocam a URL de instalação quando migrarem para repositório próprio; até lá, suas instalações continuam no `hub-core`.

### D14. Deploy e observabilidade
Imagem Docker multi-stage, GitHub Actions (lint, tipos, testes, build para GHCR, deploy via SSH + docker compose), staging e produção. Destino do deploy (host, usuário, chave SSH, diretório, projeto compose, portas) em variáveis e secrets dos GitHub Environments `staging`/`production`, nunca no código; padrão inicial: mesma VPS do `hub-core`, com projeto compose e portas próprios. Logs JSON (pino → Loki) com `appCode`, `installationId`, `subscriptionId`, `eventId`, sem tokens; métricas de instalações pendentes, falhas de renovação, latência da API de tokens, entregas pendentes, dead-letter, divergências de varredura e falhas de webhook Stripe; monitoramento externo de disponibilidade.

## Risks / Trade-offs

- [Plataforma no caminho crítico dos apps (tokens e login)] → cache de token até perto da expiração, renovação antecipada em segundo plano, JWKS em cache nos apps, monitoramento externo com alerta imediato; evolução: segunda instância e banco gerenciado.
- [Queda maior que a validade do token (~1h) quebra chamadas dos apps ao Bitrix] → alertas em minutos, runbook de restauração, backups.
- [Instalador do app lento ou fora do ar] → timeout de 60s, `INSTALL_PENDING`, nova tentativa idempotente pela página.
- [Refresh token rotacionado perdido por concorrência] → só a plataforma renova, lock por instalação e single-flight.
- [Vazamento do banco expõe tokens] → cifra AES-256-GCM com chave fora do banco; logs sem tokens.
- [Serviço vira ponto único de cobrança] → apps mantêm o último estado recebido; outbox garante entrega posterior.
- [SPA como fonte da verdade depende da API do Bitrix e de edições humanas] → `ensure*Field`, anti-loop por versão, varredura periódica, comentário na timeline em item inválido.
- [IDs de enum gerados pelo portal mudam se um SPA for recriado] → configuração externa validada no boot.
- [Portal único para produção e homologação] → preço por ambiente e campo Ambiente; cada instância ignora itens do outro ambiente.
- [App fora do ar perde eventos] → reenvio por 24h, dead-letter, reenvio manual e consultas para ressincronizar.
- [Duas integrações Stripe e duas instalações durante a transição] → filtro por `appCode`; migração por app.

## Migration Plan

1. Criar repositório e infra (staging); extrair do `hub-core` o código de instalação, cobrança e SPAs.
2. Dono do portal cria os campos novos nos SPAs e remove STATUS/TRIAL_* do 1060; cadastrar os produtos "GPTMaker" e "Créditos GPTMaker" e seus planos.
3. Criar os apps Bitrix do GPTMaker (staging e produção) apontando instalação e eventos de instalação para a plataforma; registrar `crmthink.gptmaker` com credenciais, instalador, webhook, trial de 14 dias e `trial_on_install`.
4. Configurar endpoint Stripe da plataforma (test mode), validar com Stripe CLI e testar instalação ponta a ponta num portal de teste.
5. Go-live com GPTMaker como primeiro consumidor.
6. ThinkZap e demais apps saem do `hub-core` para repositórios próprios, cada um consumindo a plataforma em sua change (instalação, sessão, tokens e cobrança), com as correções de segurança aplicadas na migração; o `hub-core` é desativado aos poucos. Repositórios Laravel migram só se valer a pena.
Rollback: deploy da tag anterior; eventos pendentes permanecem no outbox; tokens permanecem no banco.

## Decisões registradas

- **Campos novos nos SPAs**: criados pelo dono do portal CRMThink conforme a tarefa de onboarding; a plataforma só lê códigos de configuração e valida no boot (`ensure*Field`).
- **Campos legados STATUS e TRIAL_* do SPA 1060**: removidos do SPA; a plataforma não os lê nem escreve (o `hub-core` grava `null` na criação; como `crm.item.update` ignora campos inexistentes, a remoção não quebra o ThinkZap, e a migração remove essa escrita).
- **Pacotes avulsos**: produto separado no SPA 1134 com modelo de cobrança "compra única" (novo valor em `ufCrm87BillingModel`, se ainda não existir); cada pacote é um plano desse produto no SPA 1138, com preço Stripe de pagamento único. GPTMaker: produtos "GPTMaker" (assinatura) e "Créditos GPTMaker" (compra única).
- **Emails de cobrança**: ficam com o Stripe (recibos, falha de pagamento, cartão expirando). Plataforma e apps não enviam email; os apps só notificam dentro do Bitrix.
- **Correções de segurança do `hub-core`**: aplicadas desde o início na plataforma; no `hub-core`, só na migração de cada app.

## Open Questions

- Nenhuma pendente no momento.
