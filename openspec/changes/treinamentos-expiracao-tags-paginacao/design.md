# Design

## Context

Motivação em `proposal.md`. Estado atual relevante:

- Tabela `training` (`backend/src/shared/database/schema/agents.ts`) com `status` enum
  `PROCESSING | DONE | FAILED`, `deletedAt` (soft delete) e `managed` (gerado pela função).
- `TrainingService.list` devolve **todos** os treinamentos do agente; `remove` já sabe apagar no
  GPTMaker tolerando `NOT_FOUND`, pulando agente `OUT_OF_SYNC`, sob `withAgentLock`, e descartando
  documento e imagem do storage.
- `usage`/`assertWithinLimits` contam todo treinamento não removido do tenant.
- `TrainingSyncService.syncAgent` (cron horário) lê todos os treinamentos locais não removidos e
  trata "sumiu no GPTMaker" como remoção (`confirmGone` → `markRemoved`) e "existe lá e não aqui"
  como importação. Um treinamento expirado, sem cuidado, seria soft-deletado por ela.
- Jobs periódicos do projeto: `@Cron` + `DistributedLock.runExclusive` + `runWithContext`
  (`training-image-cleanup`, `function-publication-sweep`).
- Contratos em `@gptmaker/contracts` (`trainings.ts`), validados com zod na borda; a transferência
  (export/import) usa `trainingTransferItemSchema` com `strictObject`.

## Goals / Non-Goals

**Goals:**
- Expiração automática confiável (idempotente, tolerante a falha do GPTMaker, segura com várias
  instâncias) e visível.
- Tags e filtros sem nova chamada ao GPTMaker e sem mexer no estado do treinamento.
- Listagem paginada no servidor, com filtros combináveis e totais corretos.

**Non-Goals:**
- Reativar expirado, aviso prévio de vencimento, expiração de `managed`, catálogo de tags por
  tenant (as sugestões vêm dos próprios treinamentos).

## Decisions

### D1. `EXPIRED` como valor do enum de status, mais `expires_at` e `expired_at`
Colunas novas em `training`: `expires_at timestamptz null`, `expired_at timestamptz null`,
`tags text[] not null default '{}'`; `training_status` ganha `EXPIRED`.
*Alternativa*: derivar "expirado" de `expired_at` mantendo `status`. Descartada: o filtro por
estado, a view e as guardas (editar/reenviar) ficam mais simples e explícitos com um estado único;
o `status` atual (DONE/FAILED/PROCESSING) deixa de ser relevante depois de expirar.
A migration só adiciona o valor ao enum; o índice de varredura **não** usa o literal `EXPIRED` no
predicado (valor novo de enum não pode ser usado na mesma transação da migration): índice parcial
`(expires_at) WHERE expires_at IS NOT NULL AND expired_at IS NULL AND deleted_at IS NULL`.

### D2. Job `training-expiry` no worker
`@Cron('*/15 * * * *')`, `DistributedLock.runExclusive('job:training-expiry', …)` e
`runWithContext({ traceId })`, no mesmo padrão dos demais. Cada execução seleciona até 50
treinamentos vencidos (`expires_at <= now`, sem `expired_at`, sem `deleted_at`), do mais antigo
para o mais novo, e processa um a um; falha em um é logada (`enrichContext` com `tenantId`,
`agentId`) e não interrompe os outros — a próxima execução retoma. O lote limitado evita uma
rajada de chamadas ao GPTMaker; sobra vai para a execução seguinte.
Por treinamento, dentro de `withAgentLock(agentId)` (o mesmo lock de `remove`/`retry`, evitando
corrida com sincronização, edição e reenvio): reler a linha e conferir que continua vencida e
ativa (o usuário pode ter estendido ou removido nesse meio tempo) → remover no GPTMaker (mesma
regra de `remove`: tolera `NOT_FOUND`, pula se o agente está `OUT_OF_SYNC` ou sem id remoto) →
`UPDATE … SET status='EXPIRED', expired_at=now(), error=null` → descartar documento (`documentKey`
zerada) e imagem. A lógica de "apagar remoto + descartar mídia" é **extraída** de `remove` para um
método privado reutilizado pelos dois, em vez de duplicada.
Ordem remoto-antes-do-local: se a remoção remota funciona e o `UPDATE` local falha, a sincronização
horária pode soft-deletar o item (vê "sumiu"); aceito, pois o resultado (não existe mais) é o
desejado. O inverso (marcar local e falhar remoto) deixaria conteúdo vencido ativo no agente sem
nova tentativa — pior.
*Alternativa*: agendar por treinamento numa fila (RabbitMQ com delay). Descartada: o projeto já
usa varredura por cron, a precisão de 15 min basta e não há estado extra para reconciliar.

