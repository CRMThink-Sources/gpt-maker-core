# CLAUDE.md

## Visão geral

Aplicação multi-tenant (marca GPTThink / ThinkFlow) em que clientes Bitrix24 criam, configuram, treinam e operam agentes de IA do GPTMaker, com cobrança por créditos. Instalação, tokens do Bitrix, sessão do iframe e pagamentos vêm do `crmthink-platform` (SDK `@crmthink-sources/platform-sdk`). A CRMThink opera uma conta partner pós-paga no GPTMaker.

## Stack

- Monorepo npm workspaces (`packages/*`, `backend`, `frontend`), Node >= 24 (`.nvmrc`), TypeScript 6 (strict, `noUncheckedIndexedAccess`), ESM.
- Backend: NestJS 11, Drizzle ORM + PostgreSQL 16, RabbitMQ (`@golevelup/nestjs-rabbitmq`), Redis (ioredis), zod 4 + `nestjs-zod`, pino, prom-client, cockatiel (resiliência). Testes com Vitest + Testcontainers.
- Frontend: Next.js 16 (App Router), React 19, Tailwind 4. Rotas `/app` (embutido no Bitrix) e `/admin` (backoffice).
- `packages/contracts` (`@gptmaker/contracts`): schemas zod e tipos compartilhados backend/frontend.
- Infra: Docker Compose, Caddy, Droplet DigitalOcean, GitHub Actions. Specs com OpenSpec (`openspec/`).

## Comandos (raiz, salvo indicação)

- Instalar: `npm ci` (exige `GITHUB_TOKEN` com `read:packages` por causa do `.npmrc`).
- **Antes de tudo (e após mexer em `packages/contracts`)**: `npm run build -w @gptmaker/contracts` (backend e frontend consomem `dist/`).
- Infra local: `docker compose -f infra/docker-compose.yml up -d` e `cp backend/.env.example backend/.env`.
- Rodar: `npm run dev:api -w backend` (:3001), `npm run dev:worker -w backend`, `npm run dev -w frontend` (:3000).
- Testes unitários: `npm test`. Um arquivo: `npx vitest run --project unit src/modules/billing/ledger.service.test.ts` (em `backend/`) ou `npx vitest run <arquivo>` (em `frontend/` ou `packages/contracts/`). Filtro por nome: `-t "trecho"`.
- Integração (Docker obrigatório): `npm run test:integration -w backend`; um arquivo: `npx vitest run --project integration test/integration/<arquivo>.test.ts` em `backend/`.
- Lint: `npm run lint` · Formatação: `npm run format:check` (corrigir: `npm run format`) · Tipos: `npm run typecheck` · Fronteiras de módulos: `npm run depcruise`.
- Build: `npm run build`.
- Migrations: editar `backend/src/shared/database/schema/` → `npm run db:generate -w backend` → commitar `backend/drizzle/`. A API aplica pendentes no start (`RUN_MIGRATIONS=true`); `npm run db:migrate -w backend` aplica manualmente.
- CLIs: `npm run backoffice:create-operator -w backend -- --email ... --name ...` (exige build prévio, roda `dist/`).

## Arquitetura

- `backend/` = um pacote, dois papéis via `APP_ROLE`: `api` (`main.api.ts`, `api.module.ts`: HTTP + webhooks) e `worker` (`main.worker.ts`, `worker.module.ts`: consumers de fila e jobs).
- `backend/src/modules/<módulo>/`: domínio. Principais: `tenancy` (instalação, sessão do app, guards), `agents`, `agent-functions` (templates/funções do agente publicados no GPTMaker), `training`, `intentions`, `triggers` (webhooks/ações do GPTMaker), `channel` (mensagens do canal aberto Bitrix, handoff, fora do horário), `billing` (ledger de créditos, ciclos, alertas), `payments` (outbox + assinaturas com a plataforma), `reconciliation`, `models` (catálogo e custo por modelo), `gptmaker` (cliente/resiliência), `bitrix`, `crm-tools` e `semantic` (ferramentas MCP sobre o CRM), `function-review`/`vibecode` (revisão por IA), `agent-test` (chat de teste), `backoffice`, `notifications`.
- `backend/src/shared/`: infra comum (`database` + `schema/`, `messaging` + `topology.ts`, `redis`, `storage`, `platform`, `crypto`, `context`, `http`, `health`, `metrics`, `logging`). Nunca importa de `modules/`.
- `backend/src/cli/`: scripts operacionais. `backend/test/integration/`: testes com Testcontainers.
- `frontend/src/app/{app,admin}`, `components/` (ui compartilhada), `lib/` (clientes de API e helpers; alias `@/*`).
- Fluxo típico (HTTP): controller (`@AppAuth()` / `@AdminAuth`) → DTO via `createZodDto(schema de @gptmaker/contracts)` → Service → Repository (Drizzle) → eventos/filas. Mensagem de entrada: webhook → fila RabbitMQ → consumer no worker → GPTMaker → resposta → débito de créditos (`usage-debit.consumer`).
- Contexto de requisição (`traceId`, `tenantId`, `agentId`, `dialogId`) propaga por `AsyncLocalStorage` (`shared/context`) em HTTP, filas e jobs; use `enrichContext` em vez de passar por parâmetro só para log.

