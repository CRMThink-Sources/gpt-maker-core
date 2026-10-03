## Context

- Projeto novo (greenfield). Não há código nem specs existentes.
- Temos conta PARTNER no GPTMaker: um único token de API, **um único workspace para todos os clientes**, criação de agentes e créditos ilimitados, cobrança ao fim do período pelo consumo total.
- A API GPTMaker v2 (`https://api.gptmaker.ai/v2`, Bearer token; contrato levantado do OpenAPI oficial em `docs/gptmaker-api.md`) expõe: workspace (`GET /workspaces`, `GET /workspace/{id}/credits` com `status` `TRIAL|ACTIVE|PAST_DUE|CANCELED`, `GET|POST /workspace/{id}/agents` com `page`/`pageSize`), agente (`GET|PUT|DELETE /agent/{id}`, `PUT /agent/{id}/active|inactive`, `GET|PUT /agent/{id}/settings` com `prefferModel`), treinamentos (`GET|POST /agent/{id}/trainings`, `PUT|DELETE /training/{id}`; criação não devolve id; só TEXT é editável), webhooks do agente (`GET|PUT /agent/{id}/webhooks`: `onNewMessage`, `onLackKnowLedge`, `onTransfer`, `onFirstInteraction`, `onStartInteraction`, `onFinishInteraction`, `onCreateEvent`, `onCancelEvent`), conversa (`POST /agent/{id}/conversation` com `contextId`, `prompt`, mídia, `callbackUrl`), controle humano (`PUT /chat/{id}/start-human|stop-human`) e consumo (`GET /agent/{id}/credits-spent`, diário por modelo). Créditos são sempre inteiros. O agente expõe `status` (`ACTIVE` | `DISABLED`, observados na API real; fora do OpenAPI); erros documentados são só 400 (genérico) e 403 (token); rate limit não documentado.
- A resposta de `/conversation` **não** informa créditos consumidos; o consumo real só é obtido de forma agregada (dia × agente × modelo).
- Bitrix24 dos clientes: instalação, OAuth, `ONAPPINSTALL`/`ONAPPUNINSTALL` e sessão do iframe tratados pelo `crmthink-platform` (módulo `installations`); o app usa tokens da plataforma para chatbot via `imbot.v2.Bot.register` (`imbot.register` deprecado), `imbot.message.add`, Linhas Abertas (`imopenlines.bot.session.*`), CRM (`crm.*`).
- Bitrix24 da empresa (portal CRMThink): SPAs Produtos (1134), Planos (1138), Instalações (1060), Assinaturas (1142) e Itens de assinatura (1146), compartilhados com o ThinkZap. São a fonte da verdade das assinaturas.
- Pagamentos: `crmthink-platform` compartilhado (repositório próprio; spec copiada em `openspec-crmthink-platform/`), que encapsula Stripe e SPAs para todas as aplicações. **Já implementado** (Node 20 + TypeScript, Express, Prisma/MySQL, BullMQ): instalação, cofre de tokens, sessão do iframe, planos, ciclo de vida da assinatura, itens, compras avulsas, estornos, webhooks Stripe, entrega de eventos e sincronização com SPAs. Pendentes do lado da plataforma: deploy (staging/produção) e onboarding do GPTMaker (campos nos SPAs, produtos/planos, apps Bitrix, registro de `crmthink.gptmaker`, teste ponta a ponta). Contrato publicado em OpenAPI 3.1 (`docs/api/openapi.json`, `GET /openapi.json`, `GET /docs`) com eventos de saída na seção `webhooks`; a plataforma fornece guia/biblioteca TypeScript de validação do JWT (JWKS) e da assinatura HMAC. Este app nunca fala com o Stripe (exceto Stripe.js no frontend para o Checkout embutido) nem com os SPAs.
- O módulo `gptmaker` existente no `hub-core` é descartado; nada é reaproveitado dele.
- Hospedagem: Droplet DigitalOcean; CI/CD: GitHub Actions.
- Decisões de negócio: canal = chatbot Bitrix (imbot); débito por créditos reais (1 crédito cliente = 1 crédito GPTMaker, margem no preço do plano); modelos e custos em tabela gerenciada; RabbitMQ + Redis.

## Goals / Non-Goals

**Goals:**
- App multi-tenant instalável em qualquer portal Bitrix24.
- Cliente cria, configura (incl. modelo), treina, inativa/reativa e remove agentes, refletidos no GPTMaker.
- Gestão segura do workspace único compartilhado.
- Atendimento automático nas Linhas Abertas via chatbot, com transferência para humano.
- Gatilhos que transformam eventos do agente em ações no CRM.
- Planos pré-pagos com ledger auditável, débito por resposta e reconciliação diária.
- Assinaturas via `crmthink-platform` (Stripe e modalidade manual), com trial de 14 dias e 500 créditos.
- Deploy reprodutível em Droplet com CI/CD GitHub Actions.

