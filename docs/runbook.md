# Runbook de operação

Guia para quem opera o ThinkFlow (staging e produção). Cada seção diz o que o sistema faz sozinho, como
conferir e o que fazer na mão. Onde **não existe** ferramenta pronta, isso está escrito: não improvise
sem ler a seção.

Convenções dos comandos (ajuste o diretório e o ambiente):

| Ambiente | Diretório da stack | Domínio da API                          |
| -------- | ------------------ | --------------------------------------- |
| Produção | `/opt/gptthink`    | `api.gptthink.crmthink.com.br`          |
| Staging  | `/opt/gptmaker`    | `api.thinkflow-staging.crmthink.com.br` |

```sh
ssh deploy@159.89.95.146
cd /opt/gptthink            # ou /opt/gptmaker no staging
alias dc='docker compose -f docker-compose.prod.yml --env-file .env'
dc logs -f backend-api backend-worker
```

Logs são JSON (pino). O campo `"alert":true` marca o que merece alerta; `"alert":"security"` marca
assinatura da plataforma recusada. Exemplo: `dc logs --since 1h backend-worker | grep '"alert":true'`.

## 0. Visão rápida

- Saúde: `curl -fsS https://<api>/health/ready` (Postgres, Redis, RabbitMQ). Worker: `:9464/health/live`
  (só na rede interna).
- Métricas: API `:3001/metrics` e worker `:9464/metrics`, ambos só na rede interna (o Caddy devolve 404 em
  `/metrics`). Não há Prometheus/Grafana configurado (tarefas 16.1/16.2). **Não existem métricas** de
  tamanho de DLQ, eventos de pagamento pendentes, outbox ou reconciliação: use o backoffice, o SQL e os logs.
- Backoffice: `https://<domínio do app>/admin` (tela **Erros** = `/admin/operations`).
- Jobs do worker (cron no fuso do processo, normalmente UTC; confira com `dc exec backend-worker date`,
  porque nenhum `TZ` é definido):

| Job                          | Cron           | Função                                              |
| ---------------------------- | -------------- | --------------------------------------------------- |
| `notification-dispatch`      | a cada 30 s    | avisos ao cliente (crédito, pagamento)              |
| `payments-outbox`            | a cada 1 min   | espelha agentes na assinatura da plataforma         |
| `subscription-events-sweep`  | a cada 1 min   | republica eventos de assinatura pendentes           |
| `installation-events-sweep`  | a cada 1 min   | republica eventos de instalação pendentes           |
| `trigger-retries`            | a cada 1 min   | retentativas de gatilhos                            |
| `function-publication-sweep` | a cada 1 min   | publicação de funções do agente                     |
| `trial-expiry`               | `*/15`         | expira créditos de trial vencidos                   |
| `grace-expiry`               | `*/15`         | encerra carência de pagamento                       |
| `agent-webhooks-reconcile`   | `*/15`         | alinha webhooks do GPTMaker                         |
| `workspace-health`           | `*/15`         | status e créditos do workspace                      |
| `chatbot-reconcile`          | `*/15`         | registro do chatbot no Bitrix                       |
| `reconciliation-retry`       | `40 * * * *`   | retenta dias de consumo pendentes                   |
| `workspace-sync`             | `0 * * * *`    | agentes órfãos / `OUT_OF_SYNC`                      |
| `training-sync`              | `30 * * * *`   | treinamentos                                        |
| `training-image-cleanup`     | `15 4 * * *`   | limpeza de imagens                                  |
| `reconciliation-daily`       | `20 6 * * *`   | reconciliação de consumo (03:20 de Brasília se UTC) |
| `subscription-consistency`   | `17 */6 * * *` | confere assinaturas com a plataforma                |

Cada job usa lock no Redis: mais de um worker não duplica a execução.

## 1. DLQ (mensagens do canal que falharam)

### Como funciona

- Entrada: filas `channel.inbound.0..N-1` (`CHANNEL_INBOUND_PARTITIONS`, padrão 4), uma partição por diálogo.
- Falha transitória (GPTMaker/Bitrix fora): reagenda em 10 s, 1 min e 5 min (`CHANNEL_RETRY_DELAYS_MS`).
  Esgotadas as tentativas, vai para `channel.inbound.dlq`.
