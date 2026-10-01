> Estimativas em horas de trabalho focado de 1 dev sênior full-stack, incluindo testes. Resumo e premissas no fim do arquivo.

## 1. Fundação do repositório e ambiente local

- [x] 1.1 Criar monorepo (npm workspaces) com `backend/`, `frontend/`, `packages/contracts/` (tipos e schemas zod compartilhados), `infra/`, `docs/`, `README.md`, `.editorconfig`, ESLint + Prettier e `tsconfig` base (strict) (~3h)
- [x] 1.2 Gerar projeto NestJS 11 (Node 24 LTS, TypeScript strict) com Drizzle ORM + drizzle-kit, validação zod (`nestjs-zod`), `@golevelup/nestjs-rabbitmq`, `ioredis`, `@nestjs/terminus`, `@nestjs/schedule`, `cockatiel`, `prom-client`, Vitest (~4h)
- [x] 1.3 Estruturar módulos Nest (`tenancy`, `bitrix`, `gptmaker`, `models`, `agents`, `training`, `channel`, `triggers`, `billing`, `payments`, `reconciliation`, `backoffice`, `shared`) e teste de arquitetura (`dependency-cruiser`) (~4h)
- [x] 1.4 Dois entrypoints no mesmo pacote/imagem: `main.api.ts` (HTTP, webhooks) e `main.worker.ts` (consumidores RabbitMQ, jobs) selecionados por `APP_ROLE` (~3h)
- [x] 1.5 Gerar projeto NextJS (App Router, TypeScript) com áreas `/app` (embutido no Bitrix) e `/admin` (backoffice), consumindo `packages/contracts` (~3h)
- [x] 1.6 Criar `infra/docker-compose.yml` de dev: postgres, rabbitmq (plugin consistent-hash), redis, storage S3 (SeaweedFS; MinIO sem imagem pública), backend-api, backend-worker, frontend (hot reload) (~4h)
- [x] 1.7 Configurar logs JSON (`nestjs-pino`) com `traceId`/`tenantId` via `AsyncLocalStorage`, health checks (`/health/live`, `/health/ready`) e endpoint `/metrics` Prometheus (~4h)

## 2. Infraestrutura DigitalOcean e CI/CD GitHub Actions

- [ ] 2.1 Provisionar Droplet de produção (Ubuntu LTS, Docker, Compose), DO Volume para dados, Cloud Firewall (80/443 públicos, 22 restrito) e DNS (`app.`, `api.`) (~6h)
- [ ] 2.2 Provisionar Droplet de staging separado (menor), com DNS próprio (`app-staging.`, `api-staging.`) e mesmas regras de firewall (~3h)
- [ ] 2.3 Criar bucket DigitalOcean Spaces (documentos de treinamento e backups) com chaves de acesso (~1h)
- [x] 2.4 Criar `infra/docker-compose.prod.yml` com caddy (TLS automático, CSP `frame-ancestors` Bitrix), frontend, backend-api, backend-worker, postgres, rabbitmq, redis (~4h)
- [x] 2.5 Workflow `ci.yml`: lint, typecheck, testes unitários backend/frontend (Vitest), testes de integração (Testcontainers for Node + WireMock container + fixtures de eventos do `crmthink-platform`) (~5h)
- [x] 2.6 Workflow `release.yml`: build de imagens Docker multi-stage (backend Node, Next `standalone`) e push para `ghcr.io` com tag do SHA (~3h)
- [x] 2.7 Workflow `deploy.yml`: GitHub Environments `staging` (automático) e `production` (aprovação manual); SSH no Droplet, gerar `.env` a partir de Secrets, `docker compose pull && up -d`, health check e rollback para tag anterior (~5h)
- [ ] 2.8 Backups: `pg_dump` diário para Spaces com retenção 30 dias, snapshot semanal do Droplet, procedimento de restore testado (~6h)
- [ ] 2.9 Monitoramento de uptime externo e alertas de disco/memória do Droplet (~3h)

## 3. Modelo de dados base

