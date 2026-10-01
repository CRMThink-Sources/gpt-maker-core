- ci.yml: roda em PR e em push para master e develop.
- release.yml: publica as imagens no push para master e develop, com a tag :<sha> e a tag com o nome da branch (:develop ou :master). Separei a fila por branch, para um release de staging não esperar o de produção.
- deploy.yml: escolhe o ambiente pela branch que gerou o release.
  - develop → staging, automático.
  - master → production, travado pela aprovação do Environment (veja abaixo).
  - O disparo manual continua existindo, para redeploy ou rollback de um SHA.

Uma mudança de comportamento: antes, produção só subia manualmente, informando um SHA já validado em staging. Agora sobe a cada merge em master, desde que alguém aprove. Se preferir manter produção só manual, é só tirar master do workflow_run.

O que você precisa configurar no GitHub

Em Settings → Environments, crie dois ambientes: staging e production. Cada um recebe as mesmas chaves, com os valores do seu Droplet:

┌──────────┬────────────────────┬─────────────────────────────────────────────────────────────┐
│   Tipo   │        Nome        │                          Conteúdo                           │
├──────────┼────────────────────┼─────────────────────────────────────────────────────────────┤
│ Variable │ DEPLOY_HOST        │ IP ou host do Droplet                                       │
├──────────┼────────────────────┼─────────────────────────────────────────────────────────────┤
│ Variable │ DEPLOY_USER        │ usuário SSH                                                 │
├──────────┼────────────────────┼─────────────────────────────────────────────────────────────┤
│ Variable │ DEPLOY_DIR         │ pasta da stack, ex.: /opt/gptmaker                          │
├──────────┼────────────────────┼─────────────────────────────────────────────────────────────┤
│ Secret   │ DEPLOY_SSH_KEY     │ chave privada SSH                                           │
├──────────┼────────────────────┼─────────────────────────────────────────────────────────────┤
│ Secret   │ DEPLOY_KNOWN_HOSTS │ saída de ssh-keyscan <host>                                 │
├──────────┼────────────────────┼─────────────────────────────────────────────────────────────┤
│ Secret   │ GHCR_PULL_TOKEN    │ PAT com read:packages                                       │
├──────────┼────────────────────┼─────────────────────────────────────────────────────────────┤
│ Secret   │ ENV_FILE           │ o .env inteiro, montado a partir de infra/.env.prod.example │
└──────────┴────────────────────┴─────────────────────────────────────────────────────────────┘

Recomendações:
- production: ative Required reviewers e restrinja Deployment branches a master. staging: restrinja a develop.
- ENV_FILE de staging: domínios de staging, PLATFORM_URL/PUBLIC_PLATFORM_URL apontando para https://platform-staging.crmthink.com.br, e credenciais da plataforma (API key e webhook secret) do cadastro de staging.
- Chaves separadas: gere uma DATA_ENCRYPTION_KEY diferente para cada ambiente (openssl rand -base64 32) e guarde um backup de cada uma. Sem ela os dados cifrados ficam ilegíveis. O ideal é usar também um workspace GPTMaker separado para staging.
- Proteção das branches: em Settings → Branches, exija que o CI passe antes do merge em develop e master.

Estado atual

O commit "Correção de testes" que você fez já inclui o health.test.ts. Ainda falta commitar: os três workflows, o workspace-health.service.ts, o frontend/package.json e o frontend/public/.gitkeep. Prettier passou em tudo. Os workflows só vão ser testados de verdade quando rodarem no GitHub.

---------------------

Você não precisa mais descobrir as URLs dos portais. Tirei a variável BITRIX_FRAME_ANCESTORS do projeto e o Caddy passou a decidir a regra pelo caminho da página:

- /app e subpáginas (a área carregada dentro do Bitrix24): frame-ancestors https:. Aceita ser embutida por qualquer site HTTPS, então funciona em qualquer domínio do Bitrix24 cloud (.com.br, .com, .ru, .de…), em domínio próprio e em on-premise com HTTPS.
- Todo o resto (/admin, /): frame-ancestors 'self'. Nada de fora consegue embutir. Antes o /admin podia ser embutido pelos domínios do Bitrix, então essa parte ficou mais restrita do que era.

Por que liberar /app é seguro: o frame-ancestors existe para evitar clickjacking, quando um site malicioso embute uma página em que a vítima já está logada. Aqui não há sessão por cookie. A sessão nasce da autenticação do BX24 dentro do iframe e é conferida no servidor pela plataforma. Um site qualquer que embutir /app só vê a mensagem "abra pelo Bitrix24".

A limitação é que um portal on-premise servido em HTTP puro, sem TLS, não consegue embutir o app. Se precisar suportar esse caso, dá para trocar por frame-ancestors *.

Arquivos alterados:
- infra/Caddyfile: nova regra por caminho, com um comentário explicando o motivo. caddy validate retornou "Valid configuration" e o caddy fmt não sugeriu mudanças.
- infra/.env.prod.example e infra/docker-compose.prod.yml: removida a variável. Não precisa colocar no ENV_FILE do GitHub.

Isso se soma ao que ainda não foi commitado: os workflows, o workspace-health.service.ts, o frontend/package.json e o frontend/public/.gitkeep. Quer que eu faça o commit, o push e abra o PR para develop?