**Non-Goals:**
- Qualquer integração direta com Stripe ou SPAs dentro do app — responsabilidade do `crmthink-platform`.
- Emissão de nota fiscal.
- Canais nativos do GPTMaker (WhatsApp/Instagram direto no GPTMaker).
- Intenções, regras de transferência, ações de inatividade, MCP e campos customizados do GPTMaker na v1.
- Alta disponibilidade multi-nó (v1 roda em um Droplet; ver riscos).
- Publicação no Bitrix24 Marketplace na v1.

## Decisions

### D1. Monorepo com backend modular monolítico + worker
`backend/` NestJS 11 (Node 24 LTS, TypeScript strict) em módulos Nest por domínio: `tenancy` (instalador, tenant, sessão), `bitrix` (cliente com tokens da plataforma), `gptmaker` (cliente + workspace), `models`, `agents`, `training`, `channel`, `triggers`, `billing`, `payments` (cliente do `crmthink-platform` e receptor de eventos), `reconciliation`, `backoffice`, `shared`. Mesmo pacote/imagem com dois entrypoints selecionados por `APP_ROLE`: `api` (HTTP, webhooks) e `worker` (consumidores RabbitMQ, jobs). `frontend/` NextJS com `/app` (embutido no Bitrix) e `/admin` (backoffice). `packages/contracts/` com schemas zod e tipos compartilhados entre backend e frontend (npm workspaces).
- Stack backend: Drizzle ORM + drizzle-kit (migrações SQL), zod (`nestjs-zod`) para validação, `@golevelup/nestjs-rabbitmq` (amqplib), `ioredis`, `@nestjs/schedule` (jobs com lock Redis), `cockatiel` (retry/circuit breaker/timeout) + rate limiter próprio no Redis (compartilhado entre api e worker), `nestjs-pino`, `prom-client`, `@nestjs/terminus`, `jose` (JWT/JWKS), Vitest + Testcontainers for Node.
- *Alternativa*: microsserviços. Rejeitado: time pequeno, domínio instável, um único Droplet.
- *Alternativa*: Spring Boot (Java 21), desenho anterior. Substituído por TypeScript: uma linguagem em todo o monorepo (frontend e backend), tipos/contratos compartilhados e time mais produtivo na stack.
- Fronteiras reforçadas por `dependency-cruiser` (módulo só importa a API pública de outro módulo).

### D2. Workspace único gerenciado pela plataforma
Todos os agentes no workspace partner (`GPTMAKER_WORKSPACE_ID` por env). O isolamento é inteiramente nosso:
- Registro local `agent(tenant_id, gptmaker_agent_id)` é a fonte da verdade de posse; todo repositório filtra por `tenant_id`; IDs do GPTMaker nunca aceitos do cliente sem checagem.
- Nome no GPTMaker: `[<tenantCode>] <nome>` (tenantCode curto e estável gerado na instalação), para operadores identificarem agentes no painel do GPTMaker e para recuperar vínculos.
- `contextId` = `{tenantId}:{dialogId}`.
- Job `workspace-sync` (a cada hora): `GET /workspace/{id}/agents` vs registro ⇒ órfãos (com tenant sugerido pelo prefixo do nome) e ausentes. Paginação sem base documentada: leitura tolerante (começa em 0, deduplica, para em página vazia ou sem agentes novos). Ausente só vira `OUT_OF_SYNC` após `GET /agent/{id}` responder 404 (400 genérico fica indeterminado). Status divergente: compara o `status` da listagem com o local (`ACTIVE` ↔ `ACTIVE`, `DISABLED` ↔ `INACTIVE`; campo ausente ou valor desconhecido não compara, só loga), reaplica o local via `PUT /agent/{id}/active|inactive` (relendo o status local antes) e grava `STATUS_MISMATCH` já resolvido; falha ao reaplicar fica aberta com alerta e fecha quando a divergência some.
- Validação no boot (`GET /workspaces` contém o `GPTMAKER_WORKSPACE_ID`) e job `workspace-health` (a cada 15 min): `GET /workspace/{id}/credits`; `status != ACTIVE` ⇒ alerta crítico. Estado guardado no Redis e exposto em `GET /health` (componente `gptmaker`); `GET /health/ready` (usado no deploy) não inclui provedores externos.
- Limite de 5 agentes não removidos por tenant, igual para todos os planos (configurável no backoffice); agentes não são cobrados individualmente.
- Recursos globais (contatos, chats, canais, custom-fields, interações) não expostos.

