## Context

- Motivação: ver `proposal.md`. Requisitos: `specs/crm-semantic-layer/spec.md` e `specs/agent-crm-tools/spec.md`.
- Canal atual: `ConversationService.buildRequest` (`backend/src/modules/channel/conversation.service.ts`) manda ao GPTMaker `contextId = tenantId:dialogId`, `chatName`, `prompt` e um anexo. Nada do CRM.
- A tradução de campos existe só no frontend (`frontend/src/lib/crm-fields.ts`, via BX24 no navegador): `crm.lead.fields`/`crm.deal.fields`, `crm.status.list` (status e etapas `DEAL_STAGE[_<id>]` com semântica), `crm.category.list` (entityTypeId 2), rótulos `formLabel`/`listLabel`/`title`. Serve só o editor de gatilhos.
- Backend já tem: `BitrixClient.call/batch` com tokens da plataforma, `parseCrmBinding`/`primaryEntity` sobre `entity_data_2` do `imopenlines.dialog.get` (`triggers/actions/crm-binding.ts`), intenções `BITRIX` (`modules/intentions`) com `{{chat_id}}` → `dialogFromChat`, cifra de campo (`fieldCipher`), rate limiter e locks no Redis, métricas `prom-client`, logs `pino` com contexto.
- Spike (tarefas 1.1–1.2, `docs/gptmaker-mcp.md`): o GPTMaker tem API para conectar MCP ao agente (`POST /v2/agent/{agentId}/mcp/add`, `STREAMABLEHTTP`, `authType: HEADERS`), lista as ferramentas só na conexão (ou em `sync-tools`), abre conexão nova a cada chamada e **não envia nenhum identificador da conversa** na chamada da ferramenta. Já a intenção recebe `{{chat_id}}` preenchido pelo GPTMaker.

## Goals / Non-Goals

**Goals:**
- Fonte única de tradução semântica no backend, reutilizável por futuras ferramentas de escrita e, depois, pelo editor de gatilhos.
- Identificar o cliente da conversa sem depender do modelo nem do que o cliente digita.
- Servidor MCP sem estado no papel `api`.

**Non-Goals:**
- Migrar o editor de gatilhos para o catálogo do backend.
- Configuração de campos por agente (a exposição é por tenant; a ativação é por agente).
- Ferramentas de escrita, débito por chamada, recursos/prompts MCP (só `tools`).
- Cadastro manual da conexão MCP no painel do GPTMaker (a API existe).

## Decisions

### S1. Módulo `semantic`: metadados ao vivo, escolhas do cliente no banco
`backend/src/modules/semantic/` monta o catálogo a partir do portal: `crm.{lead,deal,contact,company}.fields`, `crm.status.list` (listas de status e etapas), `crm.category.list` (`entityTypeId: 2`), em um `batch`. Resultado normalizado (`SemanticField { entity, code, type, label, options?, multiple }`, `Pipeline { id, name, stages[{ id, name, sort, semantic }] }`) no Redis por tenant (`semantic:meta:{tenantId}`, TTL 10 min, invalidado pelo "atualizar").
- Só as escolhas do cliente vão para o PostgreSQL: `crm_field_setting(tenant_id, entity, field_code, exposed, description, updated_at)`, único por `(tenant_id, entity, field_code)`. Ausência de linha = padrão (conjunto mínimo de campos padrão exposto; `UF_*`, telefone e e-mail não).
- Campo com linha mas sem metadado = "indisponível" no painel; a linha não é apagada.
- `SemanticTranslator` aplica exposição + tradução (lista/status pelo nome, `Y/N` → Sim/Não, responsável pelo nome via `user.get` sob demanda com cache, `STAGE_ID` → funil/etapa/situação, `OPPORTUNITY`+`CURRENCY_ID`, datas ISO) e devolve `[{ campo, valor, significado? }]`; valor sem tradução é omitido; texto longo cortado em 500 caracteres.
- A normalização de metadado → `SemanticField` vira funções puras em `packages/contracts/`, para o frontend adotar depois sem duplicar.
- *Alternativa*: persistir o catálogo completo no banco com sincronização. Rejeitada: duplicaria o Bitrix e exigiria job de sync; o cache de 10 min atende ao requisito.

