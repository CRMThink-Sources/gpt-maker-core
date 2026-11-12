# Design

## Context

A v1 (`agent-mcp-connections`) guarda cada conexão em `agent_mcp_connection` e conversa com o GPTMaker por `addMcp`, `listMcpTools`, `activateMcpTool`/`deactivateMcpTool`, `syncMcpTools` e `deleteMcp`. O `mcpAddAckSchema` já aceita `connected` e `url`. O OpenAPI do GPTMaker descreve o OAuth assim: `POST /agent/{agentId}/mcp/add` com `authType: OAUTH` devolve `{ success, connected, id, url }`; depois do consentimento, `POST /mcp/connect` com `{ code, state }` devolve `{ success, agentId, mcpId }`. O GPTMaker guarda e renova os tokens; o ThinkFlow nunca os vê. Ver proposal.md para a motivação.

Lacuna central: o `redirect_uri` é decidido pelo GPTMaker (o `mcp/add` não aceita um). Não se sabe, sem testar em staging, para onde o provedor redireciona depois do consentimento (página do painel do GPTMaker ou outro endereço) nem se o painel conclui sozinho a conexão.

## Goals / Non-Goals

**Goals:**
- Conduzir o OAuth de ponta a ponta pelo ThinkFlow, de modo que a conclusão funcione mesmo que o provedor redirecione para fora do ThinkFlow.
- Não guardar nenhum segredo do provedor (`code`, tokens) e impedir que um `code` de outra conexão seja aplicado à conexão errada (`state`).

**Non-Goals:**
- Callback próprio no ThinkFlow (depende de o GPTMaker aceitar `redirect_uri`; ver Open Questions).
- Editar conexões OAuth, renovar ou revogar tokens (a renovação é do GPTMaker).
- Importar conexões OAuth criadas direto no painel do GPTMaker.

## Decisions

**D1. A conclusão é um passo explícito do usuário, com `code` + `state`.** O backend expõe `POST /app/agents/:agentId/mcp-connections/:id/oauth/complete` com `{ code, state }`. O frontend aceita também a URL de retorno inteira colada e extrai `code` e `state` no cliente (função pura em `lib/`). Alternativa descartada: endpoint de callback público no ThinkFlow, porque o `redirect_uri` não é controlável pela API; se a spike (tarefa 1.1) mostrar que é, esse endpoint chama o mesmo service sem mudar o contrato.

**D2. Estado `PENDING_AUTH` e `state` guardados na linha.** Acrescentar `PENDING_AUTH` ao enum `mcp_connection_status` e as colunas `oauth_state` (extraído da query `state` da URL de autorização devolvida), `authorization_url` (só enquanto pendente) e `oauth_started_at`. O `state` é valor de correlação, não credencial de acesso. A comparação do `state` informado com o guardado é em tempo constante. Migration nova (`db:generate`), sem tocar nas existentes. Alternativa descartada: não guardar `state` e confiar só no GPTMaker; perderia a proteção contra aplicar um retorno a uma conexão errada.

**D3. `mcp/add` com `OAUTH` não lista nem ativa ferramentas.** Se `connected` vier `true`, segue o caminho da v1 (listar e ativar). Se `false`, grava `PENDING_AUTH`, `gptmakerMcpId = id` e devolve `authorizationUrl`. Pendência antiga não é apagada por tempo: o usuário a cancela ou refaz; assim nunca some uma autorização em curso.

**D4. Concluir chama `connectMcp` e troca o id.** `GptMakerClient.connectMcp({ code, state })` faz `POST /mcp/connect`. O `mcpId` devolvido substitui o provisório (podem diferir); depois `applyTools` como na criação, e `authorization_url`/`oauth_state` são limpos. Falha do GPTMaker mantém `PENDING_AUTH` com `last_error` resumido (sem o `code`). O `code` não entra em log, em `last_error` nem no banco.

**D5. Cancelar reutiliza a remoção da v1.** `deleteMcp` com 404 tratado como sucesso, depois apaga a linha. "Refazer" devolve a `authorization_url` guardada; se o provedor a tiver expirado, o usuário cancela e cria de novo.

**D6. Edição de `OAUTH` recusada.** A v1 edita criando a nova e removendo a antiga; para OAuth isso exigiria nova autorização com a antiga ainda ativa. Fica como erro orientando remover e criar de novo (`DomainError`, 409).

**D7. Contratos.** `mcpAuthTypeSchema` passa a aceitar `OAUTH`; a criação com `OAUTH` exige `headers` vazios; `McpConnectionView` ganha `status: 'pending_auth'` e `authorizationUrl` (só enquanto pendente); novo `mcpOAuthCompleteSchema` (`code`, `state` não vazios, tamanho limitado).

## Risks / Trade-offs

- [O provedor pode redirecionar para uma página do GPTMaker que já conclui a conexão sozinha, deixando o passo manual redundante] → A spike (1.1) confirma; se for o caso, "Concluir" vira "Atualizar status", relendo `tools` para ver se a conexão ficou ativa.
- [Colar `code` e `state` é trabalhoso para o usuário] → Aceitar a URL inteira e extrair no cliente; texto de ajuda na tela.
- [`code` exposto em histórico do navegador ou log de proxy] → Vale por poucos minutos e uma única vez; o backend não o registra e o frontend não o guarda.
- [Tokens expiram e o GPTMaker pode não renovar] → Fora do escopo; a lista de ferramentas já marca `error` quando a conexão falha e o usuário refaz a conexão.

## Open Questions

- Para onde o provedor redireciona e o painel do GPTMaker conclui sozinho? Define se D1 fica só com o passo manual ou ganha o callback (spike 1.1, em staging, com um servidor MCP OAuth de teste).
- A URL de autorização expira? Se sim, em quanto tempo, e um `add` repetido para a mesma URL cria duplicata?
