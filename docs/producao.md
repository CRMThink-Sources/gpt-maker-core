# Produção no mesmo Droplet do staging

Staging e produção dividem o Droplet. O que muda em relação ao `docs/staging.md`:

- **Proxy único** (`infra/edge`, em `/opt/edge`): é o dono das portas 80/443 e dos certificados. Cada
  deploy grava `caddy/sites/<stack>.caddy` com os domínios do ambiente e recarrega o Caddy.
- **Uma stack por ambiente**: `STACK_NAME` = `gptmaker-staging` | `gptmaker-production` (containers,
  redes e volumes separados). O `deploy.yml` acrescenta `STACK_NAME` e `DATA_DIR` ao `.env`.
- **Dados separados**: `/mnt/gptmaker-data/staging` e `/mnt/gptmaker-data/production`.
- Diretórios: staging em `/opt/gptmaker`, produção em `/opt/gptthink`.

| Item       | Produção                       |
| ---------- | ------------------------------ |
| App        | `gptthink.crmthink.com.br`     |
| API        | `api.gptthink.crmthink.com.br` |
| `APP_CODE` | `crmthink.thinkflow`           |

## 1. Migrar o staging (uma vez, antes do primeiro deploy desta mudança)

O staging atual roda como projeto `gptmaker`, com Caddy próprio e dados em `/mnt/gptmaker-data/{postgres,rabbitmq,redis}`.
Isso precisa sair do caminho antes: o novo proxy ocupa 80/443 e o staging passa a usar `/mnt/gptmaker-data/staging`.
Haverá alguns minutos de indisponibilidade do staging.

Como `root` no Droplet:

```sh
# 1. Diretórios novos (staging, produção e proxy)
install -d -o deploy -g deploy /opt/gptthink /opt/edge
mkdir -p /mnt/gptmaker-data/staging /mnt/gptmaker-data/production

# 2. Backup do Postgres do staging (fica no Droplet; copie para fora se quiser)
cd /opt/gptmaker
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > /root/staging-pre-migracao.sql
ls -lh /root/staging-pre-migracao.sql   # confira que não está vazio

# 3. Parar a stack antiga (projeto "gptmaker", com Caddy próprio)
docker compose -f docker-compose.prod.yml --env-file .env down

# 4. Mover os dados para o diretório do staging
cd /mnt/gptmaker-data
mv postgres rabbitmq redis staging/
ls staging
```

Depois, dispare o deploy do staging (push em `develop` ou Actions → Deploy → `staging` + SHA). Ele sobe o
proxy em `/opt/edge`, a stack `gptmaker-staging` e emite de novo os certificados do staging (o volume do
Caddy é novo).

Conferir:

```sh
curl -fsS https://api.thinkflow-staging.crmthink.com.br/health/ready
docker ps --format '{{.Names}}'   # gptmaker-edge-caddy-1, gptmaker-staging-*
```

Se algo falhar: `cd /mnt/gptmaker-data && mv staging/* .`, suba a stack antiga com a imagem anterior e
restaure o dump se preciso. O volume de dados nunca é apagado nesse roteiro.

## 2. Serviços externos de produção

Valores novos, nunca reaproveite os do staging:

- **Spaces**: o **mesmo bucket do staging** (`gptmaker-trainings`, NYC3, privado, sem CDN), por decisão de custo. Crie uma **chave só da produção** (API → Spaces Keys, leitura e escrita nesse bucket) e use `STORAGE_KEY_PREFIX=production`. Nunca reaproveite a chave do staging: assim cada ambiente pode ser revogado ou girado sozinho, e os arquivos ficam em `production/trainings/...`.
- **GPTMaker**: workspace de produção na conta partner (id e token). O `workspace-sync` trata como
  órfão todo agente sem registro no banco do ambiente.
- **crmthink-platform de produção**, cadastro do app `crmthink.thinkflow`:
  - URL do app: `https://gptthink.crmthink.com.br/app`
  - Instalador: `https://api.gptthink.crmthink.com.br/platform/installer`
  - Eventos: `https://api.gptthink.crmthink.com.br/platform/events`
  - Guarde `credentials.apiKey` e `credentials.webhookSecret` (aparecem uma vez).
- **Stripe**: `PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…` e as chaves do backend em produção.
- **Backups**: ative os backups do Droplet e do Volume agora que há produção nele.

## 3. GitHub Environment `production`

Variables (já criadas): `DEPLOY_HOST=159.89.95.146`, `DEPLOY_USER=deploy`, `DEPLOY_DIR=/opt/gptthink`.

Secrets:

| Nome                 | Valor                                                                           |
| -------------------- | ------------------------------------------------------------------------------- |
| `DEPLOY_SSH_KEY`     | a mesma chave privada do staging (o Droplet e o usuário `deploy` são os mesmos) |
| `DEPLOY_KNOWN_HOSTS` | saída de `ssh-keyscan -t ed25519 159.89.95.146`                                 |
| `GHCR_PULL_TOKEN`    | o mesmo token do staging                                                        |
| `ENV_FILE`           | o `.env` de produção (abaixo)                                                   |

Ative **Required reviewers** no Environment: o `deploy.yml` já espera essa aprovação antes de produção.

`ENV_FILE`: copie `infra/.env.prod.example` e preencha como no staging, com:

- `APP_CODE=crmthink.thinkflow`
- `APP_DOMAIN=gptthink.crmthink.com.br`, `API_DOMAIN=api.gptthink.crmthink.com.br`; `API_PUBLIC_URL`,
  `FRONTEND_ORIGINS` e `PUBLIC_API_BASE_URL` com eles
- `STORAGE_ENDPOINT`, `STORAGE_REGION` e `STORAGE_BUCKET` iguais aos do staging; `STORAGE_ACCESS_KEY` e `STORAGE_SECRET_KEY` da chave **de produção**; `STORAGE_KEY_PREFIX=production`
- senhas **novas** do Postgres e do RabbitMQ (`openssl rand -hex 24`), repetidas na `DATABASE_URL` e na `RABBITMQ_URL`
- `DATA_ENCRYPTION_KEY` nova (`openssl rand -base64 32`), guardada também num cofre
- sem `DATA_DIR` nem `STACK_NAME`: o deploy define

## 4. Primeiro deploy e operação

1. Merge em `master`: o `release.yml` gera as imagens e o `deploy.yml` pede aprovação e sobe `gptmaker-production`.
   Ou Actions → Deploy → Run workflow (`production`, SHA).
2. Conferir:

```sh
curl -fsS https://api.gptthink.crmthink.com.br/health/ready
curl -fsSI https://gptthink.crmthink.com.br/app | head -n1
```

3. Operador do backoffice, como no staging, mas no diretório de produção:

```sh
ssh deploy@159.89.95.146 'cd /opt/gptthink && docker compose -f docker-compose.prod.yml --env-file .env exec backend-api node dist/cli/create-operator.js --email <email> --name "<nome>"'
```

4. Logs: `cd /opt/gptthink && docker compose -f docker-compose.prod.yml --env-file .env logs -f backend-api backend-worker`.
5. Proxy: `cd /opt/edge && docker compose logs -f caddy`. Os sites ficam em `/opt/edge/caddy/sites/`.

## Capacidade

Duas stacks completas (Postgres, RabbitMQ, Redis, API, worker, Next) no mesmo Droplet disputam memória.
Aumente o Droplet (resize só de CPU/RAM é reversível) quando `free -m` mostrar uso de swap constante;
o Volume e o IP não mudam.
