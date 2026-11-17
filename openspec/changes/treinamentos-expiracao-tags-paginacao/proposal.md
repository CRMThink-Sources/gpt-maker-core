# Proposal

## Why

Hoje a base de treinamentos de um agente só cresce: o cliente precisa lembrar de remover à mão
conteúdo com prazo de validade (promoção, tabela de preços, regulamento de campanha) e, quando o
agente acumula dezenas de itens, a tela mostra tudo numa lista única, sem como achar um item nem
agrupá-los por assunto. Conteúdo vencido que continua treinado faz o agente responder com
informação errada, e o excesso de itens pesa no limite de treinamentos do plano.

## What Changes

- **Expiração opcional**: cada treinamento manual pode ter uma data/hora de expiração (criação e
  edição). Um job do worker, ao vencer o prazo, remove o treinamento no GPTMaker e o marca como
  `EXPIRED` na aplicação. O item continua visível (com selo "Expirado"), mas deixa de contar no
  limite de treinamentos e de armazenamento do plano e de valer para o agente.
- **Tags**: cada treinamento pode receber tags livres (até 10, 30 caracteres cada), editáveis em
  qualquer tipo de treinamento (inclusive os que não são editáveis no conteúdo), com sugestão das
  tags já usadas no agente.
- **Paginação e filtros na listagem**: `GET /app/agents/:agentId/trainings` passa a paginar
  (página + tamanho) e aceita filtros por busca textual, tipo, status (incluindo expirado) e tags.
  A tela ganha barra de filtros, chips de tag e paginação.
- **BREAKING (API interna)**: o formato da resposta da listagem muda (`trainings` paginado +
  `page` + `availableTags`). O único consumidor é o frontend deste repositório, atualizado junto.
- Exportação/importação passam a levar as tags de cada item; a data de expiração não é
  exportada (ficaria vencida ao reimportar).

## Capabilities

### New Capabilities
- `training-expiration`: data de expiração opcional por treinamento, job de expiração
  (remoção no GPTMaker + estado `EXPIRED`), efeitos em limites e na tela.
- `training-tags`: tags por treinamento, regras de normalização e limites, edição e sugestões.
- `training-listing`: listagem paginada e filtrável de treinamentos do agente (busca, tipo,
  status, tags) e a experiência correspondente na tela.

### Modified Capabilities
- `agent-training-transfer`: o arquivo exportado/importado passa a carregar as tags de cada item.

## Impact

- **Banco**: `training` ganha `expires_at`, `expired_at` e `tags text[]`; enum `training_status`
  ganha `EXPIRED`; índices parcial em `expires_at` e GIN em `tags`. Migration nova (sem alterar as
  existentes).
- **Backend** (`modules/training`): `TrainingService` (list, create, updateText → também
  metadados), novo job de expiração (`@Cron` com `DistributedLock`, como `training-image-cleanup`),
  `TrainingSyncService` (não pode ressuscitar/recriar item expirado), export/import, limites
  (`usage`/`assertWithinLimits`) ignorando expirados.
- **Contracts** (`@gptmaker/contracts`): `trainings.ts` (campos novos em criação/edição/`TrainingView`,
  schema de query e resposta paginada, item de transferência com `tags`).
- **Frontend**: `app/app/agents/[id]/trainings/*` (filtros, paginação, tags, data de expiração,
  selo de expirado) e os três `trainings.json` de i18n.
- **Integração**: usa `deleteTraining` já existente do cliente GPTMaker; sem novas chamadas.
- **Fora do escopo**: reativar treinamento expirado, notificação prévia de vencimento, expiração
  de treinamentos gerados pela função do agente (`managed`), tags compartilhadas entre agentes.
