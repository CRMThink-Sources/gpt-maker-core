# Design

## Context

A v1 (`agent-mcp-connections`) guarda cada conexão em `agent_mcp_connection` e conversa com o GPTMaker por `addMcp`, `listMcpTools`, `activateMcpTool`/`deactivateMcpTool`, `syncMcpTools` e `deleteMcp`. O `mcpAddAckSchema` já aceita `connected` e `url`. O OpenAPI do GPTMaker descreve o OAuth assim: `POST /agent/{agentId}/mcp/add` com `authType: OAUTH` devolve `{ success, connected, id, url }`; depois do consentimento, `POST /mcp/connect` com `{ code, state }` devolve `{ success, agentId, mcpId }`. O GPTMaker guarda e renova os tokens; o ThinkFlow nunca os vê. Ver proposal.md para a motivação.

**Observado em 2026-11-12** (conexão criada no painel do GPTMaker contra o servidor `hubthink`): a URL de autorização é `https://<servidor>/authorize?response_type=code&client_id=…&redirect_uri=https://app.gptmaker.ai/browse/oauth/mcp&scope=mcp&state=<uuid>&code_challenge=…&code_challenge_method=S256`. Ou seja: (a) o `redirect_uri` é uma página do próprio GPTMaker, fixo e fora do nosso controle (o `mcp/add` não aceita um), então o ThinkFlow não recebe o callback; (b) o fluxo usa PKCE e o `code_verifier` fica com o GPTMaker, ligado ao `state` (por isso o `connect` só pede `code` e `state`); (c) o `state` é um UUID presente na URL de autorização.

**Teste no navegador em 2026-11-12, com o hubthink já autenticado:**
- Com sessão no GPTMaker: o navegador vai de `/authorize` direto para `app.gptmaker.ai/browse/oauth/mcp?code=…&state=…` e termina em `app.gptmaker.ai/browse` (dashboard). A página conclui a conexão sozinha e o `code` não fica na barra de endereço.
- Sem sessão no GPTMaker (o caso do cliente do ThinkFlow): o navegador termina na tela de login `app.gptmaker.ai/?goBack=<caminho codificado>&state=<uuid>`. O `code` (64 caracteres) fica **dentro do `goBack`** (`/browse/oauth/mcp?code=…`) e o `state` fica solto na URL, igual ao da conexão. A conexão não conclui, porque o cliente não tem login no GPTMaker.

Portanto o passo manual é necessário para o cliente sem conta no GPTMaker, e a releitura (D4a) cobre quem tem sessão.

## Goals / Non-Goals

**Goals:**
- Conduzir o OAuth de ponta a ponta pelo ThinkFlow, de modo que a conclusão funcione mesmo que o provedor redirecione para fora do ThinkFlow.
- Não guardar nenhum segredo do provedor (`code`, tokens) e impedir que um `code` de outra conexão seja aplicado à conexão errada (`state`).

**Non-Goals:**
- Callback próprio no ThinkFlow (o `redirect_uri` é fixo do GPTMaker).
- Editar conexões OAuth, renovar ou revogar tokens (a renovação é do GPTMaker).
- Importar conexões OAuth criadas direto no painel do GPTMaker.

## Decisions

**D1. A conclusão é um passo explícito do usuário, com `code` + `state`.** O backend expõe `POST /app/agents/:agentId/mcp-connections/:id/oauth/complete` com `{ code, state }`. O frontend aceita a URL colada e extrai `code` e `state` no cliente (função pura em `lib/`). Formatos a aceitar: `…?code=…&state=…` (retorno direto) e a URL de login `app.gptmaker.ai/?goBack=<caminho codificado com code>&state=…` (o `code` vem dentro de `goBack`, observado em 2026-11-12); o `code` é decodificado do `goBack` e o `state` é o do nível de cima. Alternativa descartada: endpoint de callback público no ThinkFlow, porque o `redirect_uri` é fixo na página do GPTMaker (observado em 2026-11-12); o `code` fica na barra de endereço dessa página, de onde o usuário o copia.