### D3. Instalação, tokens e sessão via crmthink-platform
- URL de instalação do app no Bitrix ⇒ página da plataforma `/install/crmthink.gptmaker`. A plataforma verifica a instalação no Bitrix, guarda tokens e `application_token`, escreve o SPA 1060 e chama de forma síncrona `POST /platform/installer` do app (HMAC, timeout 60s). O instalador cria/reativa `tenant` (chave `installation_id`, `member_id`), gera `tenant_code`, registra handlers (`event.bind`) e, em reinstalação, os chatbots dos agentes ativos. Idempotente: a plataforma reexecuta em caso de falha.
- Trial: não é criado na instalação (`trial_on_install` desligado). O tenant ativa pelo formulário de cadastro (D9, "Trial por cadastro"); chega como `subscription.trial_started`.
- Tokens: `PlatformTokenProvider` busca `GET /v1/installations/{id}/token`, cache Redis até `expiresAt - 5min`; em `expired_token` chama `/token/refresh` com o token vencido (single-flight na plataforma) e repete a chamada uma vez. O app nunca renova nem persiste tokens.
- `application_token`: lido de `GET /v1/installations/{id}` (cache Redis 1h, invalidado em `installation.reinstalled`), comparado em tempo constante em todo evento do Bitrix.
- Desinstalação e erros de autorização: eventos `installation.removed`, `installation.auth_error`, `installation.auth_restored` no mesmo endpoint `/platform/events` usado pelo billing.
- Sessão do iframe: frontend chama `BX24.getAuth()` → `POST /v1/sessions` da plataforma → JWT RS256 de 15 min (aud `crmthink.gptmaker`); backend valida com JWKS da plataforma (cache, rotação por `kid`). Renovação transparente com nova auth do BX24. `BX24.js` para resize. Customer Portal abre em nova janela; Checkout é embutido.
- *Alternativa*: OAuth e instalação no próprio app (desenho anterior). Rejeitada: duplicaria o que é comum a todas as aplicações CRMThink e repetiria as falhas encontradas no `hub-core`.

### D4. Cliente GPTMaker encapsulado
`GptMakerClient` (`fetch`/undici, respostas validadas com zod) + `cockatiel` + rate limiter no Redis: limite global (token único, somado entre processos), retry com backoff para 5xx/timeout, circuit breaker. Token em variável de ambiente/secret, nunca em banco.

### D5. Fluxo de mensagens assíncrono via RabbitMQ
```
Bitrix evento msg ─▶ API /bitrix/events ─(valida app token, dedupe Redis SETNX)─▶ exchange channel.inbound (consistent-hash por dialogId)
   worker ─▶ agente ativo? atendimento humano? saldo > 0? (Redis)
      ├─ não ─▶ transfere para operador / ignora; evento BLOCKED_NO_CREDIT quando saldo
      └─ POST /agents/{id}/conversation ─▶ imbot.message.add ─▶ publica usage.response {agentId, modelCode, messageId}
billing consome usage.response ─▶ DEBIT idempotente (unique message_id) com custo do modelo
```
- Ordem por diálogo via consistent hash exchange (N filas, 1 consumidor cada).
- Retry com filas TTL escalonadas (10s, 1m, 5m) + DLQ; esgotado ⇒ transfere para humano, sem débito.
- v1 síncrona com timeout (60s); `callbackUrl` como otimização futura.

### D6. Catálogo de modelos e débito
Tabela `ai_model(id, code, display_name, description, credits_per_response, active, is_default, deleted_at)` + `ai_model_cost_history`. `code` = enum `prefferModel` do GPTMaker (validado contra lista conhecida, mas editável para novos modelos). `plan_allowed_model(plan_id, model_id)`.
- Regras do catálogo: código fora da lista conhecida exige confirmação do operador; padrão único e sempre ativo (não pode ser inativado nem removido sem outro padrão); "em uso" = agentes não removidos. Remoção com substituto inativa o modelo, migra agente a agente (`PUT /agent/{id}/settings` com as settings locais + `prefferModel`; `OUT_OF_SYNC` só local) e faz soft delete limpando `plan_allowed_model`; falha em um agente mantém o modelo e a nova tentativa continua. Seed inicial (tabela de cobrança do GPTMaker, descontinuados inativos, padrão `GPT_5_MINI`) no boot da API, só com catálogo vazio.
- Débito: `DEBIT = ai_model.credits_per_response` do modelo do agente no momento do processamento; lançamento guarda `model_code` e `unit_cost`.
- Remoção: soft delete; bloqueada se houver agentes ativos, salvo com substituto (migra agentes chamando `PUT /agents/{id}/settings`).
- 1:1 com créditos GPTMaker ⇒ não existe multiplicador de margem; margem = preço do plano − custo GPTMaker dos créditos.
- *Alternativa*: custo + multiplicador global. Rejeitado: o usuário quer o custo cadastrado direto no modelo; margem já é controlada pelo preço.