## Convenções

- Idioma: código em inglês/português misto como já existe; **comentários, docs, mensagens de erro e commits em português**. Comentários explicam o porquê e referenciam spec/design (`design D8`, `spec agent-management`).
- Arquivos: `kebab-case` com sufixo de papel (`agent.service.ts`, `agents.controller.ts`, `agent.repository.ts`, `*.consumer.ts`, `*.module.ts`, `*.errors.ts`); testes `*.test.ts` ao lado do código.
- Cada módulo tem `index.ts` como API pública; **outro módulo só importa pelo `index.ts`** (depcruise). Sem ciclos; `src` não importa testes.
- Erros: `DomainError(code, message, status, details)` (`shared/http/api-exception.filter.ts`) vira `{ error: { code, message, details } }`; erros de integração são classes próprias com `kind` (ex.: `BitrixError`, `GptmakerError`). Agente de outro tenant responde 404.
- Validação na borda com zod de `@gptmaker/contracts`; tipos de resposta (`AgentView` etc.) também vêm de lá.
- Prettier: aspas simples, `trailingComma: all`, largura 100, LF, 2 espaços. ESLint: `no-unused-vars` com `_` para ignorados.
- Testes: Vitest, `describe/it`, nomes em português, `it.each` para tabelas; unitários puros (sem Nest/DB) em `src/**`, integração em `test/integration/**`. SWC é necessário nos testes por causa dos decorators.
- Testes do frontend (Vitest + jsdom + Testing Library): `*.test.tsx` (componentes/hooks) ou `*.test.ts` (lógica pura) ao lado do arquivo testado, descrições em português. Testar comportamento visível (o que o usuário vê/faz), não detalhes de implementação; lógica extraída para `lib/` ou helpers é testada sem renderizar. Funcionalidade nova ou bug corrigido no frontend leva teste; pura estilização não precisa.
- Mudanças de funcionalidade seguem o fluxo OpenSpec (`/opsx:propose` → `/opsx:apply` → `/opsx:archive`); specs vivas em `openspec/specs/`, changes arquivadas em `openspec/changes/archive/`.

## Regras importantes

- Não commitar `.env*` (só `*.example`). Segredos de dev em `.env.example` não são de produção.
- **Nunca alterar migrations já geradas** em `backend/drizzle/` (nem `meta/`); crie nova com `db:generate`. O CI falha se o schema mudar sem migration.
- `credit_ledger` é **append-only** (trigger no Postgres bloqueia UPDATE/DELETE/TRUNCATE): correção = lançamento compensatório.
- Colunas sensíveis usam `FieldCipher` (AES-256-GCM, `DATA_ENCRYPTION_KEY`, formato `v1:`); não grave tokens em texto puro nem em logs.
- Todo dado é por tenant: sempre filtrar por `tenantId` da sessão.
- Não editar `dist/`, `.next/`, `next-env.d.ts`, `tsconfig.tsbuildinfo`. Não editar os pacotes de `node_modules`.
- Frontend: `frontend/AGENTS.md` avisa que este Next.js tem breaking changes; consulte `node_modules/next/dist/docs/` antes de escrever código de Next.
- Conta partner do GPTMaker é pós-paga: saldo 0 lá é normal (alerta só por status do workspace).
- Planos ThinkFlow: sem "Standard"; o plano só aparece com `plan_entitlement` cadastrado pelo backoffice → Planos.
- Branches = ambientes: `develop` é o staging (Droplet) e `master` é a produção. Push em `develop` faz deploy automático no staging; `master` faz deploy em produção com aprovação no GitHub Environment `production`. Não force-push nessas branches. Rollback/redeploy: workflow `Deploy` manual com a tag (SHA).
- Branch base de trabalho: `develop`; PRs para `develop`, `master` só por release.
- **Todo commit nasce numa branch específica do que está sendo feito, criada a partir de `develop` atualizada** (`git switch develop && git pull && git switch -c <prefixo>/<descricao-curta>`). Nunca commitar direto em `develop` ou `master`. Nome em `kebab-case` com prefixo do tipo (ex.: `feat/transferir-fora-do-horario`, `fix/...`, `docs/...`, `chore/...`, `refactor/...`). Uma branch por assunto; não misture mudanças sem relação. Depois, PR para `develop`.

