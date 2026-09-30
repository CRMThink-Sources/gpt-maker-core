Resumindo onde estamos: a seção 6 (instalação, tokens e sessão) já está implementada, menos a 6.1, que depende do time da plataforma. Agora falta fechar a migração do SDK e seguir para a seção 7.

1. Fechar a migração do SDK (hoje)
- Liberar o acesso do CI (você, pela interface do GitHub): nas configurações do pacote platform-sdk, em Manage Actions access, adicionar o gpt-maker-core com leitura. Sem isso o CI recebe 401 no npm ci.
- Testes de integração: ligar o Docker e rodar npm run test:integration -w backend. É o único teste que ainda não rodei.
- Commit e PR da branch chore/published-platform-sdk. Se quiser, junto com a correção do frontend que cai em staging quando falta a PUBLIC_PLATFORM_URL.

2. Tarefa 6.1: cadastro do app com o time da plataforma (depende de outras pessoas)
- Enviar os escopos (imbot, imopenlines, crm, task, bizproc, user, im), a URL do instalador (/platform/installer), a URL de eventos (/platform/events) e a origem do frontend para o SESSION_CORS_ORIGINS.
- Receber de volta a PLATFORM_API_KEY e o segredo HMAC. Eles vão para o ENV_FILE do ambiente staging.
- Bloqueio: essas URLs só existem depois do servidor e do DNS de staging (tarefa 2.2, api-staging. e app-staging.). Vale adiantar a 2.2, ou passar as URLs já definidas antes de subir o servidor.

3. Desenvolvimento: seção 7, gestão de agentes (recomendo começar por ela)

Ela não depende da plataforma em staging e destrava as seções 8 a 10:
- 7.1 repositório de agentes filtrado por tenantId, com testes de isolamento entre tenants;
- 7.2 a 7.5 criar, editar, inativar e remover agentes no GPTMaker;
- 7.8 espelhar cada agente como item de assinatura. Ficou mais simples, porque o PlatformClient já tem createItem, updateItem e removeItem;
- 7.7 tela de agentes no frontend.

A cobrança (seção 12) também ficou mais barata com o SDK, mas o teste ponta a ponta dela (12.12) depende da plataforma em staging, então pode esperar.

Posso fazer o commit e o PR agora e começar a 7.1 em seguida?