- Erro permanente (`BitrixError` `API_ERROR`/`UNINSTALLED`/`AUTH_ERROR` ou erro de conversa permanente):
  vai direto para a DLQ.
- Mensagem malformada (sem tenant/agente/diálogo) é descartada e só aparece no log.
- `channel.transfer.dlq` recebe as transferências para humano que falharam.
- As DLQs **não têm consumidor nem TTL**: nada as reprocessa sozinho.
- Ao cair na DLQ o sistema já age: grava `message_log` como `FAILED` (com tentativas e erro) e, se a
  resposta ainda não tinha sido enviada, **transfere o diálogo para um operador humano** sem debitar
  créditos. Por isso, na maioria dos casos, não é preciso reprocessar.
- Alertas nos logs: `mensagem do chatbot esgotou as tentativas (DLQ)`, `... erro permanente (DLQ)` e
  `mensagem na DLQ e diálogo não transferido ao operador` (este é o grave: o cliente ficou sem resposta).

### Conferir

1. Backoffice → **Erros**: tamanho das duas DLQs e ranking de falhas por portal (7 dias).
   `GET /admin/operations/dlq/inbound?limit=20` (ou `transfer`) lista metadados (portal, diálogo,
   tentativas, último erro), sem o texto do cliente. A leitura não consome a mensagem.
2. Detalhe por portal: `GET /admin/tenants/:id/failures` (30 dias).
3. Direto no RabbitMQ (a porta 15672 **não** é publicada em produção):
   `dc exec rabbitmq rabbitmqctl list_queues name messages | grep dlq`.

### Agir

1. Leia o último erro. Se for de dependência (GPTMaker/Bitrix fora), confirme que voltou
   (`/health`, status do workspace em Backoffice → Workspace).
2. Se o log mostrou `diálogo não transferido`, avise o cliente/atendimento do portal: aquele diálogo
   precisa de atendimento humano manual.
3. `AUTH_ERROR`/`UNINSTALLED` na DLQ → veja a seção 2.
4. Esvaziar: `POST /admin/operations/dlq/:queue/purge` (só ADMIN, auditado). **É total**, não existe
   descarte individual. Faça depois de registrar o que importava (ticket com a lista do `peek`).

### Não existe

- Rota, CLI ou job para **reprocessar** uma DLQ. Reprocessar exigiria shovel/Management do RabbitMQ
  (plugin habilitado, nenhum shovel configurado, porta não exposta; só via `docker compose exec` ou
  túnel SSH). Como a resposta ao cliente expira de sentido rápido e já houve transferência humana,
  o padrão é **não reprocessar**.
- Mudar `CHANNEL_INBOUND_PARTITIONS` só com as filas vazias; mudar `CHANNEL_RETRY_DELAYS_MS` cria filas
  novas e deixa as antigas órfãs.

## 2. Reautorização de tenant (`AUTH_ERROR`)

### Como funciona

- O backend **não renova token do Bitrix**: o refresh token fica no `crmthink-platform`. Aqui só há cache
  Redis cifrado até `expiresAt - 5 min`. Plataforma respondendo 409 vira `AUTH_ERROR`; 410 vira
  `UNINSTALLED`.
- O status do portal muda para `AUTH_ERROR` quando a plataforma envia o evento `installation.auth_error`
  (processado pelo worker). Log: `portal com erro de autorização; processamento pausado`.
- Efeito: novas mensagens viram `SKIPPED_INACTIVE` e não chegam ao GPTMaker; sync do chatbot é pulado;
  ações de gatilho falham como transitórias. Os agentes **não** são inativados.
- O cliente vê um banner no app pedindo que um administrador reinstale o app. **Não há notificação
  Bitrix** nem alerta para o operador além do log.

### Voltar ao normal

1. Confirme o status em Backoffice → Portais (`/admin/tenants`).
2. Peça ao administrador do portal para **reinstalar o app** (ou reautorizar). A reinstalação passa pelo
   instalador (`/platform/installer`), força `status=ACTIVE` (exceto se estava `SUSPENDED`), limpa os
   caches de token e confere com `app.info`.
3. Alternativa: a plataforma enviar `installation.auth_restored` (volta a `ACTIVE` sozinho).
4. Valide: nova mensagem no canal responde; `message_log` deixa de registrar `SKIPPED_INACTIVE`.

### Atenção

