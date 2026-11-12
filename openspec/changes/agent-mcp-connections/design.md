# Design

## Context

O `GptMakerClient` já implementa `addMcp`, `listMcpTools`, `activateMcpTool`, `syncMcpTools` e `deleteMcp` (usados por `crm-tools`), faltando só `inactive`. O levantamento em `docs/gptmaker-mcp.md` confirma: `mcp/add` aceita `HEADERS`, **não há rota para listar conexões de um agente** e não há atualização (só criar/remover). A conexão MCP do CRM vive em `agent_crm_access.gptmaker_mcp_id` e é gerida por `crm-tools`. Segue o padrão de `intentions` (controller `app/agents/:agentId/...`, `@AppAuth('manage')`) e de colunas sensíveis com `encryptedText`. Ver proposal.md para a motivação.

## Goals / Non-Goals

**Goals:**
- Fonte de verdade local por tenant, com estado visível e sem conexões órfãs no GPTMaker.
- Segredos cifrados e nunca devolvidos.

**Non-Goals:**
- OAuth, catálogo de servidores prontos, cobrança por ferramenta, listar/importar conexões criadas direto no painel do GPTMaker (não há API para descobri-las).
- Mexer na conexão MCP do CRM.

## Decisions

**D1. Módulo novo `agent-mcp`.** `backend/src/modules/agent-mcp/` com `index.ts`, controller, service, repository e módulo; depende de `agents` (posse do agente), `gptmaker` e `tenancy` só pelos `index.ts`. Alternativa: pôr em `crm-tools` ou `agents` — descartada: domínios distintos e o `agents.service` já é grande.

**D2. Tabela `agent_mcp_connection`.** Colunas: `id` uuid, `tenant_id`, `agent_id`, `gptmaker_mcp_id` (nulo enquanto cria), `name`, `description`, `url`, `url_type`, `auth_type`, `headers_encrypted` (`encryptedText` com JSON `{nome: valor}`), `disabled_tools` (jsonb, nomes de ferramentas desativadas pelo usuário), `status` (`connected` | `error`), `last_error`, timestamps. Índice por `(tenant_id, agent_id)`. Alternativa: guardar no GPTMaker e consultar — impossível sem rota de listagem. Cifrar o JSON inteiro em vez de só valores: mais simples; a view devolve só as chaves, derivadas após decifrar.

**D3. Criar = registrar, chamar, confirmar.** O service insere a linha, chama `addMcp`, grava `gptmaker_mcp_id`, lista e ativa as ferramentas (respeitando `disabled_tools`) e marca `connected`. Se `addMcp` falha, apaga a linha e propaga erro com motivo resumido; se falha depois do `add`, tenta `deleteMcp` (best-effort) antes de apagar a linha, evitando órfã. `connected: false` na resposta é tratado como falha. Idempotência por requisição não é necessária (usuário humano), mas a linha é gravada antes do `add` para que uma queda do processo deixe um registro `error` recuperável pelo usuário (remover/tentar de novo) em vez de conexão invisível.

**D4. Editar = criar nova, trocar, remover antiga.** Sem `PUT` no GPTMaker. Ordem: `addMcp` novo → grava novo `gptmaker_mcp_id` → `deleteMcp` antigo (falha ignorada e logada). Se o `add` falhar, a antiga segue intacta. Cabeçalhos omitidos mantêm o valor atual (mescla por nome antes de cifrar). Nomes em `disabled_tools` são reaplicados à nova conexão. Alternativa: remover e recriar — descartada: deixaria o agente sem a ferramenta em caso de falha.

**D5. Ferramentas ativas vêm do GPTMaker; a escolha do usuário fica local.** Listar usa `listMcpTools` ao vivo (é a verdade do que o servidor expõe); `active` por ferramenta vem da resposta. Desativar/ativar chama `inactive`/`active` e atualiza `disabled_tools`. Sincronizar chama `sync-tools` e depois desativa no GPTMaker as ferramentas novas (inativas por padrão, spec). Como não se sabe se `mcp/add` entrega ferramentas ativas (lacuna 3), a criação ativa as inativas, como `crm-tools.activateInactiveTools`. Extrair esse helper para reaproveitar, sem mudar o comportamento do CRM.