### D7. Reconciliação diária
Job: `credits-spent` por agente/dia/modelo ⇒ `usage_daily_real`; compara com `SUM(DEBIT)` do agente no dia; diferença além da tolerância ⇒ `ADJUSTMENT` com chave `(agent_id, day)` guardando o total já ajustado (reexecução idempotente). Calcula média real por resposta por modelo para sugerir revisão de `credits_per_response`.
- Dias no fuso `RECONCILIATION_TIMEZONE` (padrão `America/Sao_Paulo`; o fuso do GPTMaker não é documentado e segue a confirmar). Às 03:20 de Brasília reprocessa os últimos `RECONCILIATION_LOOKBACK_DAYS` dias (padrão 3), para consumo que chega atrasado; falha num agente vira pendência (Redis), retentada de hora em hora, sem parar os demais.
- Decisão por agente e dia: `debitado − real` dentro de `RECONCILIATION_TOLERANCE_CREDITS` (padrão 2) ⇒ nada (e desfaz ajuste anterior); acima de `RECONCILIATION_REVIEW_THRESHOLD_CREDITS` (padrão 100) ⇒ `REVIEW`: não lança, alerta e espera um operador (protege contra fuso errado ou falha da API cobrando ou devolvendo um dia inteiro); senão lança a diferença para o total desejado. A chave do lançamento inclui o total anterior e o novo, então 0→5, 5→3 e 3→5 são distintos e repetir não duplica.

### D8. Ledger append-only no PostgreSQL; saldo em cache Redis
`credit_ledger(id, tenant_id, wallet TRIAL|PLAN|EXTRA, type, amount, model_code, unit_cost, subscription_period_id, ref_type, ref_id, idempotency_key UNIQUE, created_at, created_by)`. Saldo materializado em `tenant_balance(tenant_id, trial_balance, trial_ends_at, plan_balance, extra_balance, expires_at)` na mesma transação (`SELECT ... FOR UPDATE`), espelhado em Redis (total). Créditos são sempre inteiros (a API do GPTMaker só trabalha com inteiros). Checagem "total > 0" antes do GPTMaker; saldo pode ficar levemente negativo (aceito e documentado). Alertas 80%/100% na transação que cruza o limiar.

**Carteiras** (regra de negócio: créditos do trial expiram no fim do trial, mesmo com plano contratado; créditos do plano e adicionais expiram juntos ao fim do ciclo; a separação existe para expiração independente, extrato/exibição e para que `TRIAL`/`EXTRA` nunca fiquem negativas):
- `TRIAL`: recebe `GRANT` de 500 no `subscription.trial_started`; job do app lança `EXPIRE` do saldo positivo em `trial_ends_at` (guardado em `tenant_balance`), independente do status da assinatura; virada de ciclo não mexe nela.
- `PLAN`: recebe `GRANT` a cada ciclo; ao virar o ciclo, `EXPIRE` do saldo positivo restante; saldo negativo é abatido do novo `GRANT`.
- `EXTRA`: recebe `TOPUP` (pacotes comprados via `crmthink-platform` e concessões do backoffice); ao virar o ciclo, `EXPIRE` do saldo positivo restante junto com `PLAN`; nunca fica negativa.
- Débito consome `TRIAL` → `PLAN` → `EXTRA` (o que expira antes sai primeiro; preserva ao máximo os créditos pagos à parte); um débito que atravessa carteiras gera um lançamento por carteira com o mesmo `ref_id` (idempotency keys `msg:{id}:TRIAL|PLAN|EXTRA`).
- `ADJUSTMENT` negativo da reconciliação segue a mesma ordem; `ADJUSTMENT` positivo vai para `PLAN` do ciclo corrente.
- **Saldo zerado**: total ≤ 0 ⇒ mensagem não vai ao GPTMaker; bot envia mensagem `SYSTEM = Y` no diálogo avisando que não será processada por falta de créditos; sem débito; evento `BLOCKED_NO_CREDIT`. Em seguida o diálogo é transferido para a fila de operadores da Linha Aberta.
- **Estorno** (`charge.refunded` / `charge.dispute.created`): créditos restantes da cobrança = `min(quantidade, saldo da carteira)` no ciclo corrente (pacote ⇒ `EXTRA`, assinatura ⇒ `PLAN`), ou zero se o ciclo já virou; restantes saem com `REFUND`; gastos (quantidade − restantes − expirados) viram registro em `credit_deduction(id, tenant_id, amount, remaining, ref_charge_id UNIQUE, created_at)`. No `GRANT` do próximo ciclo, o serviço de ciclo lança `ADJUSTMENT` negativo em `PLAN` até o valor do `GRANT` e mantém o excedente para os ciclos seguintes. Sem assinatura ativa, a dedução fica pendente até o primeiro `GRANT` de nova assinatura.
- *Alternativa*: carteira única com lotes de expiração. Rejeitada: carteiras separadas dão leitura direta de trial, plano e adicional e facilitam mudar regras de expiração no futuro.