- [x] 3.1 Schema Drizzle + migração: `tenant` (`installation_id`, `member_id`, `tenant_code`, status), `app_user_permission` (~3h)
- [x] 3.2 Migração: `ai_model`, `ai_model_cost_history`, `plan_entitlement`, `plan_allowed_model` (~2h)
- [x] 3.3 Migração: `subscription_state`, `payment_event`, `payments_outbox` (~2h)
- [x] 3.4 Migração: `credit_ledger` (`wallet` TRIAL/PLAN/EXTRA, idempotency_key UNIQUE, `model_code`, `unit_cost`), `tenant_balance` (`trial_balance`, `trial_ends_at`, `plan_balance`, `extra_balance`, `expires_at`), `credit_deduction` (`amount`, `remaining`, `ref_charge_id` UNIQUE) (~4h)
- [x] 3.5 Migração: `agent`, `agent_bot`, `training`, `dialog_state`, `message_log` (~3h)
- [x] 3.6 Migração: `agent_event`, `trigger`, `trigger_action`, `trigger_execution` (~2h)
- [x] 3.7 Migração: `usage_daily_real`, `reconciliation_adjustment`, `workspace_sync_finding`, `backoffice_user`, `audit_log` (~3h)
- [x] 3.8 Utilitário de cifragem AES-GCM (`node:crypto`) para colunas sensíveis (custom type Drizzle) e testes (~3h)

## 4. Cliente GPTMaker e workspace (gptmaker-workspace)

- [x] 4.1 Implementar `GptMakerClient` (`fetch`/undici, Bearer) com schemas zod de workspace, agente, settings (`prefferModel`), treinamentos, webhooks, conversa, human-start/stop e credits-spent (~12h)
- [x] 4.2 Resiliência com `cockatiel`: rate limiter global (Redis, compartilhado entre processos), retry com backoff, circuit breaker, timeout; mapeamento de erros de domínio (~6h)
- [x] 4.3 Testes de contrato com WireMock (Testcontainers) para cada endpoint (~8h)
- [x] 4.4 Validação do `GPTMAKER_WORKSPACE_ID` na inicialização e health indicator (~2h)
- [x] 4.5 Convenção de nomes `[<tenantCode>] <nome>` (aplicar ao criar/renomear; remover na exibição) (~2h)
- [x] 4.6 Job `workspace-sync`: detectar órfãos, ausentes (`OUT_OF_SYNC`) e status divergente; gravar `workspace_sync_finding` (~8h)
- [x] 4.7 Job `workspace-health`: consultar `/workspace/{id}/credits` e alertar se `status != ACTIVE` (~3h)
- [x] 4.8 Limite de 5 agentes não removidos por tenant (`TENANT_AGENT_LIMIT`, configurável) (~2h)

## 5. Catálogo de modelos (ai-model-catalog)

- [x] 5.1 CRUD de `ai_model` com código único, modelo padrão único e validação do código `prefferModel` (~6h) — serviço de domínio; rotas HTTP com a autenticação do backoffice (15.1/15.3)
- [x] 5.2 Histórico de alteração de custo (`ai_model_cost_history`) com autor (~3h)
- [x] 5.3 Desativação e remoção (soft delete) com bloqueio se em uso ou migração para substituto (atualizando settings no GPTMaker) (~6h)
- [x] 5.4 Vínculo de modelos permitidos por plano (`plan_spa_id`) (~3h)
- [x] 5.5 Seed inicial com modelos e custos (valores a confirmar) (~1h) — custos da tabela de cobrança do GPTMaker, semeados no boot da API só com catálogo vazio

## 6. Instalação, tokens e sessão via crmthink-platform (bitrix-app-installation)