- `POST /admin/tenants/:id/reactivate` **só funciona para `SUSPENDED`** (senão 409
  `TENANT_STATUS_CONFLICT`). Não existe rota/CLI admin para tirar do `AUTH_ERROR`.
- Se o erro voltar logo após reativar, o problema é a autorização na plataforma/Bitrix: investigue lá.
- Suspensão manual (`POST /admin/tenants/:id/suspend`) aceita `ACTIVE` ou `AUTH_ERROR`.

## 3. Rotação de segredos

Todo segredo vive no secret `ENV_FILE` do GitHub Environment (`staging`/`production`). Fluxo geral:
editar o `ENV_FILE` → Actions → **Deploy** (mesmo SHA; produção pede aprovação) → conferir
`/health/ready`. O deploy volta sozinho para a tag anterior se o health falhar, mas isso **não** desfaz
alterações feitas fora do deploy (senha do banco, por exemplo).

| Segredo                                                    | Rotaciona?           | Procedimento / impacto                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLATFORM_WEBHOOK_SECRETS`                                 | Sim, sem corte       | 1) gere o novo no `crmthink-platform`; 2) `novo,antigo` no `ENV_FILE` e deploy; 3) plataforma passa a assinar com o novo; 4) depois de ~24 h, só `novo` e deploy. Assinatura inválida aparece como `alert:"security"`.                                                                                                                          |
| `PLATFORM_API_KEY`                                         | Sim, com coordenação | Rotação é feita na plataforma (fora deste repo); valor único: troque no `ENV_FILE` e faça deploy no mesmo momento. Chamadas à plataforma falham entre a troca de um lado e do outro.                                                                                                                                                            |
| `GPTMAKER_API_TOKEN`                                       | Sim                  | Novo token em app.gptmaker.ai (developers), `ENV_FILE`, deploy. **Não** troque `GPTMAKER_WORKSPACE_ID`: o `workspace-sync` trataria os agentes como órfãos.                                                                                                                                                                                     |
| `STORAGE_ACCESS_KEY/SECRET_KEY`                            | Sim                  | Crie chave nova no painel DigitalOcean (API → Spaces Keys, só desse ambiente), `ENV_FILE`, deploy, revogue a antiga. Bucket é compartilhado; o prefixo (`staging`/`production`) e a chave são por ambiente.                                                                                                                                     |
| Senhas Postgres e RabbitMQ                                 | Manual               | Mudar o `.env` **não** altera banco/broker já inicializados. Faça `ALTER USER ... PASSWORD` no Postgres e `rabbitmqctl change_password` no RabbitMQ e **na mesma janela** atualize `POSTGRES_PASSWORD`/`DATABASE_URL` e `RABBITMQ_*`/`RABBITMQ_URL` (precisam coincidir) e faça deploy. Janela de indisponibilidade esperada. Não automatizado. |
| `DEPLOY_SSH_KEY`, `GHCR_PULL_TOKEN`                        | Sim                  | Troque o secret e a chave autorizada do usuário `deploy`; teste com um deploy do mesmo SHA.                                                                                                                                                                                                                                                     |
| Stripe                                                     | n/a aqui             | As chaves secretas ficam no `crmthink-platform`; este repo só recebe `PUBLIC_STRIPE_PUBLISHABLE_KEY` no frontend.                                                                                                                                                                                                                               |
| Tokens de webhook de agente                                | Automático           | O job `agent-webhooks-reconcile` troca o token quando `API_PUBLIC_URL` muda ou o hash diverge. Não há rotação manual.                                                                                                                                                                                                                           |
| Token de CRM do agente (MCP)                               | Por agente           | Reabilitar o acesso do agente ao CRM gera token novo; o cliente atualiza onde o usou.                                                                                                                                                                                                                                                           |
| Segredo HMAC de webhook de saída (`trigger_action.secret`) | Por ação             | Exibido uma vez; recriar a ação gera novo e o receptor precisa ser atualizado.                                                                                                                                                                                                                                                                  |
| **`DATA_ENCRYPTION_KEY`**                                  | **NÃO**              | Ver abaixo.                                                                                                                                                                                                                                                                                                                                     |

### `DATA_ENCRYPTION_KEY` — não rotacionar

O `FieldCipher` aceita **uma** chave e só o formato `v1:`. Não há suporte a múltiplas chaves nem CLI de
re-cifragem. Trocar a chave torna ilegíveis: `tenant_ai_key.api_key`, `agent_crm_access.token_encrypted`,
`trigger_action.secret`, `backoffice_user.totp_secret` (operadores teriam de refazer o TOTP via
`POST /admin/operators/:id/reset-totp`) e os caches Redis cifrados. Guarde a chave atual em cofre com
backup: perdê-la equivale a perder esses dados. Se um dia for necessário rotacionar (vazamento), isso
vira uma migração própria (ler com a chave antiga, regravar com a nova, versão `v2:`), com change de
OpenSpec: **não está implementado**.

### Antes de qualquer rotação

Confirme que `infra/.env.staging`, `infra/.env.production` e `infra/.env.staging.github` (se existirem
na sua máquina) estão no `.gitignore` e nunca vão para o repositório.

## 4. Backup e restore

### Situação hoje

- **Não há backup automatizado no repositório** (sem cron, sem script). A recomendação é ligar os
  **backups do Droplet e do Volume** no painel DigitalOcean (ver `docs/producao.md` §2). Confirme que
  estão ativos antes de tratar a produção como protegida.
- Dados: Postgres em `${DATA_DIR}/postgres`, RabbitMQ em `${DATA_DIR}/rabbitmq`, Redis (AOF) em
  `${DATA_DIR}/redis`, com `DATA_DIR=/mnt/gptmaker-data/{staging,production}` (Volume `gptmaker-data`).

### Backup manual (antes de mudança arriscada)

```sh
dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > /root/pre-mudanca-$(date +%F).dump
ls -lh /root/pre-mudanca-*.dump   # confirme que não está vazio; copie para fora do Droplet
```

### Restore do Postgres

1. Avise o time e **pare quem escreve**: `dc stop backend-api backend-worker`.
2. Restaure em banco **vazio**. O `credit_ledger` é append-only (trigger bloqueia
   UPDATE/DELETE/TRUNCATE), então não restaure por cima de dados existentes nem use `pg_restore --clean`
   só de dados: crie um banco novo (ou apague e recrie o banco) e restaure inteiro.

```sh
dc exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
dc exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < /root/pre-mudanca-AAAA-MM-DD.dump
```

3. Suba de volta: `dc start backend-api backend-worker`. A API aplica as migrations pendentes no boot
   (`RUN_MIGRATIONS=true`, só o papel `api`). Um dump completo já traz as aplicadas.
4. Valide: `/health/ready`, login no backoffice, um portal conhecido (saldo = soma do ledger),
   `message_log` recente.
5. Correção de saldo depois do restore: **só lançamento compensatório** (`ADJUSTMENT`/`REFUND`), nunca
   edição de linha.

### Redis e RabbitMQ

- Redis: perder só perde locks, caches de token e as pendências da reconciliação; a reconciliação diária
  reprocessa `RECONCILIATION_LOOKBACK_DAYS` (3) dias de novo.
- RabbitMQ: eventos de pagamento/instalação e publicação de funções estão no Postgres e as varreduras
  republicam. Mensagens do chatbot em trânsito se perdem junto com o volume.
- Se perder o `DATA_ENCRYPTION_KEY`, o restore do Postgres não basta (seção 3).

### Rollback de versão

Actions → **Deploy** → Run workflow, com `environment` e `image_tag` (SHA anterior). O `deploy.sh`
espera o health por até 2 min e volta sozinho se falhar. **Rollback de imagem não desfaz migrations**
(não há migration "down"): se a migration nova for incompatível com o código antigo, restaure o banco ou
crie migration corretiva.

## 5. Fechamento mensal

Não há "fechamento" manual: ciclo e reconciliação são automáticos. O que se faz no mês é **conferir**.

### Ciclos de crédito (sem job de virada)

- A virada é guiada por eventos da plataforma (`subscription.activated`/`renewed`): expira o saldo de
  `PLAN` e `EXTRA` (`EXPIRE`), concede `plan_entitlement.credits_per_cycle` (`GRANT`) e abate estornos
  pendentes. É idempotente por assinatura + início do período.
- Plano **sem `plan_entitlement`** gera `alert:true` "plano sem direitos cadastrados; ciclo sem créditos".
  Corrija em Backoffice → Planos (`PUT /admin/plans/:planId`); vale para a próxima virada (para o ciclo
  já aberto, use concessão manual com justificativa: `POST /admin/tenants/:id/credits`).
- Carência: 24 h após a falha de pagamento (fim de semana empurra para segunda, fuso de São Paulo);
  `grace-expiry` inativa os agentes ao vencer.
- Trial: 500 créditos na carteira `TRIAL`; `trial-expiry` expira os vencidos.

### Reconciliação de consumo

- `reconciliation-daily` (06:20 no fuso do processo) lê o consumo real por agente/modelo no GPTMaker dos
  últimos 3 dias (exceto hoje) e lança `ADJUSTMENT` para igualar ao que foi debitado. Diferença acima do
  limite fica em `REVIEW` e **não é lançada** (`alert:true` "ajuste aguardando revisão").
- `reconciliation-retry` (minuto 40 de cada hora) retenta dias que falharam; abandona após 14 dias
  (`warn`: "reconciliação do agente abandonada após 14 dias").

### Checklist (primeiros dias do mês seguinte)

1. Backoffice → Consumo (`GET /admin/reconciliation/partner-report?month=AAAA-MM`): **dias encerrados =
   dias do mês** (o mês corrente só vale até ontem). Dia faltando = coleta pendente.
2. `GET /admin/reconciliation/reviews`: nenhum item `open`. Para cada um, decida (ADMIN):
   `POST /admin/reconciliation/reviews/:agentId/:AAAA-MM-DD` com `approve` (lança `debitado - real`)
   ou `dismiss` (mantém). A decisão vale enquanto os totais do dia não mudarem. Auditado.
3. Logs do período sem `reconciliação do agente falhou; pendente`/`abandonada`:
   `dc logs --since 72h backend-worker | grep -E 'falhou; pendente|abandonada'`.
4. Pendências no Redis: `dc exec redis redis-cli SMEMBERS reconciliation:pending` (formato
   `<agentId>|<dia>`) e `reconciliation:pending-unlinked`.
5. Consumo órfão (agentes sem portal, `usage_daily_unlinked`): resolva em Backoffice → Workspace
   (remover ou vincular) antes de fechar a conta com a fatura do partner.
6. Custo e margem: o relatório usa `GPTMAKER_CREDIT_COST_CENTS` (sem ele mostra só créditos). A conta
   partner é pós-paga: compare o consumo com a **fatura** do GPTMaker (não existe endpoint de consumo do
   workspace inteiro). Saldo 0 no workspace é normal.
7. Receita: vem dos eventos de pagamento **processados**; assinaturas são estimadas pelo preço do plano.
   Eventos presos (seção 6) distorcem o número: resolva-os antes.

### Não existe

- Disparo manual da reconciliação (sem rota nem CLI). Um dia só é refeito pelos crons, dentro da janela
  de 3 dias ou pela pendência. Dia mais antigo que a janela e sem pendência exige intervenção de
  desenvolvimento.

## 6. Eventos de pagamento pendentes

### Entrada (plataforma → ThinkFlow)

- `POST /platform/events` (assinado, HMAC com janela de 5 min) grava em `payment_event` (dedupe por
  `event_id`) e publica no RabbitMQ. Se o publish falhar, fica para a varredura.
- Status: `RECEIVED`, `PROCESSED`, `OBSOLETE`, `FAILED`. As varreduras (`subscription-events-sweep`,
  `installation-events-sweep`, 1 min) republicam `RECEIVED`/`FAILED` com `attempts < 20` e mais de 60 s,
  até 100 por rodada. Com **20 tentativas** o evento fica `FAILED` para sempre (log `alert:true`).
- Compras (`purchase.paid`) com créditos de pacote ausentes falham e pedem ação manual.

```sql
-- eventos que não fecharam
SELECT event_id, type, tenant_id, status, attempts, left(error, 120) AS erro, received_at
FROM payment_event
WHERE status IN ('RECEIVED','FAILED')
ORDER BY received_at;
```

(`dc exec postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'`; o portal também mostra os últimos 30
eventos com status/erro em Backoffice → Portais → Assinatura.)

