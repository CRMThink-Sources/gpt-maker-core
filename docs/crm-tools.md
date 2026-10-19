# Ferramentas do agente sobre o CRM

Change `crm-semantic-layer-mcp`. Specs: `crm-semantic-layer` e `agent-crm-tools`. Levantamento do GPTMaker: `docs/gptmaker-mcp.md`.

O agente passa a consultar o CRM do Bitrix24 do cliente **somente para leitura**, sempre com nomes de negócio (camada semântica) e só os campos que o cliente liberou.

## Visão geral

```
Cliente final ── Linha Aberta ── app ── POST /agent/{id}/conversation ──▶ GPTMaker
                                                                            │
           ┌───────────── intenção de sistema "Consultar cliente no CRM" ◀─┤ (GPTMaker preenche {{chat_id}})
           ▼                                                                │
   POST /gptmaker/crm/client {chat}                 POST /mcp (tools/call) ◀┘ negocios_do_cliente, etapas_do_funil
           │  Authorization: Bearer <credencial do agente>        │
           ▼                                                      ▼
   imopenlines.dialog.get → vínculo do CRM            referência assinada → crm.deal.list
           └──────────────► camada semântica (catálogo + escolhas do cliente) ◄──────┘
```

Por que híbrido: o GPTMaker **não envia nenhuma informação da conversa** nas chamadas MCP (só nome e argumentos da ferramenta), mas preenche `{{chat_id}}` nas intenções. A intenção identifica o cliente com segurança (pelo vínculo da conversa, nunca por dado digitado); o MCP complementa com consultas a partir da referência que a intenção devolve.

## Camada semântica (`backend/src/modules/semantic`)

- **Catálogo** (`FieldCatalogService`): `crm.{lead,deal,contact,company}.fields`, `crm.category.list` e as listas de `crm.status.list` (status e etapas de cada funil), em dois `batch`, normalizados por `packages/contracts/src/crm.ts` e guardados no Redis por tenant (`semantic:meta:{tenantId}`, 10 min). "Atualizar do Bitrix24" no painel invalida o cache.
- **Escolhas do cliente** (`crm_field_setting`): exposto ou não e a descrição do significado (até 300 caracteres). Sem linha vale o padrão de `DEFAULT_EXPOSED_FIELDS`: nome, responsável, valor, moeda e datas. Campos personalizados, telefone e e-mail começam desmarcados.
- **Tradução** (`translateRecord`): listas e status pelo nome, sim/não, responsável pelo nome (`user.get`, cache de 1 h), valor com moeda, múltiplos separados por vírgula, textos cortados em 500 caracteres. Valor sem tradução é omitido; códigos técnicos nunca saem.
- Painel: `GET /app/crm/fields`, `PUT /app/crm/fields/{entity}/{code}`, `POST /app/crm/refresh`.

## Acesso do agente (`backend/src/modules/crm-tools`)

- `PUT /app/agents/{id}/crm-access { enabled }` (`CrmAccessService`, lock por agente):
  1. gera a credencial (32 bytes; no banco só o hash e a versão cifrada, para reenviar ao GPTMaker);
  2. cria a intenção de sistema `Consultar cliente no CRM` (nome reservado: o cliente não consegue criar outra igual);
  3. `POST /v2/agent/{agentId}/mcp/add` com `STREAMABLEHTTP`, `authType: NO_OAUTH` e a credencial na URL (`/mcp?t=<credencial>`). Pela API, o GPTMaker não repassou o `headers` de `authType: HEADERS`. **O GPTMaker já chama o `/mcp` nesse momento** (`initialize` + `tools/list`), por isso a credencial vale no estado `CONNECTING`;
  4. lista as ferramentas e ativa as inativas; nenhuma ferramenta ⇒ falha.

  Falha em qualquer passo desfaz o que foi criado e grava `ERROR` com o motivo resumido (o painel oferece "tentar de novo").