## Como verificar antes de dar por pronto

Replica o CI (`.github/workflows/ci.yml`):

1. `npm run build -w @gptmaker/contracts`
2. `npm run format:check && npm run lint && npm run typecheck && npm run depcruise`
3. Se mexeu no schema: `npm run db:generate -w backend` e conferir que `git status backend/drizzle` só tem a migration nova esperada.
4. `npm test` (e `npm run test:integration -w backend` se tocou em banco, fila, canal ou billing).
5. `npm run build` se mexeu em contracts, config de build ou rotas do Next.

## Subagentes (`.claude/agents/`)

- `revisor-codigo`: revisa o diff antes de commitar/PR (só leitura).
- `escritor-testes`: cria/corrige testes no padrão do projeto (só mexe em arquivos de teste).
- `depurador`: acha a causa raiz de erros e falhas de teste e propõe a correção (não aplica).
- `guardiao-migracoes`: audita migrations Drizzle e mudanças de schema antes de commitar (só leitura).
- `especialista-gptmaker-bitrix`: explica o comportamento das integrações GPTMaker/Bitrix/plataforma com base em docs e código (só leitura).
- `autor-funcao-agente`: escreve/revisa o JSON de template de função do agente para o backoffice (usa as skills `gptthink-*`); grava o rascunho fora do repositório e valida com `.claude/skills/gptthink-criar-funcao/scripts/validar.mjs`.
- `guardiao-billing`: audita créditos, ledger, ciclos, débito de uso e pagamentos (idempotência, concorrência, append-only) (só leitura).
- `auditor-multitenant`: audita isolamento por `tenantId`, 404 entre tenants, guards e segredos (`FieldCipher`, logs) (só leitura).
- `especialista-openspec`: confere se proposal/design/specs/`tasks.md` de uma change estão coerentes com o código, se as tarefas `[x]` têm evidência e se está pronta para `/opsx:archive` (só leitura; não executa `/opsx:*`).
- `revisor-frontend`: revisa mudanças em `frontend/` (Next.js 16 conferido em `node_modules/next/dist/docs/`, `/app` × `/admin`, clientes em `lib/`, testes obrigatórios) (só leitura).

Sugestão de uso: após mudança relevante, `revisor-codigo`; se tocou em schema, também `guardiao-migracoes`; se tocou em créditos/billing/pagamentos, `guardiao-billing`; se tocou em controller, repository, guard, webhook, fila ou log, `auditor-multitenant`; se tocou em `frontend/`, `revisor-frontend`; antes de `/opsx:apply` ou `/opsx:archive`, `especialista-openspec`.

## Pontos a confirmar

- Runbook de operação em `docs/runbook.md` (tarefa 16.6); restore e SQL manual ainda a ensaiar no staging.
- `npm run format:check` e `npm run lint` locais falham por ruído fora do código da aplicação (`.claude/worktrees/`, `.agents/skills/`, `.superpowers/`) e por 3 erros `no-unused-vars` em testes (`_omitted`/`_assist`: a regra só ignora `_` em argumentos, não em variáveis) e 1 arquivo mal formatado (`function-review.module.ts`). Confirmar se o CI passa (ele roda em checkout limpo) e se vale ignorar essas pastas no ESLint/Prettier.