- [x] 6.1 Passar ao time da plataforma os dados do app para o onboarding (tarefas 17.3/17.4 do `crmthink-platform`): escopos (`imbot`, `imopenlines`, `crm`, `task`, `bizproc`, `user`, `im`), URL do instalador, URL de eventos, origem do frontend para `SESSION_CORS_ORIGINS`; receber chave de API e segredo HMAC (~2h) — app `crmthink.gptmaker` cadastrado no staging da plataforma; instalação e sessão testadas via túnel cloudflared
- [x] 6.2 `PlatformTokenProvider` (`GET /v1/installations/{id}/token` com cache Redis até `expiresAt - 5min`, `POST .../token/refresh` com token vencido, tratamento de 410/409) e `BitrixClient` por tenant com rate limiter por portal e `batch` (~6h) — cliente sobre o `PlatformClient` do SDK publicado (`@crmthink-sources/platform-sdk`); token cifrado no Redis
- [x] 6.3 Endpoint `/platform/installer` (`{installationId, memberId, domain, appCode, isReinstall}`): validação HMAC com a biblioteca da plataforma, criar/reativar tenant por `installation_id`, gerar `tenant_code`, registrar handlers; `isReinstall` re-registra chatbots; idempotente, até 60s (~6h) — sem `event.bind` nesta versão: eventos do chatbot chegam pelo `webhookUrl` do `imbot.v2.Bot.register` (9.1) e `OnSessionFinish` só dispara para conectores do app; o instalador confere o acesso com `app.info` e chama os ouvintes do ciclo de vida (re-registro de chatbots entra com 9.1)
- [x] 6.4 Validação de `application_token` em todo evento do Bitrix com cache de `GET /v1/installations/{id}` (~4h) — `BitrixEventGuard` pronto para os endpoints da 9.2
- [x] 6.5 Eventos `installation.removed` (UNINSTALLED, inativar agentes), `installation.auth_error`/`auth_restored` (pausar/retomar processamento, aviso de reautorização) (~6h) — `/platform/events` grava `payment_event` e publica em `payments.events`; worker aplica `installation.*` (eventos de cobrança ficam gravados para a seção 12); reinstalação reativa agentes inativados por `UNINSTALLED`
- [x] 6.6 Frontend: troca de `BX24.getAuth()` por JWT em `POST /v1/sessions` da plataforma e renovação transparente (~6h)
- [x] 6.7 Backend: guard NestJS validando JWT por JWKS da plataforma (guia/biblioteca TypeScript da plataforma + `jose`; iss, aud `crmthink.gptmaker`, exp) e contexto de tenant/usuário a partir das claims (`installationId`, `sub`, `isAdmin`) (~3h)
- [x] 6.8 Controle de permissão (admin do portal ou usuário autorizado) e tela de concessão (~6h) — admin concede via `BX24.selectUsers`; nomes lidos do portal

## 7. Gestão de agentes (agent-management)

- [x] 7.1 Repositório de agentes filtrado por `tenantId` e testes de isolamento entre tenants (~4h) — `AgentRepository` (módulo `agents`): todo método exige o `tenantId`, esconde `DELETED`, id malformado vira inexistente; `getById` responde 404 `AGENT_NOT_FOUND`
- [x] 7.2 Criar agente: validação, limite de 5 agentes, modelo permitido, criação no GPTMaker, `prefferModel` nas settings, webhooks, persistência (~10h) — `AgentService.create` + `POST /app/agents` (e `GET` lista/detalhe): lock Redis por tenant, modelo padrão ou liberado no plano da `subscription_state` (sem plano ⇒ só o padrão), webhooks em `API_PUBLIC_URL/gptmaker/webhooks/{event}?t=` com hash do token; falha após criar remove o agente no GPTMaker
- [x] 7.3 Editar agente e settings (incl. troca de modelo) refletindo no GPTMaker com invalidação de cache (~6h) — `AgentService.update` + `PATCH /app/agents/:id`: lock por agente, GPTMaker antes do registro local (perfil completo com prefixo; settings mescladas + `prefferModel`), falha nas settings desfaz o perfil; troca de modelo passa pela regra do plano; ainda não há cache de agente para invalidar (entra com o cache por `botId`, seção 9)
- [x] 7.4 Inativar/reativar (`/inactive`, `/active`) (~3h) — `POST /app/agents/:id/inactivate|activate`: idempotentes, GPTMaker antes do registro local; inativação manual grava `MANUAL`; reativação só de `MANUAL` (`AGENT_INACTIVE_BY_SYSTEM` para assinatura/suspensão/desinstalação) e recusada com tenant `SUSPENDED`
- [x] 7.5 Remover agente (DELETE no GPTMaker + soft delete + desregistrar chatbot) (~4h) — `AgentService.remove` + `DELETE /app/agents/:id` (204): lock por agente, GPTMaker antes do registro local; 404 no GPTMaker (inclusive `OUT_OF_SYNC` ou retentativa) só marca `DELETED`; libera a vaga no limite. Ainda não há chatbot registrado: desregistrar fica na 9.1, e o worker (9.4) só encaminha mensagens de agente `ACTIVE`
- [x] 7.8 Espelhar agente como item de assinatura (`billable=false`) no `crmthink-platform` via `payments_outbox` (~4h) — `AgentItemMirror`: criar, editar nome, inativar, reativar, remover, desinstalar e reinstalar agendam `agent-item.sync` na mesma transação da mudança local; o sync leva o estado atual ao serviço (`createItem` idempotente por `externalRef` = id do agente, `updateItem` de título/status `active`|`cancelled`, `removeItem` achado por `listItems`). Assinatura da projeção local ou, sem ela, de `GET /v1/installations/{id}/subscription`; `NO_SUBSCRIPTION`/`SUBSCRIPTION_ENDED` encerram a linha sem espelhar
- [x] 7.6 Inativação/reativação automática por assinatura expirada/regularizada e suspensão do tenant (~5h) — `AgentAccessPolicy` decide o bloqueio (`UNINSTALLED` > `TENANT_SUSPENDED` > `SUBSCRIPTION_EXPIRED`: assinatura `cancelled`/`trial_expired` ou `past_due` com carência vencida; sem projeção, nada bloqueia). O `AgentLifecycleListener` reconcilia no novo gancho `onAccessChanged` e na desinstalação/reinstalação: inativa os ativos com o motivo, troca o motivo de quem já está inativo pelo sistema, reativa só inativações do sistema; `MANUAL` nunca muda; cada transição agenda `agent-item.sync`. Reativação manual recusada com assinatura encerrada (`SUBSCRIPTION_INACTIVE`). Quem dispara o gancho: 12.3, 12.5 e 15.4
- [x] 7.7 UI NextJS: lista de agentes, formulário (com seletor de modelo e custo por resposta), ações e estados de erro (~16h) — `/app` (lista com status e motivo, inativar/reativar, remover com confirmação), `/app/agents/new` e `/app/agents/[id]` (dados, empresa, modelo com créditos por resposta, settings de atendimento só na edição; envia só o que mudou). Leitura para quem não gerencia; `OUT_OF_SYNC` só leitura. Novo `GET /app/models`: padrão + liberados no plano, do mais barato ao mais caro