### S2. Modelo híbrido: intenção identifica, MCP complementa
- **Intenção de sistema "Consultar cliente no CRM"** (tipo `WEBHOOK` no GPTMaker, sem campos a coletar, `responseMode` pela API): `POST {API_PUBLIC_URL}/gptmaker/crm/client` com corpo fixo `{ "chat": "{{chat_id}}" }` e cabeçalho `Authorization: Bearer <credencial>`. O app extrai o diálogo com `dialogFromChat` (que só aceita o `tenantId` da credencial), lê `imopenlines.dialog.get` → `parseCrmBinding`, escolhe contato → lead → empresa e devolve cliente + até 10 negócios em andamento + referência. Uma única chamada já cobre a pergunta mais comum ("como está minha proposta?").
- **MCP** (`POST /mcp`): `negocios_do_cliente({ cliente, situacao? })` e `etapas_do_funil({ funil? })`.
- *Alternativas descartadas*: (a) tudo no MCP com telefone/e-mail informado — exige perguntar ao cliente e permite consultar dados de terceiros; (b) referência da conversa no `chatName` copiada pelo modelo — frágil e não verificável; (c) tudo em intenções — intenções não têm esquema de argumentos rico e cada uma ocupa espaço no prompt do agente; o MCP é o caminho natural para crescer (escrita na fase 2).

### S3. Credencial e estado do acesso
Tabela `agent_crm_access(agent_id PK → agent, tenant_id, status DISABLED|CONNECTING|CONNECTED|ERROR, token_hash UNIQUE NULL, token_encrypted NULL, gptmaker_intention_id NULL, gptmaker_mcp_id NULL, last_error NULL, last_call_at NULL, created_at, updated_at)`.
- Token aleatório de 32 bytes: hash (SHA-256, igual a `hashWebhookToken`) para autenticar; cifrado (`fieldCipher`) para reenviar ao GPTMaker ao recriar a intenção/conexão sem trocar a credencial. Nunca volta ao navegador.
- Um guard único (`CrmAccessGuard`) resolve `Authorization: Bearer` → acesso `CONNECTED` → agente não removido e `ACTIVE` → tenant `ACTIVE`, e grava `tenantId`/`agentId`/`installationId` no contexto. Serve a intenção e o MCP.
- *Alternativa*: reusar o token de webhook ou o da intenção do cliente. Rejeitada: revogações independentes.

### S4. Ativação e desativação no GPTMaker
`CrmAccessService.enable(agentId)` sob lock por agente (`crm-access:{agentId}`):
1. Gera credencial, grava `CONNECTING`.
2. Cria a intenção (`createIntention`; id pela resposta, ou pela listagem com o nome reservado se vier sem id).
3. `mcpAdd(agentId, { name: 'CRM Bitrix24', mcpUrl: API_PUBLIC_URL + '/mcp', urlType: 'STREAMABLEHTTP', authType: 'HEADERS', headers: { Authorization: 'Bearer …' } })`, guarda `mcpId`, lista ferramentas e ativa as inativas.
4. `CONNECTED`. Qualquer falha: remove o que foi criado (melhor esforço), apaga a credencial e grava `ERROR` + `last_error` resumido.
- `disable`: apaga hash e cifra **antes** de remover no GPTMaker (credencial morre na hora), depois `DELETE /v2/mcp/{mcpId}` e `DELETE /v2/intention/{id}` (404 = ok), `DISABLED`.
- Agente removido (`AgentChangeListener`): só marca `DISABLED` e apaga a credencial; o GPTMaker remove junto com o agente.
- Agente inativado/reativado: nada a fazer; o guard já recusa agente inativo.
- Mudança das descrições das ferramentas MCP em deploy: job no boot da API chama `sync-tools` para os acessos `CONNECTED` quando a versão do catálogo de ferramentas (`TOOLS_VERSION`) mudar (guardada no Redis).

### S5. Nome reservado e isolamento das intenções do cliente
- `IntentionService` passa a recusar o nome reservado na criação/edição (`INTENTION_NAME_RESERVED`) e a ignorar, na busca de id por nome, o id gravado em `agent_crm_access.gptmaker_intention_id`.
- A intenção de sistema não tem linha em `agent_intention`, logo não aparece na lista do cliente.

### S6. Referências opacas
`cliente` = `<tipo><id>.<hmac>` (ex.: `c123.Xy…`, tipos `c` contato, `l` lead, `o` empresa), HMAC-SHA256 truncado (16 bytes, base64url) com chave derivada de um segredo do app + `tenantId`. Referência que não valida = não encontrado, sem chamada ao Bitrix.

