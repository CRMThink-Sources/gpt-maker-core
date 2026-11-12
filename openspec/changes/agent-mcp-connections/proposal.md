# Proposal

## Why

No GPTMaker é possível conectar servidores MCP a um agente (ferramentas externas que o agente chama durante a conversa) e há API para isso. Hoje o ThinkFlow usa essa API só internamente, para a conexão MCP do CRM (`agent-crm-tools`); o cliente não consegue ligar o próprio servidor MCP (ERP, agenda, e-commerce, base interna) ao agente sem sair do ThinkFlow e entrar no painel do GPTMaker, o que quebra a promessa de operar tudo por aqui e escapa do isolamento por tenant e do controle de segredos.

## What Changes

- Nova seção "Conexões MCP" no agente (`/app`): listar, adicionar, editar, remover e sincronizar conexões MCP do agente.
- Cada conexão guarda nome, descrição, URL, tipo de transporte (`SSE` | `STREAMABLEHTTP`) e autenticação (`NO_OAUTH` | `HEADERS`); valores de cabeçalho (costumam ser chaves de API) são cifrados com `FieldCipher` e nunca devolvidos em claro pela API.
- O GPTMaker não tem rota para listar conexões de um agente: o ThinkFlow passa a ser a fonte de verdade e guarda o `id` devolvido por `mcp/add` numa tabela própria por tenant.
- Listar as ferramentas descobertas na conexão e ativar/desativar cada uma (rotas `tools`, `active`, `inactive`) e relê-las do servidor (`sync-tools`).
- Reconciliação: se a conexão sumir no GPTMaker ou a criação falhar, o estado e o motivo resumido ficam visíveis na tela (`lastError`), sem derrubar as demais conexões.
- A conexão MCP interna do CRM continua gerida por `agent-crm-tools` e **não** aparece nem pode ser alterada nesta lista.
- Fora de escopo (v1): autenticação `OAUTH` (exige fluxo de redirecionamento e `POST /mcp/connect`), catálogo de servidores prontos e cobrança por uso de ferramenta.

## Capabilities

### New Capabilities

- `agent-mcp-connections`: gestão, por agente e por tenant, das conexões MCP do GPTMaker (CRUD, cifra de credenciais, ferramentas ativas, sincronização e estado de saúde).

### Modified Capabilities

<!-- Nenhuma: a conexão MCP do CRM (`agent-crm-tools`) não muda de requisito; só passa a ser excluída da listagem do novo recurso. -->

## Impact

- `packages/contracts`: schemas zod e views de conexão MCP e de ferramenta.
- Backend: novo módulo `agent-mcp` (controller `app/agents/:agentId/mcp-connections`, service, repository), nova tabela + migration, uso do `GptMakerClient` existente (`addMcp`, `listMcpTools`, `activateMcpTool`, `syncMcpTools`, `deleteMcp`); acrescentar `deactivateMcpTool` ao cliente (rota `inactive` ainda não usada) e, se necessário, atualização por remoção + recriação (não há `PUT`).
- Remoção de agente (`agent.service`, evento `removed`) deve apagar os registros locais das conexões (o GPTMaker as descarta com o agente).
- Frontend: nova aba/cartão em `frontend/src/app/app/agents/[...]` com cliente em `lib/` e testes.
- Segurança: URL validada (https obrigatório fora de dev), cabeçalhos cifrados, sem segredo em log, 404 para agente de outro tenant, permissão `manage` para escrever.
- Docs: atualizar `docs/gptmaker-mcp.md` com o que for confirmado em staging (itens 3 e 4 das lacunas).