## 8. Treinamentos (agent-training)

- [x] 8.1 Integração com Spaces/SeaweedFS (`@aws-sdk/client-s3`): caminhos aleatórios e URL pré-assinada longa (~4h) — `ObjectStorage` (`shared/storage`): chave `trainings/<tenantId>/<aleatório>.<ext>` sem o nome do arquivo, bucket privado, URL pré-assinada de até 7 dias (limite do SigV4) assinada com `STORAGE_PUBLIC_ENDPOINT` quando o host visto pelo GPTMaker difere do interno, nome original no `Content-Disposition`; variáveis `STORAGE_*` obrigatórias
- [x] 8.2 Endpoints de criação TEXT, WEBSITE (subpáginas, intervalo), VIDEO e DOCUMENT (validação tamanho/MIME) (~10h) — `POST /app/agents/:agentId/trainings` (JSON: texto até 50 mil caracteres, site com subpáginas e intervalo sem `THIRTY_SECONDS`, vídeo) e `/document` (multipart `file`, até 20 MB; pdf, docx, doc, xlsx, pptx, txt, md, csv pela extensão, conferida pelos bytes iniciais; texto só UTF-8). Registro local `PROCESSING` antes do GPTMaker e `callbackUrl` com token (hash local); falha no GPTMaker descarta registro e objeto. O id criado (a API não devolve) é achado listando o tipo: novo sem registro local que casa com o conteúdo, com lock por agente; sem certeza, fica nulo para a 8.5. `GET` lista os não removidos. Formatos e tamanho aceitos pelo GPTMaker a confirmar em staging
- [x] 8.3 Endpoint de `callbackUrl` com token para status (`PROCESSING`/`DONE`/`FAILED`) (~4h) — `POST /gptmaker/trainings/callback?t=` (público; token aleatório por treinamento, só o hash no banco; desconhecido ou removido ⇒ 404). Formato não documentado: `interpretCallback` aceita `status`/`state`/`event`, `success` e `error`, também dentro de `data`/`training`; `FAILED` guarda o motivo, conclusão posterior limpa; corpo não reconhecido não muda o status. Completa o id do GPTMaker só de `trainingId`/`data.id`, sem tomar o de outro registro. Todo corpo recebido vai para o log: capturar o formato real em staging (10.1) e ajustar a leitura
- [x] 8.4 Listar, editar (TEXT) e remover; apagar objeto do storage ao remover documento (~5h) — `GET` (8.2), `PATCH /app/agents/:agentId/trainings/:id` (só `TEXT`, `TRAINING_NOT_EDITABLE` nos demais) e `DELETE` (204), no lock por agente da criação; GPTMaker antes do registro local. Sem id do GPTMaker, procura pelo conteúdo e grava; na edição, sem achar ⇒ `TRAINING_NOT_READY`, na remoção só remove aqui. Remoção: 404 no GPTMaker ou agente `OUT_OF_SYNC` só marca removido; documento sai do storage depois do registro
- [x] 8.5 Sincronização com `GET /agents/{id}/trainings` (GPTMaker como fonte da verdade) (~5h) — job `training-sync` no worker (minuto 30 de cada hora, lock Redis), por agente ativo/inativo e no lock por agente da criação (ocupado ⇒ próxima rodada). Lista os quatro tipos antes de mudar algo (falha ⇒ agente intacto). Completa ids pelo conteúdo ou pelo par único do tipo; importa como `DONE` o que só existe lá; conteúdo de lá vale sobre o local; ausente lá só é removido (com o documento) na segunda sync seguida e se tiver mais de 10 min; sem id e sem correspondente após 1 h ⇒ `FAILED`. Paginação tolerante (`collectAllPages`, base 0 ou 1) também na criação
- [x] 8.6 Limites de treinamento do plano (`PLAN_TRAINING_LIMIT`) (~3h) — `max_trainings` e `max_document_storage_mb` do `plan_entitlement` do plano da `subscription_state` (nulo = sem limite), somando todos os agentes do tenant sem os removidos; sem plano, `TRAINING_DEFAULT_MAX_TRAININGS` (10) e `TRAINING_DEFAULT_MAX_STORAGE_MB` (50), a validar com o produto. Conferido no lock do agente antes do GPTMaker (documento também antes do upload); `details` com `kind`, `used` e `limit`. `GET` da listagem devolve `usage`. Importados pela sync não passam pelo limite
- [x] 8.7 UI NextJS de treinamentos com upload, status e reenvio (~12h) — aba Treinamentos em `/app/agents/[id]/trainings` (layout do agente com cabeçalho e abas Configurações/Treinamentos): uso dos limites do plano, lista com status (atualiza a cada 5 s enquanto houver `PROCESSING`), modal de adicionar por tipo (documento com arrastar e soltar, conferência de extensão e tamanho antes do envio), edição de texto, remoção com confirmação e reenvio dos `FAILED` (`POST .../:id/retry`: mesmo registro, remove a tentativa anterior no GPTMaker, documento com URL pré-assinada nova). Somente leitura sem permissão ou agente `OUT_OF_SYNC`

