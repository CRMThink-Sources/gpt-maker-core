## Context

- Motivação: ver `proposal.md`. Requisitos: `specs/crm-semantic-layer/spec.md` e `specs/agent-mcp-server/spec.md`.
- Canal atual: `ConversationService.buildRequest` (`backend/src/modules/channel/conversation.service.ts`) manda ao GPTMaker `contextId = tenantId:dialogId`, `chatName`, `prompt` e um anexo. Nada do CRM.
- A tradução de campos existe só no frontend (`frontend/src/lib/crm-fields.ts`, via BX24 no navegador, sessão do usuário): `crm.lead.fields`/`crm.deal.fields`, `crm.status.list` (status e etapas `DEAL_STAGE[_<id>]` com semântica), `crm.category.list` (entityTypeId 2), rótulos `formLabel`/`listLabel`/`title`. Serve só o editor de gatilhos.
- Backend já tem: `BitrixClient.call/batch` com tokens da plataforma (`PlatformTokenProvider`), `parseCrmBinding`/`primaryEntity` sobre `entity_data_2` do `imopenlines.dialog.get` (`triggers/actions/crm-binding.ts`), token por agente com hash (`agent.webhookTokenHash`, `hashWebhookToken`), rate limiter no Redis (`shared/redis/rate-limiter.ts`), métricas `prom-client` e logs `pino` com contexto de requisição.
- GPTMaker: o painel permite conectar servidor MCP ao agente; o OpenAPI levantado em `docs/gptmaker-api.md` **não** documenta endpoint para isso nem diz o que o GPTMaker envia na chamada da ferramenta (cabeçalhos, identificador da conversa). A change da v1 deixou MCP fora do escopo (D2 da `bitrix-gptmaker-agents-platform`, Non-Goals).

## Goals / Non-Goals

**Goals:**
- Fonte única de tradução semântica no backend, reutilizável por futuras ferramentas de escrita e, depois, pelo editor de gatilhos.
- Servidor MCP sem estado, horizontalmente trivial, no papel `api`.
- Funcionar mesmo que o GPTMaker não identifique a conversa nem ofereça API de conexão.

**Non-Goals:**
- Migrar o editor de gatilhos para o catálogo do backend (fica como está nesta change).
- Configuração de campos por agente (a exposição é por tenant; a ativação é por agente).
- Ferramentas de escrita, débito por chamada, recursos/prompts MCP (só `tools`).

## Decisions

### S1. Módulo `semantic`: metadados ao vivo, escolhas do cliente no banco
`backend/src/modules/semantic/` monta o catálogo a partir do portal: `crm.{lead,deal,contact,company}.fields`, `crm.status.list` (listas de status e etapas), `crm.category.list` (`entityTypeId: 2`) e `user.get` (nomes de responsáveis), em um `batch`. O resultado normalizado (`SemanticField { entity, code, type, label, options?, multiple }`, `Pipeline { id, name, stages[{ id, name, sort, semantic }] }`) fica no Redis por tenant (`semantic:meta:{tenantId}`, TTL 10 min, invalidação pelo botão "atualizar").
- Só as escolhas do cliente vão para o PostgreSQL: `crm_field_setting(tenant_id, entity, field_code, exposed, description, updated_at)`, único por `(tenant_id, entity, field_code)`. Ausência de linha = padrão (conjunto mínimo de campos padrão exposto; `UF_*`, telefone e e-mail não).
- Campo com linha mas sem metadado = "indisponível" no painel; a linha não é apagada.
- `SemanticTranslator.toSemantic(entity, rawRecord)` aplica exposição + tradução (lista/status pelo nome, `Y/N` → Sim/Não, usuário pelo nome, `STAGE_ID` → funil/etapa/situação, `OPPORTUNITY`+`CURRENCY_ID`, datas ISO) e devolve `[{ campo, valor, significado? }]`; valor sem tradução é omitido. É a única saída que as ferramentas usam.
- A lógica de rótulos e opções é portada de `crm-fields.ts` para funções puras em `packages/contracts/` (normalização de metadado → `SemanticField`), para o frontend poder adotá-las depois sem duplicar.
- *Alternativa*: persistir o catálogo completo no banco com sincronização. Rejeitada: duplicaria o Bitrix, exigiria job de sync e conflitos; o cache de 10 min atende ao requisito.