### D9. Integração com o crmthink-platform (módulo billing)
Contrato v1 implementado no `crmthink-platform` e publicado em OpenAPI 3.1. Este app é o primeiro consumidor (appCode `crmthink.gptmaker`). A plataforma não aplica carência, corte, limites nem créditos: tudo isso é política deste app.
- **Saída (app → serviço)**: `PaymentsClient` sobre o `PlatformClient` do SDK publicado pela plataforma (`@crmthink-sources/platform-sdk`, GitHub Packages) e `cockatiel`, chave de API em env (`Authorization: Bearer`). Rotas: `GET /v1/plans`, `POST /v1/checkout-sessions` (`subscribe`/`purchase`), `POST /v1/billing-portal-sessions`, `POST /v1/subscriptions/{id}/change-plan`, `GET /v1/installations/{id}/subscription`, `POST|PATCH|DELETE /v1/subscriptions/{id}/items` por agente (`billable=false`, `externalRef` = id do agente; outbox local `payments_outbox` para reprocessar falhas). Instalação não é chamada pelo app; o trial é pedido pelo app com os dados do cadastro (ver "Trial por cadastro"). Erros tratados pelo código estável do envelope `{ error: { code } }` (ex.: `SUBSCRIPTION_ALREADY_EXISTS`, `NO_ACTIVE_SUBSCRIPTION`, `PLAN_TYPE_MISMATCH`, `MANUAL_SUBSCRIPTION`, `NO_GATEWAY_SUBSCRIPTION`). Mudança de contrato chega por nova versão do SDK.
- **Entrada (serviço → app)**: `POST /platform/events`; valida `X-Platform-Signature` (HMAC-SHA256, 5 min), grava `payment_event(event_id PK, type, payload, received_at, processed_at, status)` e publica em `payments.events` (RabbitMQ). Worker aplica efeitos em transação com o ledger.
- **Projeção local**: `subscription_state(tenant_id PK, subscription_id, status, modality, plan_id, period_start, period_end, version, grace_until, cancel_at)`. Evento com `version` menor que a aplicada é ignorado (exceto financeiros). Job a cada 6h compara com `GET /v1/installations/{id}/subscription`.
- **Efeitos**:
| Evento | Efeito no app |
|---|---|
| `trial_started` | `GRANT` 500 em `TRIAL`, `trial_ends_at` = `data.trialEndsAt` |
| `activated` / `renewed` | virada de ciclo (não toca `TRIAL`): `EXPIRE` PLAN+EXTRA, deduções pendentes, `GRANT` do plano; limpa carência; reativa agentes `SUBSCRIPTION_EXPIRED` |
| `plan_changed` | imediato: `GRANT` proporcional da diferença + novos limites; próximo ciclo: guarda plano futuro |
| `past_due` | `grace_until` = falha + 1 dia, empurrado para segunda se cair no sábado ou domingo (Brasília); falhas seguintes não estendem; aviso `PAYMENT_FAILED` |
| `recovered` | limpa carência (reativa agentes `SUBSCRIPTION_EXPIRED`) |
| `cancel_scheduled` | `cancel_at` = `data.effectiveAt` (a tela mostra a data e some a renovação); `renewed`/`activated` limpam; a retomada não tem evento e é sincronizada pelo job de consistência (`cancelAtPeriodEnd`) |
| `ended` (`reason` = `trial_expired`, `cancelled` ou `deleted`) | `EXPIRE` TRIAL+PLAN+EXTRA; inativa agentes `SUBSCRIPTION_EXPIRED` |
| `period_ending` | aviso `PERIOD_ENDING` (só `manual`) |
| `purchase.paid` | `TOPUP` em `EXTRA` (quantidade do pacote em `plan_entitlement`) |
| `charge.refunded` / `charge.disputed` | regra de estorno (`REFUND` + `credit_deduction`) |
- Idempotência dos efeitos: chaves do ledger por `(subscription_id, period_start)`, `purchaseId`, `chargeId`; `GRANT` do trial por `(subscription_id, trial)`.
- **Trial por cadastro**: a plataforma não cria trial na instalação. A tela de planos oferece "Testar grátis" quando o tenant não tem linha em `subscription_state` (nunca recebeu trial nem plano). A plataforma só expõe `trial.used` dentro da assinatura vigente (`GET /v1/installations/{id}/subscription` responde `NO_SUBSCRIPTION` sem ela), então o app não pergunta antes: a projeção local filtra e a recusa `TRIAL_ALREADY_USED` decide os casos que ela não conhece. O formulário (nome, e-mail, telefone/WhatsApp, empresa e cargo, todos obrigatórios; nome e e-mail pré-preenchidos com o usuário do Bitrix; validação com o mesmo schema do contrato) é enviado a `POST /app/trial`, restrito à permissão de administração do app, que chama `requestTrial` do SDK (`POST /v1/installations/{id}/trial`, chave do app; SDK ≥ 1.1.0). A plataforma valida, grava o contato na instalação (banco, usado também como `customerEmail` do checkout, e cópia no SPA 1060 sem bloquear), cria o trial uma vez por instalação e emite `subscription.trial_started`; os créditos saem só desse evento (efeito já existente). O app não persiste os dados do cadastro (LGPD: uma cópia só, na plataforma; o evento também não traz o contato). Respostas tratadas: 201 (trial criado) e 200 (trial já vigente) ⇒ ativação em andamento; `VALIDATION_ERROR` ⇒ erros por campo a partir de `details`; `TRIAL_ALREADY_USED` ⇒ planos; `SUBSCRIPTION_ALREADY_EXISTS` ⇒ planos e consulta da assinatura para corrigir a projeção; `TRIAL_NOT_CONFIGURED` ⇒ erro de configuração com alerta; serviço fora ⇒ erro recuperável. Repetição segura: a plataforma serializa por instalação e devolve 200 com o mesmo trial, e o `GRANT` do trial é idempotente por `(subscription_id, trial)`.
  - *Alternativa*: trial automático na instalação (`trial_on_install`, desenho anterior). Rejeitada: o trial sairia sem nenhum dado de contato do cliente; com o cadastro, o comercial recebe o contato e o trial só é usado por quem pediu.
  - *Alternativa*: app gravar o cadastro e escrever no portal CRMThink. Rejeitada: o app teria de acessar o portal CRMThink e guardaria dados pessoais; a plataforma já escreve nos SPAs e serve os outros apps.