## 9. Canal chatbot Bitrix (bitrix-chatbot-channel)

- [x] 9.1 Registrar/atualizar/desregistrar chatbot por agente via `imbot.v2.Bot.register` e persistir `botId` (~6h) — `ChatbotService` (módulo `channel`): bot `type: openline` + `isSupportOpenline`, `eventMode: webhook` em `API_PUBLIC_URL/bitrix/bots/events` (recepção na 9.2), código `gptmaker_agent_<id>`; `register` é idempotente mas não atualiza, então nome, cargo e webhook vão por `Bot.update`; foto à parte e sem bloquear (`personalPhoto` base64, campo não documentado na v2: confirmar no portal); `BOT_NOT_FOUND` ⇒ registra de novo; agente removido ⇒ `Bot.unregister`. `agent_bot.profile_hash` (migração 0002) evita chamadas sem mudança. Disparo: `AgentEvents` (criação, nome/foto, remoção; desregistro da 7.5), reinstalação (registra de novo) e desinstalação (esquece os bots); reconciliação a cada 15 min no worker para o que falhou. Inativo mantém o bot (9.4 não encaminha)
- [ ] 9.2 Endpoint de eventos de mensagem: validar `application_token`, dedupe Redis, publicar no consistent-hash por `dialogId` (~6h)
- [ ] 9.3 Topologia RabbitMQ: filas particionadas, retry com TTL escalonado, DLQ (~8h)
- [ ] 9.4 Worker: checar agente ativo, atendimento humano e saldo (Redis com fallback Postgres) (~5h)
- [ ] 9.5 Chamar `/agents/{id}/conversation` com `contextId = tenantId:dialogId` (texto, imagem, áudio, documento) (~8h)
- [ ] 9.6 Publicar resposta via `imbot.message.add` e emitir `usage.response` com `modelCode` (~5h)
- [ ] 9.7 Saldo insuficiente: não encaminhar ao GPTMaker, enviar mensagem `SYSTEM = Y` de falta de créditos no diálogo, transferir para operador, registrar `BLOCKED_NO_CREDIT` (~5h)
- [ ] 9.8 Transferência para humano via `onTransfer` + `human-start`; `human-stop` ao encerrar (~8h)
- [ ] 9.9 Esgotamento de tentativas: DLQ, transferência, sem débito (~4h)
- [ ] 9.10 Teste ponta a ponta em staging (mensagem → resposta → débito) (~6h)

