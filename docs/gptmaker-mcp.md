# MCP no GPTMaker

Levantamento da change `crm-semantic-layer-mcp` (tarefas 1.1 a 1.3). Fonte: OpenAPI em https://developer.gptmaker.ai/api-reference/mcp (lido em 2026-10-15). Nada aqui foi exercitado contra a API real ainda.

## Conexão por API

**Existe.** Todas as rotas usam o mesmo Bearer token do partner.

| Rota | Uso | Resposta 200 |
| --- | --- | --- |
| `POST /v2/agent/{agentId}/mcp/add` | Cria a conexão MCP no agente | `{ connected, success, id, url }` (`url` só no fluxo OAuth) |
| `POST /v2/mcp/connect` | Conclui conexão OAuth (`code`, `state`) | `{ agentId, success, mcpId }` |
| `GET /v2/mcp/{mcpId}/tools` | Lista as ferramentas descobertas | `[{ id, agentId, integrationId, active, name, description, inputSchema, ... }]` |
| `GET /v2/mcp/{mcpId}/tool/{toolId}/active` | Ativa uma ferramenta | `{ success }` |
| `GET /v2/mcp/{mcpId}/tool/{toolId}/inactive` | Desativa uma ferramenta | `{ success }` |
| `GET /v2/mcp/{mcpId}/sync-tools` | Relê as ferramentas do servidor | `{ success }` |
| `DELETE /v2/mcp/{mcpId}` | Remove a conexão | `{ success }` |

Corpo de `mcp/add` (todos obrigatórios, exceto `headers`):

```json
{
  "name": "CRM Bitrix24",
  "description": "Consulta do CRM do cliente",
  "mcpUrl": "https://api.exemplo/mcp",
  "urlType": "STREAMABLEHTTP",
  "authType": "HEADERS",
  "headers": { "Authorization": "Bearer <credencial do agente>" }
}
```

- `urlType`: `SSE` | `STREAMABLEHTTP`. `authType`: `NO_OAUTH` | `OAUTH` | `HEADERS`.
- Erros documentados: só `400 { error }` e `403 { error }` (token), como no resto da API.

### Lacunas (validar empiricamente)

1. O OpenAPI de `mcp/add` declara o parâmetro de caminho como `mcpId`, mas a rota usa `{agentId}`. Tratamos como erro de documentação: o valor é o id do agente.
2. Formato de `headers` não especificado (objeto chave → valor presumido).
3. Se as ferramentas já vêm ativas após `mcp/add` ou precisam de `.../active` (o app lista e ativa as que vierem inativas).
4. Não há rota para listar as conexões MCP de um agente: o app precisa guardar o `id` devolvido por `mcp/add`.
5. **O que o GPTMaker envia na chamada da ferramenta** (cabeçalhos, `_meta`, identificador do chat ou do contato): não documentado. É o ponto da tarefa 1.1.

## Comparação com as intenções `BITRIX`

As intenções já são ferramentas HTTP do agente, criadas pela API, e o GPTMaker substitui variáveis no corpo: `{{chat_id}}` (`public-api-<agente>-<tenantId>:<diálogo>`), `{{contact_name}}` e `{{contact_phone}}` (ver `bitrixRequestBody` em `backend/src/modules/intentions/intention.service.ts`). Ou seja, numa intenção a conversa é identificada de forma garantida; no MCP, depende da lacuna 5.