**D2. Estado `PENDING_AUTH` e `state` guardados na linha.** Acrescentar `PENDING_AUTH` ao enum `mcp_connection_status` e as colunas `oauth_state` (extraído da query `state` da URL de autorização devolvida), `authorization_url` (só enquanto pendente) e `oauth_started_at`. O `state` é valor de correlação, não credencial de acesso. A comparação do `state` informado com o guardado é em tempo constante. Migration nova (`db:generate`), sem tocar nas existentes. Alternativa descartada: não guardar `state` e confiar só no GPTMaker; perderia a proteção contra aplicar um retorno a uma conexão errada.

**D3. `mcp/add` com `OAUTH` não lista nem ativa ferramentas.** Se `connected` vier `true`, segue o caminho da v1 (listar e ativar). Se `false`, grava `PENDING_AUTH`, `gptmakerMcpId = id` e devolve `authorizationUrl`. Pendência antiga não é apagada por tempo: o usuário a cancela ou refaz; assim nunca some uma autorização em curso.

**D4a. Concluir é idempotente em relação ao painel.** Se `connect` falhar (código já consumido pela página do GPTMaker ou expirado), o service relê `tools` do `mcpId` provisório: se a conexão responde, marca `connected` e aplica as ferramentas ("já concluída no GPTMaker"); senão mantém `PENDING_AUTH` com o motivo. Um botão "Atualizar status" dispara só essa releitura, sem `code`.

**D4. Concluir chama `connectMcp` e troca o id.** `GptMakerClient.connectMcp({ code, state })` faz `POST /mcp/connect`. O `mcpId` devolvido substitui o provisório (podem diferir); depois `applyTools` como na criação, e `authorization_url`/`oauth_state` são limpos. Falha do GPTMaker mantém `PENDING_AUTH` com `last_error` resumido (sem o `code`). O `code` não entra em log, em `last_error` nem no banco.

**D5. Cancelar reutiliza a remoção da v1.** `deleteMcp` com 404 tratado como sucesso, depois apaga a linha. "Refazer" devolve a `authorization_url` guardada; se o provedor a tiver expirado, o usuário cancela e cria de novo.

**D6. Edição de `OAUTH` recusada.** A v1 edita criando a nova e removendo a antiga; para OAuth isso exigiria nova autorização com a antiga ainda ativa. Fica como erro orientando remover e criar de novo (`DomainError`, 409).

**D7. Contratos.** `mcpAuthTypeSchema` passa a aceitar `OAUTH`; a criação com `OAUTH` exige `headers` vazios; `McpConnectionView` ganha `status: 'pending_auth'` e `authorizationUrl` (só enquanto pendente); novo `mcpOAuthCompleteSchema` (`code`, `state` não vazios, tamanho limitado).

## Risks / Trade-offs

- [A página do GPTMaker pode consumir o `code` antes do ThinkFlow] → D4a: a falha do `connect` não encerra o fluxo, relê as ferramentas e conclui se a conexão já existe.
- [Colar `code` e `state` é trabalhoso para o usuário] → Aceitar a URL inteira e extrair no cliente; texto de ajuda na tela.
- [`code` exposto em histórico do navegador ou log de proxy] → Vale por poucos minutos e uma única vez; o backend não o registra e o frontend não o guarda.
- [Tokens expiram e o GPTMaker pode não renovar] → Fora do escopo; a lista de ferramentas já marca `error` quando a conexão falha e o usuário refaz a conexão.

## Open Questions

- A URL de autorização expira e um `add` repetido para a mesma URL cria duplicata?
- Com o `code` tirado da tela de login do GPTMaker, `POST /mcp/connect` conclui a conexão sem sessão do GPTMaker? (Esperado que sim: o `connect` só recebe `code` e `state`; confirmar na tarefa 1.1.)
- O `mcpId` do `connect` é igual ao `id` do `add`?