### S7. Consultas ao Bitrix
- Cliente: `crm.contact.get` / `crm.lead.get` / `crm.company.get`; empresa do contato por `COMPANY_ID` → título; responsável por `ASSIGNED_BY_ID` → nome.
- Negócios: `crm.deal.list` filtrando `CONTACT_ID` (ou `COMPANY_ID`; para lead, `LEAD_ID`), `STAGE_SEMANTIC_ID` (`P`/`S`/`F` conforme situação), `order: { DATE_CREATE: 'DESC' }`, `select` com os campos expostos + `ID, TITLE, CATEGORY_ID, STAGE_ID, STAGE_SEMANTIC_ID, OPPORTUNITY, CURRENCY_ID, DATE_CREATE, CLOSEDATE`; primeira página, corta em 10, `ha_mais` pelo `total`.
- Funis e etapas: do catálogo em cache; nome do funil casado sem acento e sem caixa.
- Orçamento de 10 s por chamada; erro do Bitrix vira resposta "indisponível no momento".

### S8. Servidor MCP sem estado
SDK oficial `@modelcontextprotocol/sdk`, `StreamableHTTPServerTransport` com `sessionIdGenerator: undefined` e `enableJsonResponse: true`, um `McpServer` por requisição, controller Nest `POST /mcp`; `GET`/`DELETE` → 405 (o GPTMaker tenta `GET` e segue). Ferramentas com descrições em pt-BR voltadas ao LLM; erros de negócio voltam como resultado (`isError` quando cabível), nunca como erro de protocolo.

### S9. Limites, observabilidade e flag
- Rate limiter Redis existente, chave `crm-tools:{agentId}`, 60/min (env `CRM_TOOLS_RATE_PER_MINUTE`).
- Métricas `crm_tool_calls_total{tool,outcome}` e `crm_tool_duration_seconds{tool}`; log por chamada com tenant, agente, ferramenta, duração, contagem e resultado; nada de argumentos ou respostas.
- Flag `CRM_TOOLS_ENABLED` (env): desligada, `/mcp` e `/gptmaker/crm/client` respondem 404, a ativação é recusada e o painel esconde as telas.

### S10. Frontend
- Página do tenant "CRM para o agente" (`/app/crm`): abas por entidade, rótulo, tipo, valores aceitos, chave de exposição, descrição (300 caracteres) e "atualizar". API: `GET /semantic/fields`, `PUT /semantic/fields/{entity}/{code}`, `POST /semantic/refresh`.
- Na configuração do agente: chave "Acesso ao CRM", estado (conectado / conectando / erro com "tentar de novo"). API: `GET|PUT /agents/{id}/crm-access`.
- Schemas zod em `packages/contracts/`.

## Risks / Trade-offs

- [O modelo não usar a intenção quando deveria] → texto de "quando usar" focado em perguntas sobre o próprio cadastro/pedido/proposta; teste no piloto.
- [O modelo copiar errado a referência para o MCP] → referência assinada: erro de cópia vira "não encontrado", nunca dado de outro cliente; a intenção já devolve os negócios em andamento, então o MCP só é necessário para histórico e etapas.
- [Injeção de instruções via dados do CRM] → somente leitura, valores entregues como dados estruturados, corte de tamanho.
- [Agente lê dados pessoais] → allowlist com telefone/e-mail desligados por padrão, cliente só pelo vínculo da conversa, credencial revogável, logs sem valores.
- [Carga no Bitrix do cliente (~2 req/s por portal)] → metadados em cache, `batch` nas consultas compostas, limite por agente.
- [GPTMaker cobrar créditos extras por chamada de ferramenta] → a reconciliação diária detecta a diferença; acompanhar no piloto.
- [Contrato de MCP do GPTMaker ainda pouco exercitado (formato de `headers`, ferramentas ativas por padrão)] → testado no piloto; listar e ativar ferramentas é idempotente.

## Migration Plan

1. Migração Drizzle aditiva (`crm_field_setting`, `agent_crm_access`).
2. Flag `CRM_TOOLS_ENABLED` desligada em produção; piloto com um tenant interno.
3. Liberar para todos após conferir créditos na reconciliação.
4. Rollback: desligar a flag (os agentes conectados recebem 404 nas ferramentas e seguem atendendo sem CRM); para limpar o GPTMaker, desativar o acesso dos agentes.
