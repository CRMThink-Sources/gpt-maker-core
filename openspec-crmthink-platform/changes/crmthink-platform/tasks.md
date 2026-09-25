## 1. Repositório e infraestrutura

- [x] 1.1 Criar repositório `crmthink-platform` (Node 20, TypeScript, Express, zod, Prisma/MySQL, BullMQ/Redis, pino, vitest) com processos `api` e `worker` e módulos `installations` e `billing` com fronteira por interfaces
- [x] 1.2 Docker multi-stage, `docker-compose` de dev (mysql, redis) e `.env.example` (inclui `PLATFORM_ENVIRONMENT`, chave de cifragem e chave de assinatura do JWT)
- [x] 1.3 GitHub Actions: lint, tipos, testes, build para GHCR, deploy via SSH (staging a partir de `develop`, produção a partir de `main`); host, usuário, chave, diretório, projeto compose e portas em variáveis/secrets dos GitHub Environments
- [x] 1.4 Logs JSON com `appCode`/`installationId`/`subscriptionId`/`eventId` e sem tokens, envio ao Loki, health check e métricas
- [x] 1.5 Migrações: `app`, `app_product`, `installation`, `credential`, `application_token`, `install_attempt`, `signing_key`, `stripe_event`, `outbox_event`, `event_delivery`, `subscription_version`, `sweep_run`, `period_notice`, `purchase`
- [x] 1.6 Utilitário de cifragem AES-256-GCM (`v1:`) portado de `token-cipher.ts`; falha no boot sem chave

## 2. Extração do hub-core

- [x] 2.1 Portar orquestrador de instalação (`install-app.ts`), normalização de `expires`, cliente OAuth e `call-bitrix-idempotent`, generalizados para qualquer app
- [x] 2.2 Criar um único cliente REST Bitrix (substitui `BitrixClient`, `BitrixRestClient` e fábricas `makeBitrixClient*`)
- [x] 2.3 Portar a porta `PaymentGateway`/`GatewayEvent` removendo tipos do ThinkZap (`PlanProvider`, `ConnectorSettings`)
- [x] 2.4 Portar adaptador Stripe e decorator de invalidação de cache
- [x] 2.5 Portar entidades, mappers e repositórios cacheados dos SPAs, `spa-calendar-date`, `plan-price` e chaves de cache
- [x] 2.6 Portar guardas `ensure*Field` e o controller de eventos SPA
- [x] 2.7 Tornar IDs de SPA, campos UF e IDs de enum configuráveis com padrões iguais ao hub-core

## 3. Registro de aplicações (app-registry)

- [x] 3.1 CRUD administrativo de aplicações: credenciais do app Bitrix (secret cifrado), escopos, tema da página de instalação, URL do instalador, webhook, produtos, trial e `trial_on_install`
- [x] 3.2 Geração de chave de API (hash) e segredo de webhook; middleware de autenticação por chave e escopo por `appCode`
- [x] 3.3 Rotação de chave e segredo com período de transição

## 4. Página e fluxo de instalação (bitrix-installation)

- [x] 4.1 Página `/install/{appCode}` com `BX24.js`: tema por app (logotipo, cores, textos, termos, campos de contato) com fallback para tema padrão, estados "instalando", "tentar novamente" e "concluído", `installFinish` só em `ACTIVE`
- [x] 4.2 `POST /v1/install`: validação, verificação no servidor com `app.info` e `profile` (`member_id` e `client_id`), checagem de escopos
- [x] 4.3 Upsert da instalação por (`appCode`, `memberId`), tokens cifrados, status `INSTALLING`; upsert do item no SPA 1060 com Ambiente e vínculo do `installationId`
- [x] 4.4 `event.bind` de `ONAPPUNINSTALL` para `/bitrix/events/{appCode}`
- [x] 4.5 Chamada síncrona assinada ao instalador do app (timeout 60s), `INSTALL_PENDING`, nova tentativa só do instalador e registro em `install_attempt`
- [x] 4.6 Conclusão: trial automático via billing quando `trial_on_install`, eventos `installation.created`/`installation.reinstalled`
- [x] 4.7 Endpoint `/bitrix/events/{appCode}`: captura do `application_token` no `ONAPPINSTALL` e validação em tempo constante no `ONAPPUNINSTALL`
- [x] 4.8 Desinstalação (`UNINSTALLED`, tokens apagados, `installation.removed`) e reinstalação reaproveitando o `installationId`
- [x] 4.9 `GET /v1/installations/{id}` e `GET /v1/installations?memberId=`; tratamento de remoção manual do item 1060

