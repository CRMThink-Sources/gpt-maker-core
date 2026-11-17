# Tasks

> Antes de começar: criar a branch a partir de `develop` atualizada (ex.: `feat/treinamentos-expiracao-tags-paginacao`). Após mexer em `packages/contracts`, rodar `npm run build -w @gptmaker/contracts`.

## 1. Contratos (`packages/contracts`)

- [x] 1.1 Em `trainings.ts`, criar `trainingTagsSchema` (trim, colapsar espaços, minúsculas, dedupe, 1–30 caracteres, máx. 10) e cobrir em `trainings.test.ts` (duplicatas/caixa, 11 tags, tag de 31 caracteres, vazias descartadas); `npx vitest run src/trainings.test.ts` passa
- [x] 1.2 Adicionar `EXPIRED` a `trainingStatusSchema`; `tags?` e `expiresAt?` (ISO, futuro com margem de 1 min) às três variantes de `createTrainingSchema`; `updateTrainingSettingsSchema` (`{ tags?, expiresAt?: string | null }`, estrito, exige ao menos um campo); testes de data passada, `null` limpando e objeto vazio recusado passam
- [x] 1.3 Estender `TrainingView` (`tags`, `expiresAt`, `expiredAt`) e criar `listTrainingsQuerySchema` (`page` ≥ 1 padrão 1, `pageSize` 1–100 padrão 20, `q` ≤ 100, `type`/`status`/`tags` em lista separada por vírgula) e o tipo da resposta paginada (`page`, `availableTags`); testes de padrões, `pageSize=500` recusado e parse de listas passam
- [x] 1.4 Adicionar `tags: trainingTagsSchema.optional()` às variantes de `trainingTransferItemSchema` e testar: arquivo antigo sem tags continua válido, `expiresAt` no item é recusado; `npm run build -w @gptmaker/contracts` e `npm test -w @gptmaker/contracts` passam

## 2. Banco

- [x] 2.1 No schema `training` (`agents.ts`): colunas `expires_at`, `expired_at`, `tags text[] not null default '{}'`, valor `EXPIRED` em `trainingStatus`, índice parcial de varredura (sem usar o literal `EXPIRED` no predicado) e índice GIN em `tags`; `npm run typecheck` passa
- [x] 2.2 Gerar a migration (`npm run db:generate -w backend`) sem tocar nas existentes; `git status backend/drizzle` mostra só `0027_*` + `meta`, e o subagente `guardiao-migracoes` não aponta problema
- [x] 2.3 Teste de integração aplicando as migrations num Postgres limpo e conferindo as colunas, o valor do enum e que linhas pré-existentes ficam com `tags='{}'` e sem expiração; `npm run test:integration -w backend` (arquivo novo) passa

## 3. Backend: tags, ajustes e listagem