- **Carência**: job a cada 15 min avisa `onAccessChanged` uma vez por carência quando `grace_until` vence com status `past_due` (marca no Redis); a `AgentAccessPolicy` inativa os agentes. Prazo curto (1 dia) por decisão de negócio, com o fim de semana como exceção para não cortar o atendimento sem chance de regularizar.
- **Direitos dos planos**: `plan_entitlement(plan_spa_id PK, credits_per_cycle, credits_per_package, training_limits, active)` + `plan_allowed_model(plan_spa_id, model_id)`; preço/intervalo vêm do serviço (cache Redis 5 min).
- **Checkout embutido**: frontend carrega Stripe.js com a publishable key (env do frontend) e monta o Embedded Checkout com o `clientSecret`; ativação só por evento. Customer Portal abre em nova janela.
- **Avisos** (módulo `notifications`): `notification_recipient(tenant_id, bitrix_user_id)` configurado em tela própria do app (só administrador); envio via `im.notify.system.add` (escopo `im`) um por destinatário, só aos ativos no portal (`user.get` com `FILTER[ACTIVE]`, escopo `user_brief`); lista vazia ou só usuários inativos ⇒ administradores do portal. O Bitrix24 não lista administradores pela API: valem os administradores vistos nas sessões do app (`portal_admin`, claim `isAdmin` do JWT) e o dono do token da instalação (`user.current`: quem instalou, sempre administrador). Tipos: `CREDIT_80`, `CREDIT_ZERO` (100% consumido = saldo zerado, o antigo `CREDIT_100`), `PAYMENT_FAILED`, `PERIOD_ENDING`, `MODEL_DOWNGRADED` (12.6) e `TEST` (botão da tela). `notification_log` com único (tenant, tipo, chave) faz a idempotência e é a fila: `notify` só registra, e o despacho a cada 30 s envia com retentativa (espera exponencial até 1 h, 10 tentativas) e `sent_to` para não repetir quem já recebeu. Chaves: alertas de crédito pelo último `GRANT` (ciclo do trial ou do plano), pagamento recusado por assinatura e prazo da carência, fim de período por assinatura, fim e dias restantes.
- *Alternativa*: integrar Stripe e SPAs diretamente no app (desenho anterior). Rejeitada: duplicaria o que o ThinkZap já faz e impediria padronizar pagamentos entre as aplicações.