## 5. Cofre de tokens (bitrix-token-vault)

- [x] 5.1 `GET /v1/installations/{id}/token` com respostas 410 (`UNINSTALLED`) e 409 (`AUTH_ERROR`)
- [x] 5.2 `POST /v1/installations/{id}/token/refresh` com single-flight e lock Redis por instalação
- [x] 5.3 Job de renovação antecipada (< 10 min) sob o mesmo lock; contagem de falhas, `AUTH_ERROR`, `installation.auth_error` e `installation.auth_restored`
- [x] 5.4 Testes de concorrência da renovação (vários pedidos simultâneos, job + pedido sob demanda)

## 6. Sessão do iframe (iframe-session)

- [x] 6.1 `POST /v1/sessions` com CORS por `SESSION_CORS_ORIGINS` (env por ambiente, por app), `user.current` e `user.admin` no servidor e checagem de instalação `ACTIVE`
- [x] 6.2 Emissão de JWT RS256 de 15 min com as claims do contrato
- [x] 6.3 `signing_key` cifrada, JWKS em `/.well-known/jwks.json`, rotação com publicação antecipada e retenção da chave antiga; falha no boot sem chave ativa
- [x] 6.4 Biblioteca/guia de validação do JWT pelo JWKS para apps (TypeScript e Java)

## 7. Catálogo de planos (plan-catalog)

- [x] 7.1 Leitura de produtos/planos com cache e `GET /v1/plans` filtrado pelos produtos do app
- [x] 7.2 Tipo do plano derivado de `ufCrm87BillingModel` do produto (`subscription`/`one_time`), vários produtos por app (`app_product`) e preço por ambiente (produção/homologação)

## 8. Ciclo de vida da assinatura (subscription-lifecycle)

- [x] 8.1 Trial automático na instalação, rota administrativa `POST /v1/installations/{id}/trial` e job de expiração de trial
- [x] 8.2 `POST /v1/checkout-sessions` (`subscribe`) com Checkout embutido
- [x] 8.3 Ativação idempotente (checkout + primeira fatura; `manual` via SPA)
- [x] 8.4 Renovação por `invoice.paid` de ciclo e por extensão de período `manual`
- [x] 8.5 `past_due`, `recovered`, `cancel_scheduled`, `ended`
- [x] 8.6 `POST /v1/billing-portal-sessions` e `GET /v1/installations/{id}/subscription`
- [x] 8.7 `POST /v1/subscriptions/{id}/change-plan` (upgrade com `always_invoice`, downgrade agendado)
- [x] 8.8 Job diário de `subscription.period_ending` (3/2/1) para `manual`

## 9. Itens de assinatura (subscription-items)

- [x] 9.1 Endpoints de criação, alteração e remoção de itens no SPA 1146, idempotentes por `externalRef`
- [x] 9.2 Sincronização de quantidade Stripe para itens `billable`
- [x] 9.3 Reflexo de alterações humanas em itens

## 10. Compras avulsas (one-time-purchases)

- [x] 10.1 Checkout `purchase` em `mode=payment` e registro de compra pendente
- [x] 10.2 Confirmação idempotente e evento `purchase.paid`; expiração de sessão

## 11. Estornos e contestações (refunds-disputes)

- [x] 11.1 Resolução da origem da cobrança (compra ou fatura)
- [x] 11.2 Eventos `charge.refunded` e `charge.disputed` e alerta operacional

## 12. Webhooks Stripe (stripe-webhooks)

- [x] 12.1 Endpoint com corpo bruto, verificação de assinatura e registro em `stripe_event`
- [x] 12.2 Fila de processamento com retry e dead-letter
- [x] 12.3 Roteamento e filtro por `appCode`