- Desativar apaga a credencial **antes** de remover a intenção e a conexão no GPTMaker. Agente removido: só apaga a credencial (o GPTMaker remove o resto junto com o agente).
- `CrmAccessGuard` autentica a intenção (cabeçalho `Authorization: Bearer`) e o MCP (`?t=` na URL). Os logs mascaram `t=` nas URLs. Recusa (401, sem detalhe) quando a credencial é desconhecida, o acesso está desativado, o agente foi removido ou está inativo, ou o tenant não está ativo.
- `CrmToolsSync` (worker, ao subir): se o `API_PUBLIC_URL` mudou, atualiza a intenção e recria a conexão MCP dos agentes conectados; se só mudou `TOOLS_VERSION` (`mcp.controller.ts`), chama `sync-tools`. **Mudou nome, descrição ou esquema de uma ferramenta MCP? Incremente `TOOLS_VERSION`**: o GPTMaker só relê as ferramentas assim.

## Ferramentas

| Ferramenta               | Onde                                   | Entrada                                                                            | Saída                                                                                                            |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Consultar cliente no CRM | intenção (`POST /gptmaker/crm/client`) | `{ chat }` preenchido pelo GPTMaker                                                | cliente (tipo, referência, nome, empresa, responsável, campos), até 10 negócios em andamento, `ha_mais_negocios` |
| `negocios_do_cliente`    | MCP                                    | `cliente` (referência), `situacao` (`em_andamento`, `ganhos`, `perdidos`, `todos`) | até 10 negócios do mais recente ao mais antigo, `ha_mais`, `total`                                               |
| `etapas_do_funil`        | MCP                                    | `funil` opcional (casamento sem acento e sem caixa)                                | funis com etapas em ordem e situação; funil inexistente lista os existentes                                      |

- O cliente é localizado pelo vínculo da conversa, nesta ordem: contato, lead, empresa. Se só houver negócio vinculado, usa o contato ou a empresa dele. Sem vínculo: "cliente não identificado", sem dados.
- Referência do cliente: `<c|l|o><id>.<HMAC>`, com chave por tenant derivada (HKDF) de `DATA_ENCRYPTION_KEY`. Se for adulterada, copiada errado ou de outro tenant, a resposta é "não encontrado" e o Bitrix nem é consultado.
- Limites: 60 execuções por minuto por agente, somando intenção e MCP (`CRM_TOOLS_RATE_PER_MINUTE`); 10 s por execução. Bitrix fora do ar ou lento resulta em "dados do CRM temporariamente indisponíveis".
- Erros de negócio voltam como resultado da ferramenta (`isError` no MCP), nunca como erro de protocolo.
- Registro: log `ferramenta do CRM` com ferramenta, resultado, contagem e duração (sem argumentos nem dados), métricas `crm_tool_calls_total{tool,outcome}` e `crm_tool_duration_seconds{tool}`, e `agent_crm_access.last_call_at`.

## Configuração

- `CRM_TOOLS_ENABLED` (padrão `false`): desligado, `/mcp`, `/gptmaker/crm/client` e as rotas do painel respondem 404, a ativação é recusada e o painel esconde as telas. Agentes já conectados param de receber dados, mas seguem atendendo.
- `CRM_TOOLS_RATE_PER_MINUTE` (padrão 60).
- O GPTMaker precisa alcançar `API_PUBLIC_URL` (em dev, pelo túnel).

## Como testar

- Unitários: `npm test -w backend` (camada semântica, ferramentas com portal simulado em `test/support/crm-portal.ts`, servidor MCP sobre HTTP real com o cliente oficial do SDK).
- Integração (Docker): `npx vitest run --project integration test/integration/crm-access.test.ts test/integration/crm-semantic.test.ts` no `backend/`.
- Manual em dev:
  1. `CRM_TOOLS_ENABLED=true` e `API_PUBLIC_URL` apontando para o túnel;
  2. em "CRM para o agente", marque e descreva alguns campos;
  3. ligue "Acesso ao CRM" no agente;
  4. numa Linha Aberta com o contato vinculado, pergunte "como está minha proposta?". O agente deve citar funil e etapa pelo nome;
  5. em seguida, peça o histórico de compras. O agente deve usar `negocios_do_cliente`.