### D3. Efeitos do estado expirado
- `usage` e `assertWithinLimits` somam só `status <> 'EXPIRED'` (treinamentos e bytes de
  documento); imagens já são descartadas na expiração e saem da conta de imagens.
- `TrainingSyncService.syncAgent` filtra `status <> 'EXPIRED'` ao ler os locais e, para o conjunto
  `claimed`, também considera os expirados que ainda guardam `gptmaker_training_id` (o remoto já
  foi apagado, mas o id não deve ser reaproveitado para importação de item "órfão" caso o GPTMaker
  ainda o devolva por consistência eventual).
- `updateText`, `retry` e `applyCallback` recusam expirado (`DomainError('TRAINING_EXPIRED', …, 409)`
  na ação do usuário; o callback tardio de um treinamento expirado é ignorado).
- `remove` de expirado só marca `deletedAt` (sem chamada remota, sem erro).
- Export exclui expirados (D8).

### D4. Tags: `text[]` na própria linha, normalização compartilhada
`tags text[] not null default '{}'` com índice GIN para o filtro `tags && ARRAY[…]`.
Normalização (trim, colapsar espaços, minúsculas, dedupe, 1–30 caracteres, máx. 10) mora em
`@gptmaker/contracts` como `trainingTagsSchema` (zod `transform`), reutilizada por criação,
edição, importação e pelo parse do filtro — backend e frontend aplicam a mesma regra.
*Alternativa*: tabelas `tag` e `training_tag`. Descartada: não há metadado de tag (cor, dono), o
volume é pequeno e o array simplifica leitura, filtro e export; migrar para tabela depois é
possível.
Sugestões (`availableTags`): `SELECT DISTINCT unnest(tags)` dos treinamentos não removidos do
agente, ordenado — vem na própria resposta da listagem, sem endpoint extra.

### D5. API: criação estendida e novo endpoint de ajustes
- `POST /app/agents/:agentId/trainings`: as três variantes ganham `tags?` e `expiresAt?`
  (ISO 8601, futuro; validado no schema com margem de 1 minuto para relógio do cliente).
- `PATCH /app/agents/:agentId/trainings/:id/settings` (`@AppAuth('manage')`): corpo
  `{ tags?, expiresAt? }` (`expiresAt: null` limpa), qualquer tipo, **sem** chamada ao GPTMaker
  nem mudança de `status`; recusa `managed` e expirado. Só atualiza `tags`/`expires_at`/`updatedAt`.
  O `PATCH :id` existente continua só para texto/imagem; o modal de edição de texto chama os dois
  quando necessário.
*Alternativa*: estender `PATCH :id`. Descartada: ele é exclusivo de treinamento de texto
(`TRAINING_NOT_EDITABLE`) e dispara reenvio ao GPTMaker; misturar os dois comportamentos no mesmo
endpoint complica as guardas.
- `TrainingView` ganha `tags: string[]`, `expiresAt: string | null`, `expiredAt: string | null`;
  `trainingStatusSchema` ganha `EXPIRED`.
- Tudo filtrado por `tenantId` da sessão e agente via `agents.getById` (404 entre tenants), como
  hoje.