**D6. Validação de URL na borda.** Schema zod em `@gptmaker/contracts`: `https` obrigatório fora de `NODE_ENV=development`; recusar `localhost`, `*.local`, IPs privados/loopback/link-local por literal. Quem faz a chamada é o GPTMaker, não nosso servidor, então o risco de SSRF é do lado deles; a regra evita apontar para a nossa própria infra e erros comuns. Não resolvemos DNS (rebinding fica com o GPTMaker). Cabeçalhos: nomes válidos de header HTTP, limite de quantidade e tamanho. `OAUTH` recusado com 422.

**D7. Isolamento da conexão do CRM.** Está em outra tabela (`agent_crm_access`), então a listagem do novo recurso não a inclui por construção. Nome da conexão do CRM não precisa ser reservado, pois não há colisão de dados.

**D8. Erros e segredos.** `GptMakerError` é traduzido para `DomainError` (`MCP_CONNECTION_FAILED`, 502/422) com mensagem resumida sem o corpo da resposta. O service nunca loga `headers`; `last_error` guarda só categoria + mensagem curta. Rotas: `GET/POST app/agents/:agentId/mcp-connections`, `PUT/DELETE .../:id`, `GET .../:id/tools`, `PUT .../:id/tools/:toolId` (`{ active }`), `POST .../:id/sync`. Leitura com `@AppAuth()`, escrita com `@AppAuth('manage')`. Tudo filtra por `tenantId` da sessão e por `agentId`; fora disso, 404.

**D9. Remoção do agente.** O GPTMaker apaga as conexões com o agente; o service escuta o evento `removed` de `AgentEvents` (ou o repository do módulo apaga por `agent_id`) para limpar as linhas locais. Se o módulo precisar ouvir o evento, registra-se como `AgentEvents` listener, sem import circular com `agents`.

**D10. Frontend.** Novo cartão/aba "Conexões MCP" ao lado dos existentes em `frontend/src/app/app/agents/[...]`, cliente em `lib/mcp-connections.ts` e tipos de `@gptmaker/contracts`. Formulário com cabeçalhos dinâmicos (valor mascarado; em edição, "mantido" até o usuário digitar outro). Lista de ferramentas com interruptor por ferramenta e botão "Sincronizar".

## Risks / Trade-offs

- [Conexões criadas direto no painel do GPTMaker não aparecem] → Documentar na tela; sem API de listagem não há como importar.
- [Divergência: conexão removida no painel do GPTMaker] → Listar ferramentas retorna 404; o service marca `error` com "conexão não encontrada no GPTMaker" e permite remover ou recriar; remoção trata 404 como sucesso.
- [Edição deixa conexão antiga órfã se `deleteMcp` falhar] → Log de aviso com o id; aceitável (baixo custo), reconciliação periódica fica fora do v1.
- [Ferramentas MCP de terceiros podem executar ações destrutivas] → O usuário escolhe ferramentas ativas; novas ficam inativas após sincronizar; aviso na tela.
- [Formato exato das respostas `active`/`inactive`/`sync-tools` não exercitado] → Validar em staging na tarefa 1 e registrar em `docs/gptmaker-mcp.md` (lacunas 3 e 4).
- [Segredo em memória/log] → Nunca registrar `headers`; teste que garante a ausência.

## Migration Plan

1. Migration aditiva (`db:generate`), tabela nova sem dados prévios: sem backfill.
2. Deploy em `develop` (staging) e teste com um servidor MCP de eco; depois release para `master`.
3. Rollback: a tabela nova pode ficar sem uso; reverter o código esconde a seção. Conexões já criadas permanecem no GPTMaker e no agente.