## 10. Webhooks e gatilhos (agent-triggers)

- [ ] 10.1 Confirmar payload real dos webhooks GPTMaker (capturar exemplos em staging) e documentar em `docs/` (~4h)
- [ ] 10.2 Token por agente (hash) e configuração de webhooks via `PUT /agents/{id}/webhooks` (~4h)
- [ ] 10.3 Endpoint `/gptmaker/webhooks/{event}`: validar token, gravar `agent_event`, publicar em `triggers.events` (~5h)
- [ ] 10.4 CRUD de gatilhos (evento → ações), ativar/desativar (~6h)
- [ ] 10.5 Motor de templates de mapeamento de campos (~8h)
- [ ] 10.6 Ações: lead, negócio (funil/etapa), comentário na timeline, tarefa, business process, webhook de saída HMAC (~16h)
- [ ] 10.7 Execução assíncrona com retentativa e `trigger_execution` (~6h)
- [ ] 10.8 UI NextJS de gatilhos e histórico (~14h)

## 11. Billing de créditos (credit-billing)

- [ ] 11.1 Serviço de ledger append-only com carteiras `PLAN`/`EXTRA`, idempotência, `tenant_balance` sob `FOR UPDATE` (transação Drizzle), espelho Redis (~12h)
- [ ] 11.2 Serviço de ciclo (acionado por `activated`/`renewed`/`ended`): `EXPIRE` do saldo positivo de `PLAN` e `EXTRA`, abatimento de saldo negativo e de `credit_deduction` pendente, e `GRANT` idempotente por (assinatura, período) (~10h)
- [ ] 11.3 Débito em cascata `TRIAL` → `PLAN` → `EXTRA` (lançamentos separados por carteira) e regra de ajustes da reconciliação por carteira (~8h)
- [ ] 11.4 Consumidor de `usage.response`: `DEBIT` = custo vigente do modelo, guardando `model_code`/`unit_cost`, idempotente por mensagem (~5h)
- [ ] 11.5 Alertas 80%/100%/zerado via `im.notify.system.add` aos destinatários de avisos (uma vez por ciclo) (~6h)
- [ ] 11.6 Bloqueio/desbloqueio de encaminhamento conforme saldo (~3h)
- [ ] 11.7 UI NextJS: saldo do trial (com fim), saldo do plano, saldo adicional, data de expiração (fim do ciclo), renovação, extrato por agente/dia (~12h)
- [ ] 11.8 Testes de concorrência do ledger (~6h)
- [ ] 11.9 Migração `notification_recipient` e `notification_log`; serviço de avisos com fallback para administradores do portal (~6h)
- [ ] 11.10 UI NextJS: tela de destinatários de avisos (seleção de usuários do portal) (~6h)
- [ ] 11.11 Carteira `TRIAL`: `GRANT` 500 no início, job de `EXPIRE` em `trial_ends_at` (mesmo com plano ativo); bloqueio de pacote durante trial sem plano (~6h)

## 12. Integração com o billing do crmthink-platform (payments-integration)