### D6. Listagem: paginação por offset no servidor, filtros por query string
`GET /app/agents/:agentId/trainings?page=&pageSize=&q=&type=&status=&tags=` com
`listTrainingsQuerySchema` em contracts (`page` ≥ 1 padrão 1; `pageSize` 1–100 padrão 20;
`type`, `status` e `tags` como lista separada por vírgula; `q` até 100 caracteres). Resposta:
`{ trainings, usage, page: { page, pageSize, total, totalPages }, availableTags }`.
- `WHERE`: tenant + agente + `deleted_at is null` + filtros (E entre filtros; OU dentro de
  `type`/`status`/`tags`). Busca: `ILIKE %q%` (escapando `%`, `_`, `\`) em `content`, `url` e
  `document_name`. Ordem inalterada: `created_at, id` (estável para paginar).
- `total` por `count(*)` com o mesmo `WHERE`; páginas além do fim devolvem `[]` com o total certo.
- `usage` continua sendo do tenant inteiro, independente de filtros.
*Alternativa*: cursor/keyset. Descartada: a UI precisa de "página N de M" e o volume por agente é
baixo (limite do plano); offset é suficiente e simples.
*Sem `unaccent`*: busca insensível só a maiúsculas; evita extensão nova no banco.
**BREAKING** do formato de resposta; único consumidor é o frontend deste repo (entregue junto).

### D7. Frontend
Estado da tela (`page`, `q`, `type`, `status`, `tags`) vive na URL (`useSearchParams`/router do
App Router) — recarregar e compartilhar link funcionam; alterar filtro/busca reseta `page`
(busca com debounce de ~300 ms). Novos componentes locais em `app/app/agents/[id]/trainings/`:
barra de filtros (busca, tipo, estado, tags com as `availableTags`), paginação, chips de tag no
item, seletor de data/hora de expiração (`datetime-local` convertido para ISO) e editor de tags
(entrada com sugestões) nos modais de criação e edição; item expirado mostra selo e esconde ações
de editar/reenviar. Textos novos nos três `trainings.json` (i18n). Antes de escrever código de
Next, conferir `node_modules/next/dist/docs/` (aviso de `frontend/AGENTS.md`). Lógica pura
(montar/ler query string, resetar página) vai para `lib/` e é testada sem renderizar.

### D8. Transferência
`trainingTransferItemSchema` ganha `tags: trainingTagsSchema.optional()` nas três variantes (como
é `strictObject`, `expiresAt` no arquivo continua sendo recusado por campo desconhecido, o que
atende ao spec). A exportação inclui as tags e passa a excluir `EXPIRED`. A importação cria via a
mesma `create` (herdando limites e normalização). Arquivos antigos, sem `tags`, seguem válidos; o
formato continua `version: 1` (mudança só aditiva).

## Risks / Trade-offs

- [Sync tratar expirado como "sumiu" e soft-deletá-lo] → D3 filtra `EXPIRED` na leitura e teste de
  integração cobre expirar → sincronizar.
- [Job expirar item que o usuário acabou de estender] → releitura da linha sob `withAgentLock`
  antes de agir.
- [GPTMaker fora do ar por horas] → item segue ativo e é retentado a cada 15 min; log por falha;
  nenhum efeito colateral local até o remoto confirmar.
- [Rajada de vencimentos (ex.: muitos itens com a mesma data)] → lote de 50 por execução; escoa
  nas execuções seguintes (≈200 itens/hora).
- [`ADD VALUE` no enum em migration] → só o `ALTER TYPE`; nenhum índice/default usa o valor novo na
  mesma migration; `guardiao-migracoes` revisa antes do commit.
- [Offset em lista grande] → limite do plano mantém o volume baixo; índice por agente já existe.
- [Resposta da listagem muda] → cliente único atualizado no mesmo PR; testes do controller e da
  página cobrem o novo formato.
- [Fuso horário da data de expiração] → armazenada em UTC; a tela converte do/para o fuso do
  navegador e mostra a data local.

## Migration Plan

1. Schema + `npm run db:generate -w backend` (migration `0027_*`, aditiva: 3 colunas, 1 valor de
   enum, 2 índices; linhas existentes ficam com `tags='{}'` e sem expiração).
2. Deploy em staging (`develop`): a API aplica a migration no start; o worker passa a rodar o job.
3. Produção por release. **Rollback**: reverter o código é seguro (colunas novas ignoradas); o
   valor `EXPIRED` no enum não é removido, e linhas já expiradas ficariam com um status que o
   código antigo não conhece — por isso a ordem é migration → código, e o rollback de código só
   antes de existir treinamento expirado em produção (ou com ajuste manual dos expirados).
