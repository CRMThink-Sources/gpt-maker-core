# GPTMaker para Bitrix24

Aplicação multi-tenant que permite a clientes Bitrix24 criar, configurar, treinar e operar agentes de IA do GPTMaker, com cobrança por créditos. Instalação, tokens do Bitrix, sessão do iframe e pagamentos vêm do `crmthink-platform`.

Especificação: `openspec/changes/bitrix-gptmaker-agents-platform/` (proposta, design, specs e tarefas).

## Estrutura

| Pasta                 | Conteúdo                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `backend/`            | NestJS 11 (Node 24, TypeScript). Um pacote, dois papéis: `api` (HTTP e webhooks) e `worker` (filas e jobs) |
| `frontend/`           | NextJS (App Router): `/app` (embutido no Bitrix) e `/admin` (backoffice)                                   |
| `packages/contracts/` | Schemas zod e tipos compartilhados entre backend e frontend                                                |
| `infra/`              | Docker Compose de dev e produção, Caddy, script de deploy                                                  |
| `docs/`               | Documentação técnica                                                                                       |

Módulos do backend ficam em `backend/src/modules/<módulo>/`; outro módulo só importa pelo `index.ts` (verificado por `npm run depcruise`). Infraestrutura comum fica em `backend/src/shared/`.

## Desenvolvimento

Requisitos: Node 24 (`.nvmrc`), Docker.

```bash
npm ci
npm run build -w @gptmaker/contracts
docker compose -f infra/docker-compose.yml up -d   # postgres, rabbitmq, redis, storage S3
cp backend/.env.example backend/.env

npm run dev:api -w backend      # http://localhost:3001 (health: /health/live, /health/ready; /metrics)
npm run dev:worker -w backend   # métricas em http://localhost:9464/metrics
npm run dev -w frontend         # http://localhost:3000
```

O backend lê as variáveis do ambiente do processo (ver `backend/.env.example`); carregue o `.env` no shell ou na IDE. Para subir tudo em containers: `docker compose -f infra/docker-compose.yml --profile app up -d --build`.

Consoles locais: RabbitMQ http://localhost:15672 (gptmaker/gptmaker). Storage S3 (SeaweedFS, substitui o Spaces em dev): http://localhost:8333, chave `gptmaker`/`gptmaker123`, bucket `gptmaker-trainings`.

Portas do host em uso por outro projeto? Sobrescreva com `POSTGRES_PORT`, `REDIS_PORT`, `RABBITMQ_PORT` e `RABBITMQ_UI_PORT` (ajuste também o `backend/.env`).

Migrações: a API aplica as pendentes no start (`RUN_MIGRATIONS=true`). Depois de alterar `backend/src/shared/database/schema/`, gere a migração com `npm run db:generate -w backend` e commite `backend/drizzle/` (o CI falha se esquecer).

## Verificações

```bash
npm run lint
npm run format:check
npm run typecheck
npm run depcruise
npm test                                 # unitários
npm run test:integration -w backend      # Testcontainers (precisa de Docker)
```

## CI/CD

- `ci.yml`: lint, formatação, tipos, fronteiras de módulos, testes unitários e de integração, build; em PR também o build das imagens.
- `release.yml`: push em `main` publica `ghcr.io/<owner>/gptmaker-backend` e `gptmaker-frontend` com a tag do SHA.
- `deploy.yml`: staging automático após o release; produção manual (`workflow_dispatch` com a tag) com aprovação no GitHub Environment `production`. O script `infra/deploy/deploy.sh` faz health check e rollback para a tag anterior.

Configuração por GitHub Environment (`staging`, `production`):

| Tipo     | Nome                                       | Conteúdo                                                   |
| -------- | ------------------------------------------ | ---------------------------------------------------------- |
| variável | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_DIR` | Droplet e diretório da stack                               |
| secret   | `DEPLOY_SSH_KEY`                           | Chave privada SSH do usuário de deploy                     |
| secret   | `DEPLOY_KNOWN_HOSTS`                       | Saída de `ssh-keyscan <host>`                              |
| secret   | `ENV_FILE`                                 | Conteúdo do `.env` (modelo em `infra/.env.prod.example`)   |
| secret   | `GHCR_PULL_TOKEN`                          | Token com `read:packages` para o Droplet baixar as imagens |