### Agir

1. `RECEIVED`/`FAILED` com `attempts < 20`: aguarde 1–2 min; a varredura resolve. Se persistir, leia o
   `error`: dado inválido no evento, plano sem direitos (seção 5) ou plataforma fora.
2. Divergência de projeção (o evento nunca chegou): Backoffice → portal → Assinatura →
   **Conferir com a plataforma** (`POST /admin/tenants/:id/subscription/check`, ADMIN). Gera o evento que
   faltou, idempotente. O mesmo roda a cada 6 h (`subscription-consistency`) para todos os portais.
   **Compras perdidas (`purchase.paid`) não são reconstruídas**: lance crédito manual com justificativa
   (`POST /admin/tenants/:id/credits`) depois de confirmar o pagamento na plataforma/Stripe.
3. `FAILED` com 20 tentativas: não há reprocesso pronto. Corrija a causa e, **com aprovação de quem for
   responsável pelo banco**, devolva à fila (manual, não suportado oficialmente; confira o evento antes):

```sql
UPDATE payment_event SET status = 'RECEIVED', attempts = 0 WHERE event_id = '<id>';
```

A varredura o pega no minuto seguinte. Idempotência do ledger evita lançamento duplicado.

### Saída (ThinkFlow → plataforma): `payments_outbox`