- [ ] 12.1 `PaymentsClient` sobre o `PlatformClient` do SDK publicado (`@crmthink-sources/platform-sdk`, tipos gerados do contrato pela plataforma) + `cockatiel`, chave de API em env, mapeamento dos códigos de erro; contrato novo chega por versão do pacote (~4h)
- [ ] 12.2 Endpoint `/platform/events`: validação `X-Platform-Signature` com a biblioteca da plataforma (raw body, 5 min), persistência em `payment_event`, dedupe por `eventId`, publicação em `payments.events`; fixtures a partir da seção `webhooks` do OpenAPI (~4h)
- [ ] 12.3 Worker de eventos: projeção `subscription_state` com controle de versão e efeitos por tipo (tabela do design D9) (~12h) — assinatura nova (inclusive depois de encerrada): agendar `agent-item.sync` para os agentes não removidos do tenant, pois o sync sem assinatura é descartado; após gravar a projeção, emitir `onAccessChanged` do `TenantLifecycle` (7.6)
- [ ] 12.4 Trial: tratamento de `subscription.trial_started` e tela de ativação em andamento até o evento (~5h)
- [ ] 12.5 Carência: `grace_until` em `past_due`, job de inativação a cada 15 min, limpeza em `recovered`/`renewed` (~5h) — o job só emite `onAccessChanged` para os tenants com carência vencida; a regra está na `AgentAccessPolicy` (7.6)
- [ ] 12.6 Troca de plano: chamada ao serviço, `GRANT` proporcional no upgrade, plano futuro no downgrade e troca para modelo padrão (~10h)
- [ ] 12.7 Avisos `PAYMENT_FAILED`, `PERIOD_ENDING` e `MODEL_DOWNGRADED` aos destinatários (~4h)
- [ ] 12.8 Estornos: `charge.refunded`/`charge.disputed` → `REFUND` + `credit_deduction` (~8h)
- [x] 12.9 Outbox `payments_outbox` para chamadas de saída não críticas (itens de assinatura) com retentativa (~5h) — `PaymentsOutbox` + job do worker a cada minuto (lock Redis): uma linha por transação com `FOR UPDATE SKIP LOCKED`, espera exponencial de 1 min até 1 h, `FAILED` com alerta após 20 tentativas; pendências do mesmo agregado se fundem. Feita junto com a 7.8
- [ ] 12.10 Job de consistência a cada 6h com `GET /v1/installations/{id}/subscription` (~4h)
- [ ] 12.11 UI NextJS: planos (serviço + `plan_entitlement`), Checkout embutido (Stripe.js + `clientSecret`), estado "processando" até o evento, pacotes com aviso de validade, status da assinatura/trial, "Gerenciar pagamento" (portal em nova janela) (~20h)
- [ ] 12.12 Teste ponta a ponta em staging com o `crmthink-platform` (Stripe test mode), junto com a tarefa 17.5 da plataforma: trial, contratação, renovação, falha de pagamento, pacote, estorno, cancelamento (~6h)

## 13. Direitos dos planos

- [ ] 13.1 Validar com o time da plataforma os produtos "GPTMaker" (assinatura) e "Créditos GPTMaker" (compra única, um plano por pacote) cadastrados nos SPAs 1134/1138 (tarefa 17.2 do `crmthink-platform`) e definir créditos por plano/pacote (~1h)
- [ ] 13.2 Cadastrar `plan_entitlement` e modelos permitidos para cada plano; ocultar planos sem direitos (~2h)

## 14. Reconciliação de consumo (usage-reconciliation)

- [ ] 14.1 Job diário: `credits-spent` do dia anterior por agente → `usage_daily_real`, retentativa por agente (~6h)
- [ ] 14.2 Comparar com débitos do dia e lançar `ADJUSTMENT` idempotente acima da tolerância (~8h)
- [ ] 14.3 Média real de créditos por resposta por modelo e sugestão de custo no backoffice (~4h)
- [ ] 14.4 Relatório mensal: consumo GPTMaker vs débitos vs receita (via `crmthink-platform`), por tenant/agente, consumo órfão (~10h)
- [ ] 14.5 Testes com consumo maior, menor e reexecução (~5h)

## 15. Backoffice (admin-backoffice)