- [x] 3.1 `TrainingService.create` grava `tags` e `expiresAt` (recusa `managed`/passado conforme spec) e `view()` devolve os campos novos; teste unitário cobre criação com e sem tags/expiração
- [x] 3.2 Novo `PATCH /app/agents/:agentId/trainings/:id/settings` (`@AppAuth('manage')`, `ZodValidationPipe`) + `TrainingService.updateSettings`: atualiza só `tags`/`expires_at`/`updatedAt` sob `withAgentLock`, sem chamada ao GPTMaker nem mudança de `status`, recusa `managed` e expirado (`TRAINING_EXPIRED` 409); testes: site `DONE` continua `DONE` e o GPTMaker não é chamado, perfil somente consulta recusado, agente de outro tenant → 404
- [x] 3.3 `TrainingService.list` com paginação e filtros (busca `ILIKE` com escape de `%`/`_`/`\` em `content`/`url`/`document_name`, `type`, `status`, `tags &&`), `total`/`totalPages`, `availableTags` e `usage` do tenant; `trainings.controller` lê `listTrainingsQuerySchema` e devolve o novo formato; testes de integração: 45 itens → 20/20/5, página além do fim vazia, filtros combinados, busca com `%` literal, tags de outro agente/tenant não vazam
- [x] 3.4 `usage` e `assertWithinLimits` ignoram `EXPIRED`; `updateText`, `retry` e `applyCallback` tratam expirado (409 / ignorado); `remove` de expirado só marca `deletedAt`; testes unitários/integração confirmam cada caso e que expirar libera cota

## 4. Backend: job de expiração

- [x] 4.1 Extrair de `remove` o método privado "apagar remoto (tolera `NOT_FOUND`, pula `OUT_OF_SYNC`/sem id) + descartar documento e imagem" e reutilizá-lo; a suíte existente de `training.service` continua passando
- [x] 4.2 Criar o serviço do job `training-expiry` (`@Cron('*/15 * * * *')`, `DistributedLock`, `runWithContext`, lote de 50 por `expires_at`): sob `withAgentLock`, relê a linha, apaga no GPTMaker, marca `EXPIRED` + `expired_at`, limpa mídia; falha de um item é logada e não bloqueia os demais; registrar no `training.module` e no `worker.module` (e conferir `depcruise`); testes de integração (`test/integration/training-expiry.test.ts`) com GPTMaker simulado no WireMock: expira no prazo, falha mantém ativo e retenta, `NOT_FOUND` conta como sucesso, item estendido/removido no meio não é expirado, `PROCESSING`/`FAILED` também expiram, item `managed` nunca
- [x] 4.3 `TrainingSyncService.syncAgent` ignora `EXPIRED` na leitura dos locais e não reaproveita o id remoto deles; teste de integração: expirar → rodar sincronização → continua `EXPIRED`, nada criado nem soft-deletado

## 5. Backend: transferência

- [x] 5.1 Exportação inclui `tags` e exclui `EXPIRED`; importação cria com `tags` normalizadas pela mesma `create`; atualizar `training-transfer.test.ts`: tags saem sem `expiresAt`, expirado fica de fora, arquivo antigo importa sem tags, item com `expiresAt` é recusado com o motivo

## 6. Frontend

- [x] 6.1 Conferir em `node_modules/next/dist/docs/` o uso de `useSearchParams`/`useRouter` no App Router do Next 16; criar em `lib/` o helper puro de query string da tela (ler/escrever `page`, `q`, `type`, `status`, `tags`; mudar filtro reseta `page`) e o cliente da listagem/`settings` com os tipos de `@gptmaker/contracts`; testes do helper passam sem renderizar
- [x] 6.2 Barra de filtros (busca com debounce ~300 ms, tipo, estado incluindo "Expirado", tags com `availableTags`) e paginação em `trainings/page.tsx`, com estado na URL, total de itens e estado vazio com "limpar filtros"; `page.test.tsx`: filtro volta à página 1, recarregar mantém contexto, nenhum resultado oferece limpar
- [x] 6.3 Chips de tag, expiração futura e selo "Expirado" nos itens; item expirado sem editar/reenviar (remover continua); teste de componente dos três casos
- [x] 6.4 Seletor de expiração (`datetime-local` → ISO, rejeita passado) e editor de tags com sugestões nos modais de criação e de edição; ação de editar tags/expiração para qualquer tipo via `/settings` (inclusive site/vídeo/documento); teste: criar com tags+expiração, editar só tags de um site, limpar expiração
- [x] 6.5 Textos novos nos três `trainings.json` (i18n) sem chaves faltando em nenhum idioma; o teste de i18n do projeto passa; modal de importação/exportação cita que tags vão no arquivo e a expiração não

## 7. Integração e fechamento

- [x] 7.1 Replicar o CI: `npm run build -w @gptmaker/contracts`, `npm run format:check && npm run lint && npm run typecheck && npm run depcruise`, `npm test`, `npm run test:integration -w backend`, `npm run build`; tudo verde (ou falhas pré-existentes listadas em `CLAUDE.md` > Pontos a confirmar)
- [x] 7.2 Revisões por subagente antes do PR: `revisor-codigo`, `guardiao-migracoes`, `auditor-multitenant` (job cross-tenant, filtros, tags), `revisor-frontend` e `especialista-openspec`; achados corrigidos ou justificados
- [x] 7.3 Validação manual no staging: criar treinamento com expiração curta, ver o job expirá-lo e a lista mostrar o selo; conferir paginação/filtros com 25+ itens (runbook do job e do novo formato da listagem já em `docs/runbook.md`, seção 10)