- Hoje só `agent-item.sync` (espelha o agente como item não cobrável da assinatura). Job `payments-outbox`
  (1 min), backoff `min(60 s·2^(n-1), 1 h)`, **20 tentativas** e então `FAILED` (`alert:true` "chamada ao
  crmthink-platform falhou"). `DONE` com `last_error` = "skipped" (sem assinatura/agente inexistente), ok.

```sql
SELECT id, tenant_id, aggregate_ref, status, attempts, next_attempt_at, left(last_error, 120) AS erro
FROM payments_outbox
WHERE status = 'FAILED' OR (status = 'PENDING' AND next_attempt_at < now() - interval '15 minutes');
```

- Não existe rota/CLI para reenfileirar `FAILED`. Depois de corrigir a causa (plataforma fora, assinatura
  inexistente): `UPDATE payments_outbox SET status='PENDING', attempts=0, next_attempt_at=now() WHERE id=<id>;`
  (manual, mesmas ressalvas). Impacto de não sincronizar é só o espelho na plataforma, não cobrança.

### Avisos ao cliente

`notification_log` (`PENDING`/`SENT`/`FAILED`, 10 tentativas, job a cada 30 s): crédito 80%/zerado,
pagamento falhou, período acabando, modelo rebaixado. Falhas aparecem em Backoffice → Erros.

## 7. Operação geral

- **Operador do backoffice**: `dc exec backend-api node dist/cli/create-operator.js --email <e> --name "<n>"`
  (`--role SUPPORT` opcional; imprime senha temporária uma vez, TOTP no primeiro login). Perda de TOTP/senha:
  `POST /admin/operators/:id/reset-totp` e `/reset-password` (ADMIN).
- **Agentes legados**: `dist/cli/strip-agent-prefix.js [--apply]` e `dist/cli/discard-legacy-agents.js [--apply]`
  (sem `--apply` só lista). Use o caminho `dist/cli/` na imagem (os scripts do `package.json` usam
  `dist/src/cli/` e servem para execução local).
- **Workspace GPTMaker**: Backoffice → Workspace (checar agora, sincronizar, remover/vincular órfão,
  `OUT_OF_SYNC`).
- **Deploy**: push em `develop` → staging; `master` → produção com aprovação do Environment. Rollback:
  seção 4.
- **Capacidade**: duas stacks no mesmo Droplet; `free -m` com swap constante → aumentar o Droplet.
- **Logs dos contêineres**: json-file, 20 MB × 5 arquivos; disco do Droplet sem alerta automático ainda
  (tarefa 16.2).

## 8. Lacunas conhecidas (para evoluir)

1. Sem reprocesso de DLQ, de `payment_event`/`payments_outbox` esgotados nem disparo manual da reconciliação.
2. Sem rotação da `DATA_ENCRYPTION_KEY` e sem rotação automatizada das senhas de Postgres/RabbitMQ.
3. Sem backup automatizado no repositório; depende dos backups do Droplet/Volume no painel.
4. Sem métricas de DLQ, eventos pendentes, outbox e reconciliação, e sem Prometheus/Grafana/alertas (16.1/16.2).
5. `AUTH_ERROR` sai só por reinstalação ou evento da plataforma; não há ação admin.
6. Fuso dos crons depende do `TZ` do contêiner (não definido): confirmar em produção.