### D12. Webhooks do GPTMaker e gatilhos
Na criação do agente, configura todos os webhooks para `https://api.<dominio>/gptmaker/webhooks/{event}?t={token}` (token aleatório por agente, armazenado com hash). Handler valida, grava `agent_event`, publica em `triggers.events`. Worker avalia gatilhos e executa ações via cliente Bitrix do tenant, registrando `trigger_execution`. `onTransfer` também aciona o módulo `channel` (transferência + `human-start`). Ações v1: lead, negócio, comentário de timeline, tarefa, business process, webhook de saída HMAC. Templates de campo `{{contact.name}}`. Payload exato a confirmar (open question).

### D13. Cliente Bitrix por tenant
`BitrixClient` com token do `PlatformTokenProvider` (D3), rate limiter por portal (~2 req/s), `batch` quando possível. Sem refresh local, sem tokens em banco.

### D14. Armazenamento de documentos
DigitalOcean Spaces (S3-compatível; SeaweedFS em dev, pois o MinIO deixou de publicar imagens) com caminhos aleatórios e URL pré-assinada de longa duração para o GPTMaker baixar via `documentUrl`. Objeto removido junto com o treinamento.

### D15. Persistência
PostgreSQL 16 + Drizzle ORM (migrações versionadas por drizzle-kit; `SELECT ... FOR UPDATE` e SQL explícito onde o ledger exige). Tabelas: `tenant` (`installation_id`, `member_id`, `tenant_code`, status), `app_user_permission`, `plan_entitlement`, `plan_allowed_model`, `subscription_state`, `payment_event`, `payments_outbox`, `credit_ledger`, `tenant_balance`, `credit_deduction`, `notification_recipient`, `notification_log`, `ai_model`, `ai_model_cost_history`, `agent`, `agent_bot`, `training`, `dialog_state`, `message_log`, `agent_event`, `trigger`, `trigger_action`, `trigger_execution`, `usage_daily_real`, `reconciliation_adjustment`, `workspace_sync_finding`, `backoffice_user`, `audit_log`.

### D16. Cache (Redis)
Saldo, agente/bot por `botId`, dedupe de eventos (TTL 24h), locks, rate limiting, flags de atendimento humano. Invalidação explícita nas escritas.

### D17. Backoffice
`/admin` no NextJS, autenticação própria (senha + TOTP ou SSO Google Workspace), perfis `ADMIN`/`SUPPORT`, `audit_log` em todas as ações. Telas: direitos dos planos e pacotes, modelos, tenants, assinaturas (projeção local, eventos do serviço, link SPA), workspace (health, órfãos), reconciliação, DLQ.