### S2. Servidor MCP sem estado no papel `api`
Módulo `backend/src/modules/mcp/` com o SDK oficial `@modelcontextprotocol/sdk`, transporte Streamable HTTP em modo **stateless** (um `McpServer` + transporte por requisição, `sessionIdGenerator: undefined`), montado num controller Nest em `POST /mcp`; `GET`/`DELETE` respondem 405. Resposta JSON (sem SSE), já que as ferramentas são rápidas.
- *Alternativa*: sessões MCP com estado. Rejeitada: exigiria afinidade ou sessão no Redis e não traz ganho para ferramentas de leitura.
- *Alternativa*: SSE legado. Rejeitada: obsoleto no protocolo; adicionar só se o spike mostrar que o GPTMaker exige.

### S3. Credencial por agente, separada do token de webhook
Tabela `agent_crm_access(agent_id PK, tenant_id, enabled, token_hash UNIQUE, connection AUTO|MANUAL, status CONNECTED|AWAITING_FIRST_CALL|ERROR, last_call_at, created_at, rotated_at)`. Token aleatório de 32 bytes, guardado só o hash (mesma função de `hashWebhookToken`), aceito como `Authorization: Bearer` ou `?t=` (o cadastro no GPTMaker pode aceitar só URL). Um guard resolve token → agente → tenant, recusa agente removido/inativo, CRM desativado ou tenant desinstalado, e grava `tenantId`/`agentId` no contexto da requisição. Primeira chamada válida passa `AWAITING_FIRST_CALL` → `CONNECTED`.
- *Alternativa*: reusar o token de webhook. Rejeitada: revogar o acesso ao CRM quebraria os gatilhos, e vice-versa.

### S4. Identificação da conversa em camadas
A chamada da ferramenta precisa achar "o cliente desta conversa". Ordem:
1. **Identificador nativo**: se o spike (tarefa 1) mostrar que o GPTMaker envia o `contextId` (cabeçalho, `_meta` ou argumento), o servidor extrai `tenantId:dialogId`, confere o `tenantId` com o da credencial e usa `imopenlines.dialog.get` + `parseCrmBinding`/`primaryEntity`.
2. **Referência injetada pelo canal**: se não houver identificador nativo, o `buildRequest` passa a incluir no `chatName` uma referência curta e opaca da conversa (`ref` assinada com HMAC do tenant, sem o `dialogId` em claro), e a ferramenta aceita o argumento opcional `conversa`; a descrição da ferramenta instrui o agente a repassá-la. Ativado só para agentes com CRM ligado.
3. **Telefone ou e-mail** informados como argumento: `crm.duplicate.findbycomm` (contato, depois lead), telefone normalizado para dígitos. Sempre disponível.
- O spike escolhe entre 1 e 2; as specs não mudam (o requisito diz "quando a chamada identificar a conversa").

### S5. Referências opacas de registro
`consultar_cliente` devolve `cliente` = `base64url(tipo:id).hmac` com chave derivada do tenant; `negocios_do_cliente` só aceita referências que validem com a chave do tenant da credencial. Garante o cenário "referência de outro tenant" e impede o modelo de inventar ids.

### S6. Ferramentas sobre o Bitrix
- `consultar_cliente({ conversa?, telefone?, email? })`: contato via `crm.contact.get` (ou lead via `crm.lead.get`), empresa (`crm.company.get` → título), responsável (`user.get`), contagem de negócios em andamento (`crm.deal.list` com `STAGE_SEMANTIC_ID: 'P'`, usando `total`). Até 5 candidatos em caso de ambiguidade.
- `negocios_do_cliente({ cliente, situacao? })`: `crm.deal.list` filtrando `CONTACT_ID` (ou `LEAD_ID`/`COMPANY_ID` conforme o tipo), `STAGE_SEMANTIC_ID` (`P`/`S`/`F`), `order: { DATE_CREATE: 'DESC' }`, `select` limitado aos campos expostos + necessários; primeira página, corta em 10 e informa `ha_mais`.
- `etapas_do_funil({ funil? })`: só do catálogo em cache (sem chamada extra ao Bitrix na maioria dos casos); casamento do nome do funil sem acento e sem caixa.
- Descrições das ferramentas e dos argumentos em pt-BR, voltadas ao LLM. Saída em `structuredContent` + texto JSON compacto.
- Erros de negócio (não encontrado, ambíguo, indisponível, limite) voltam como resultado de ferramenta com `isError` quando cabível, nunca como erro de protocolo; mensagens sem detalhes internos.