## 13. Entrega de eventos (event-delivery)

- [x] 13.1 Outbox transacional e versão por assinatura; eventos de instalação com `subscription: null`
- [x] 13.2 Worker de entrega com assinatura HMAC, backoff por 24h e dead-letter
- [x] 13.3 Endpoint administrativo de reenvio manual
- [x] 13.4 Biblioteca/guia de verificação de assinatura HMAC para apps (TypeScript e Java), cobrindo eventos e chamada do instalador

## 14. Sincronização com SPAs (spa-sync)

- [x] 14.1 Validação de configuração no boot e health check
- [x] 14.2 Recepção de eventos SPA com anti-loop por versão
- [x] 14.3 Varredura Stripe ↔ SPA
- [x] 14.4 Varredura de itens alterados nos SPAs 1142/1146
- [x] 14.5 Filtro por Ambiente (`PLATFORM_ENVIRONMENT`) em escrita, eventos, varreduras e consultas; item sem ambiente = `production`

## 15. Testes

- [x] 15.1 Testes unitários de mappers, máquina de estados, cifragem, JWT e assinatura HMAC
- [x] 15.2 Testes de instalação com Bitrix simulado: verificação de token, `member_id`/`client_id` divergentes, instalador com falha e nova tentativa, desinstalação forjada
- [x] 15.3 Testes de integração com Stripe CLI (`stripe trigger`) cobrindo todos os eventos tratados
- [x] 15.4 Testes de idempotência, ordenação e reenvio

## 16. Deploy

- [ ] 16.1 Provisionar staging e produção, segredos (cifragem, JWT, Stripe) e endpoint Stripe da plataforma (test mode e live)
- [ ] 16.2 Domínio público com TLS para página de instalação, API, JWKS e eventos do Bitrix
- [ ] 16.3 Webhook de saída do portal CRMThink apontando para a plataforma
- [ ] 16.4 Monitoramento externo de disponibilidade e alertas: API de tokens, falhas de renovação, instalações pendentes, dead-letter, falha de varredura e de webhook Stripe

## 17. Onboarding do GPTMaker

- [ ] 17.1 Dono do portal cria os campos novos nos SPAs (trial usado, `billable`, `externalRef`, versão, `cancelAtPeriodEnd`, Ambiente em 1060/1142/1146) e remove STATUS/TRIAL_* do 1060; registrar os códigos na configuração
- [ ] 17.2 Cadastrar produtos "GPTMaker" (assinatura) e "Créditos GPTMaker" (compra única, novo valor de `billingModel` se necessário) e seus planos nos SPAs 1134/1138, com preços Stripe de produção e homologação
- [ ] 17.3 Criar os apps Bitrix do GPTMaker (staging e produção) com URL de instalação `/install/crmthink.gptmaker` e handler de eventos de instalação na plataforma
- [ ] 17.4 Registrar `crmthink.gptmaker` com credenciais Bitrix, escopos, instalador, webhook, tema da página de instalação, trial de 14 dias; origem do frontend do GPTMaker em `SESSION_CORS_ORIGINS` e `trial_on_install`
- [ ] 17.5 Teste ponta a ponta em staging: instalação (com instalador do GPTMaker), sessão do iframe, token e renovação, trial, assinatura, renovação, pacote, falha de pagamento, estorno, desinstalação e reinstalação

## 18. Preparação para migração dos demais apps

- [x] 18.1 Mapear rotas, eventos e tabelas do hub-core (`core_app_codes`, `core_domains`, `core_apps`, `core_credentials`, `AppInstaller`) para o contrato da plataforma
- [x] 18.2 Plano de importação das instalações e credenciais existentes (cifrando tokens) sem reinstalação pelos clientes
- [x] 18.3 Plano de corte por app (novo repositório, troca da URL de instalação, endpoint Stripe, backfill de metadados `installationId`, filtro por `appCode`)
- [x] 18.4 Checklist de correções de segurança a aplicar na migração: admin verificado no servidor, JWT com expiração e segredo obrigatório, instalação verificada, `application_token` validado, tokens cifrados, renovação única com lock, desinstalação tratada, cliente Bitrix único