### D18. Deploy em Droplet DigitalOcean
- Droplet Ubuntu LTS (dimensionar inicialmente 4 vCPU / 8 GB) com Docker + Docker Compose.
- `infra/docker-compose.prod.yml`: `caddy` (reverse proxy, TLS automático Let's Encrypt), `frontend`, `backend-api`, `backend-worker`, `postgres`, `rabbitmq`, `redis`. Volumes persistentes em DO Volume (block storage) para Postgres/RabbitMQ.
- Domínios: `app.<dominio>` (frontend), `api.<dominio>` (backend/webhooks). Caddy adiciona `Content-Security-Policy: frame-ancestors` para domínios Bitrix.
- DigitalOcean Cloud Firewall: apenas 80/443 públicos; 22 restrito (IPs do time / runners via chave). Postgres/RabbitMQ/Redis sem porta pública.
- Backups: snapshot semanal do Droplet + `pg_dump` diário enviado ao Spaces com retenção de 30 dias; teste de restore documentado.
- Segredos: arquivo `.env` no Droplet (permissão 600) gerado pelo pipeline a partir de GitHub Actions Secrets/Environments.
- *Alternativa*: DO Managed PostgreSQL / App Platform. Não escolhido para manter tudo no Droplet; migração para Managed PostgreSQL fica como evolução se o volume crescer.

### D19. CI/CD com GitHub Actions
- `ci.yml` (PR e push): lint, testes unitários backend/frontend, typecheck, testes (Vitest), testes de integração com Testcontainers for Node (Postgres, RabbitMQ, Redis) + WireMock (GPTMaker, Bitrix, `crmthink-platform`) + fixtures de eventos assinados.
- `release.yml` (push em `main`): build de imagens Docker multi-stage (backend Node, frontend `standalone`), push no GitHub Container Registry (`ghcr.io`) com tag do SHA.
- `deploy.yml`: environment `staging` automático e `production` com aprovação manual (GitHub Environments); via SSH no Droplet: grava `.env`, `docker compose pull && docker compose up -d`, health check pós-deploy e rollback para a tag anterior se falhar. Migrações Drizzle rodam no start do `backend-api` (antes de aceitar tráfego).
- Staging: **Droplet separado** (menor, ex.: 2 vCPU / 4 GB), mesmo `docker-compose.prod.yml` com `.env` próprio, portal Bitrix de teste e `crmthink-platform` de staging (Stripe em test mode).

### D20. Observabilidade
Logs JSON via pino (`traceId`, `tenantId`, `agentId`, `dialogId` propagados com `AsyncLocalStorage`) com rotação; `prom-client` + Prometheus + Grafana (containers no Droplet ou Grafana Cloud free); OpenTelemetry (`@opentelemetry/sdk-node`) API → fila → worker; alertas (e-mail/Bitrix da empresa) para DLQ, workspace `!= ACTIVE`, falha de reconciliação, eventos do `crmthink-platform` falhando/atrasados, projeção divergente, disco.

## Risks / Trade-offs

- [Custo por resposta estimado diverge do real] → reconciliação diária com `ADJUSTMENT`; sugestão de custo por modelo; tolerância configurável.
- [Saldo levemente negativo por concorrência/ajustes] → checagem pré-chamada; bloqueio ao cruzar zero; política comercial documentada.
- [Workspace compartilhado: vazamento entre tenants] → filtro obrigatório, `contextId` prefixado, testes de isolamento, recursos globais não expostos.
- [Alguém altera agentes direto no painel GPTMaker] → `workspace-sync` detecta e corrige; acesso ao painel restrito a operadores.
- [Token partner único/crítico] → secret fora do código, rotação documentada, rate limiter global, circuit breaker.
- [Dependência do `crmthink-platform` (implementado; deploy e onboarding pendentes)] → eventos persistidos e reenviados pelo serviço por 24h; projeção local mantém o app funcionando se o serviço cair; reconciliação a cada 6h; alertas de atraso.
- [Eventos fora de ordem ou duplicados] → dedupe por `eventId`, versão da assinatura, idempotência do ledger por período/compra/cobrança.
- [Erro humano no SPA (modalidade manual) concede créditos indevidos] → validações no serviço, `payment_event` e `audit_log` no app, alerta para renovações manuais fora do padrão.
- [Droplet único é ponto único de falha] → backups diários + snapshots, restore testado, monitoramento externo (uptime), RabbitMQ/Postgres com volumes persistentes; caminho de evolução: Managed PostgreSQL e segundo Droplet para workers.
- [Webhooks do GPTMaker sem assinatura oficial] → token aleatório por agente, HTTPS, rotação reconfigurando webhooks.
- [Rate limits Bitrix/GPTMaker] → rate limiters, filas absorvem picos, `batch`.
- [Latência do `/conversation` síncrono] → timeout, consumidores dimensionados, métrica de lag; migrar para `callbackUrl` se preciso.

## Migration Plan

Projeto novo, sem migração de dados. Rollout:
0. Pré-requisito: `crmthink-platform` em staging com o app `crmthink.gptmaker` cadastrado (client_id/secret do app Bitrix, instalador, webhook, `trial_on_install` desligado e a solicitação de trial com contato publicada, change `trial-contact-request` da plataforma, SDK 1.1.0), produtos "GPTMaker" (assinatura) e "Créditos GPTMaker" (compra única, um plano por pacote) nos SPAs 1134/1138.
1. Provisionar Droplet(s), DNS e Spaces.
2. Staging com portal Bitrix de teste, `crmthink-platform` de staging (Stripe test mode) e agentes de teste no workspace.
3. Piloto com 1–3 clientes (trial e assinaturas `manual` via SPA), acompanhando reconciliação.
4. Ativar Stripe live no serviço e abertura geral.
Rollback: deploy da tag anterior via `deploy.yml`; desativar novas instalações; inativar agentes via backoffice; ledger permanece íntegro.

## Open Questions

- Payload exato dos webhooks do GPTMaker (`onTransfer`, `onNewMessage`, etc.) e dos `callbackUrl` de conversa e treinamento — não documentado; capturar em staging (tarefa 10.1). Necessário para mapear diálogo Bitrix ↔ chat GPTMaker e para os templates de gatilhos.
- Validar em staging: rate limit real do GPTMaker, base da paginação de `/workspace/{id}/agents` e resposta de `GET /agent/{id}` para agente removido (404 ou 400).
