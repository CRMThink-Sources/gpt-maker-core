# Staging: roteiro de provisionamento

Staging roda num Droplet próprio com o mesmo `infra/docker-compose.prod.yml` da produção (design
D18/D19). Cada push em `develop` gera as imagens (`release.yml`) e faz o deploy automático
(`deploy.yml`, GitHub Environment `staging`), com health check e volta para a tag anterior se falhar.

Valores do staging:

| Item                | Valor                                      |
| ------------------- | ------------------------------------------ |
| App                 | `thinkflow-staging.crmthink.com.br`        |
| API                 | `api.thinkflow-staging.crmthink.com.br`    |
| Plataforma          | `https://platform-staging.crmthink.com.br` |
| Região DigitalOcean | NYC3 (a mesma do Spaces)                   |

## 1. Chave SSH do deploy (na sua máquina)

```sh
ssh-keygen -t ed25519 -C "github-deploy-staging" -f gptmaker-staging-deploy -N ""
```

- `gptmaker-staging-deploy.pub` vai no cloud-init (passo 2).
- `gptmaker-staging-deploy` (privada) vai no secret `DEPLOY_SSH_KEY` (passo 6). Não commitar.

## 2. Droplet + Volume (painel DigitalOcean)

1. **Create → Droplets**: Ubuntu 24.04 LTS, região NYC3, Basic 2 vCPU / 4 GB.
2. **Add volume**: 20 GB, nome `gptmaker-data`, "Automatically Format & Mount".
3. **Authentication**: SSH key sua (acesso de administração como `root`).
4. **Advanced → User data**: cole `infra/deploy/cloud-init.yml` com `<CHAVE_PUBLICA_DO_DEPLOY>`
   trocado pelo conteúdo de `gptmaker-staging-deploy.pub`.
5. Hostname `gptmaker-staging`; tag `gptmaker-staging`.
6. Ative **backups** só na produção (staging não precisa).

Conferir depois de ~3 minutos:

```sh
ssh -i gptmaker-staging-deploy deploy@<IP> 'docker version --format "{{.Server.Version}}" && ls -la /mnt/gptmaker-data/'
```

Se existir `/root/VOLUME_AUSENTE`, o Volume não foi montado: anexe-o e rode o bloco "Dados no Volume" do cloud-init.

## 3. Cloud Firewall (painel → Networking → Firewalls)

Nome `gptmaker-staging`, aplicado à tag `gptmaker-staging`:

- Entrada: TCP 80 e 443 de qualquer origem; UDP 443 (HTTP/3) de qualquer origem; TCP 22 de qualquer origem.
  O deploy entra por SSH a partir do GitHub Actions, cujos IPs mudam; a proteção é só chave (senha e root por senha desligados).
- Saída: tudo liberado.

## 4. DNS

No provedor do domínio, registros `A` para o IP do Droplet:

- `thinkflow-staging.crmthink.com.br` → IP
- `api.thinkflow-staging.crmthink.com.br` → IP

O Caddy só emite o certificado quando o DNS já resolve para o Droplet.

## 5. Serviços externos

### Spaces (documentos de treinamento)

1. **Create → Spaces**: NYC3, nome `gptmaker-staging-trainings`, acesso restrito (privado).
2. **API → Spaces Keys**: chave com acesso só a esse bucket. Guarde a chave e o segredo.

### GPTMaker (workspace só do staging)

1. Na conta partner, crie o workspace "ThinkFlow Staging".
2. Pegue o id do workspace e um token em https://app.gptmaker.ai/browse/developers.

Não reutilize o workspace de dev nem o de produção: o `workspace-sync` trata como órfão todo agente sem registro no banco do ambiente.

### crmthink-platform de staging

Cadastre o app GPTMaker na plataforma de staging:

- URL do app (iframe do Bitrix24): `https://thinkflow-staging.crmthink.com.br/app`
- Instalador: `https://api.thinkflow-staging.crmthink.com.br/platform/installer`
- Eventos (assinatura, créditos): `https://api.thinkflow-staging.crmthink.com.br/platform/events`

Guarde `credentials.apiKey` e `credentials.webhookSecret`: aparecem uma vez só.

### Bitrix24

Use um portal de teste (não o portal de produção da CRMThink) e instale o app de staging pela plataforma.

## 6. GitHub Environment `staging`

Repositório → Settings → Environments → `staging` (sem aprovação obrigatória).

Variables:

| Nome          | Valor           |
| ------------- | --------------- |
| `DEPLOY_HOST` | IP do Droplet   |
| `DEPLOY_USER` | `deploy`        |
| `DEPLOY_DIR`  | `/opt/gptmaker` |

Secrets:

| Nome                 | Valor                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `DEPLOY_SSH_KEY`     | conteúdo de `gptmaker-staging-deploy` (privada)                                                   |
| `DEPLOY_KNOWN_HOSTS` | saída de `ssh-keyscan -t ed25519 <IP>`                                                            |
| `GHCR_PULL_TOKEN`    | token clássico do GitHub com `read:packages` (de uma conta com acesso aos pacotes da organização) |
| `ENV_FILE`           | o `.env` completo do staging (abaixo)                                                             |

`ENV_FILE`: copie `infra/.env.prod.example` e preencha:

- `APP_CODE=crmthink.homolog-thinkflow` (o código do app no cadastro da plataforma de staging)
- domínios `thinkflow-staging.crmthink.com.br` e `api.thinkflow-staging.crmthink.com.br`; `API_PUBLIC_URL`, `FRONTEND_ORIGINS` e `PUBLIC_API_BASE_URL` com eles
- senhas novas do Postgres e do RabbitMQ (`openssl rand -hex 24`), repetidas na `DATABASE_URL` e na `RABBITMQ_URL`
- GPTMaker do workspace de staging; plataforma de staging; Spaces do bucket de staging
- `PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`
- `DATA_ENCRYPTION_KEY` nova (`openssl rand -base64 32`), guardada também num cofre: sem ela, os dados cifrados ficam ilegíveis

## 7. Primeiro deploy

1. Leve o código para `develop` e faça push: o `release.yml` gera as imagens e o `deploy.yml` sobe a stack.
   Para redeploy de uma imagem já publicada: Actions → Deploy → Run workflow (`staging`, SHA).
2. Acompanhe em Actions → Deploy; o passo final imprime `deploy ok: <sha>`.
3. Conferir:

```sh
curl -fsS https://api.thinkflow-staging.crmthink.com.br/health/ready
curl -fsSI https://thinkflow-staging.crmthink.com.br/app | head -n1
```

## 8. Depois de no ar

1. Operador do backoffice (o primeiro ADMIN):

   ```sh
   ssh deploy@<IP> 'cd /opt/gptmaker && docker compose -f docker-compose.prod.yml --env-file .env exec backend-api node dist/cli/create-operator.js --email <email> --name "<nome>"'
   ```

2. Backoffice em `https://thinkflow-staging.crmthink.com.br/admin`: login, TOTP, cadastro dos modelos e planos.
3. Instalar o app no portal de teste e criar um agente. O backoffice → Workspace deve mostrar
   status ativo e nenhum órfão.
4. Ver logs: `docker compose -f docker-compose.prod.yml --env-file .env logs -f backend-api backend-worker`.