- [ ] 15.1 Autenticação de operadores (senha + TOTP ou SSO) e perfis `ADMIN`/`SUPPORT` (~12h)
- [ ] 15.2 Tela de direitos dos planos e pacotes (créditos, modelos permitidos, limites de treinamento) (~8h)
- [ ] 15.3 Tela do catálogo de modelos (CRUD, histórico de custo, sugestão da reconciliação) (~6h)
- [ ] 15.4 Gestão de tenants: listagem, suspensão/reativação, concessão de créditos com justificativa (~10h) — suspender/reativar grava o status e emite `onAccessChanged` (7.6)
- [ ] 15.5 Visão de assinaturas: projeção local, eventos recebidos e link para o SPA (~6h)
- [ ] 15.6 Tela do workspace: status/créditos, órfãos (remover/vincular), `OUT_OF_SYNC` (~8h)
- [ ] 15.7 Relatório do partner e visão de DLQ/erros por tenant (~10h)
- [ ] 15.8 Trilha de auditoria (`audit_log`) em todas as ações (interceptor NestJS) (~5h)

## 16. Observabilidade, segurança e go-live

- [ ] 16.1 Prometheus + Grafana (ou Grafana Cloud): latência GPTMaker, filas/DLQ, débitos, erros por tenant, eventos do `crmthink-platform` (~8h)
- [ ] 16.2 Alertas: DLQ, workspace `!= ACTIVE`, falha de reconciliação, eventos do `crmthink-platform` atrasados/falhando, disco do Droplet (~5h)
- [ ] 16.3 Tracing OpenTelemetry (`@opentelemetry/sdk-node`) API → fila → worker (~6h)
- [ ] 16.4 Revisão de segurança: isolamento de tenant, validação de webhooks (Bitrix, GPTMaker, `crmthink-platform`), cifragem, firewall, CSP (~10h)
- [ ] 16.5 Teste de carga do fluxo de mensagens no Droplet (k6) (~8h)
- [ ] 16.6 Runbook (DLQ, reautorização de tenant, rotação de segredos, restore de backup, fechamento mensal, eventos de pagamento pendentes) (~8h)
- [ ] 16.7 Piloto com 1–3 clientes (trial e assinaturas `manual`) e acompanhamento da reconciliação (~16h de esforço, ~2 semanas de calendário)
- [ ] 16.8 Abertura geral com Stripe live no `crmthink-platform` (~4h)

## Estimativa

| Seção | Horas |
|---|---:|
| 1. Fundação | 25 |
| 2. Infra e CI/CD | 36 |
| 3. Modelo de dados | 22 |
| 4. Cliente GPTMaker e workspace | 43 |
| 5. Catálogo de modelos | 19 |
| 6. Instalação, tokens e sessão | 39 |
| 7. Gestão de agentes | 52 |
| 8. Treinamentos | 43 |
| 9. Canal chatbot | 61 |
| 10. Webhooks e gatilhos | 63 |
| 11. Billing de créditos | 80 |
| 12. Integração payments | 87 |
| 13. Direitos dos planos | 3 |
| 14. Reconciliação | 33 |
| 15. Backoffice | 65 |
| 16. Observabilidade e go-live | 65 |
| **Subtotal** | **736** |
| Contingência 20% (payload webhooks GPTMaker, ajustes de contrato com o `crmthink-platform`, retrabalho) | 147 |
| **Total** | **~885** |

Premissas:
- 1 dev sênior full-stack com TypeScript/NestJS/NextJS, ~6h produtivas/dia ⇒ ~148 dias úteis (~7 meses). Com 2 devs (backend + frontend em paralelo) ⇒ ~4 meses, pois parte do trabalho é sequencial.
- `crmthink-platform` já implementado (instalação, tokens, sessão, cobrança, eventos e OpenAPI). Não entra nesta estimativa o que é da plataforma: deploy (tarefas 16.x dela) e onboarding do GPTMaker (17.x: campos nos SPAs, produtos/planos, apps Bitrix, registro do app). Desenvolvimento das seções 6 e 12 segue contra WireMock/OpenAPI; os testes ponta a ponta (9.10, 12.12) dependem da plataforma em staging com o onboarding feito.
- UI sem design system pronto: telas simples com componentes de biblioteca (ex.: shadcn/ui); design customizado não incluso.
- Caminho crítico para o piloto (MVP): seções 1–9, 11, 12, 13 e 16.1–16.7 (~570h + contingência); gatilhos (10), reconciliação (14.3–14.4) e parte do backoffice (15.5–15.7) podem vir depois do piloto.