### S7. Limites, tempo e observabilidade
- Rate limiter Redis existente: chave `mcp:{agentId}`, 60/min (configurável por env).
- Orçamento de 10 s por chamada (`AbortSignal` repassado ao `BitrixClient`; sem retry além do que o cliente já faz para `expired_token`).
- Métricas `mcp_tool_calls_total{tool,outcome}` e `mcp_tool_duration_seconds{tool}`; log por chamada com tenant, agente, ferramenta, duração, contagem e resultado. Argumentos e respostas nunca são logados (o redator do pino ganha os caminhos `telefone`, `email`, `conversa`).

### S8. Conexão ao agente no GPTMaker
`McpConnector` no módulo `gptmaker` (API confirmada na tarefa 1.2, ver `docs/gptmaker-mcp.md`): a ativação chama `POST /v2/agent/{agentId}/mcp/add` com `urlType: STREAMABLEHTTP`, `authType: HEADERS` e `headers: { Authorization: Bearer <credencial> }`, guarda o `mcpId` devolvido em `agent_crm_access.gptmaker_mcp_id` (não há rota para listar conexões do agente), lista as ferramentas (`GET /v2/mcp/{mcpId}/tools`) e ativa as inativas; sucesso marca `AUTO/CONNECTED`, falha cai para `MANUAL`. Gerar nova credencial remove e recria a conexão (o contrato não tem atualização). Desativar invalida o hash na hora e chama `DELETE /v2/mcp/{mcpId}` (melhor esforço). O painel só mostra URL e credencial no modo `MANUAL`.

### S9. Frontend
- Página do tenant "CRM para o agente" (`/app/crm`): abas por entidade, lista do catálogo com rótulo, tipo, valores aceitos, chave de exposição, descrição (300 caracteres) e "atualizar metadados". API: `GET /semantic/fields`, `PUT /semantic/fields/{entity}/{code}`, `POST /semantic/refresh`, protegidas pela sessão do iframe e filtradas por tenant.
- Na configuração do agente: chave "Acesso ao CRM", estado da conexão, "gerar nova credencial" e o bloco de cadastro manual exibido uma vez. API: `PUT /agents/{id}/crm-access`, `POST /agents/{id}/crm-access/rotate`.
- Schemas zod em `packages/contracts/`.

## Risks / Trade-offs

- [GPTMaker não envia identificador da conversa] → camadas S4 (referência injetada e telefone); o spike define antes de codar as ferramentas.
- [GPTMaker sem API para conectar MCP] → cadastro manual guiado no painel; estado "aguardando primeira chamada" mostra se deu certo.
- [Injeção de instruções via dados do CRM (cliente final escreve texto num campo)] → ferramentas só de leitura e valores entregues como dados estruturados; limite de tamanho por valor (500 caracteres) com corte.
- [Agente lê dados pessoais] → allowlist com telefone/e-mail desligados por padrão, credencial revogável, logs sem valores.
- [Carga no Bitrix do cliente (limite ~2 req/s por portal)] → metadados em cache, `batch` nas consultas compostas, limite por agente.
- [GPTMaker cobrar créditos extras por chamada de ferramenta] → a reconciliação diária já detecta a diferença; acompanhar no piloto antes de liberar para todos.
- [Tradução divergente entre frontend (gatilhos) e backend] → funções puras compartilhadas em `packages/contracts/`; migração do editor numa change futura.

## Migration Plan

1. Migração Drizzle aditiva (`crm_field_setting`, `agent_crm_access`).
2. Flag `MCP_ENABLED` (env): desligada, `POST /mcp` responde 404 e o painel esconde as telas.
3. Piloto com um tenant interno, conferindo créditos na reconciliação; depois liberar para todos.
4. Rollback: desligar a flag. Tabelas ficam sem uso; nenhum fluxo existente depende delas.

## Open Questions

- Campos exatos que o GPTMaker pede no cadastro de MCP (só URL ou URL + cabeçalhos): os dois formatos de credencial já são aceitos (S3), então a resposta só afeta o texto de instrução no painel.
- Exibir no painel a contagem de chamadas por agente: possível depois a partir das métricas, sem mudar specs.
