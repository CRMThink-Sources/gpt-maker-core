# GPTMaker API v2 — contrato de referência

Levantamento feito em 2026-09-25 a partir da documentação oficial. **Fonte primária:** a especificação OpenAPI 3.0.1 publicada pela própria documentação:

- OpenAPI (JSON): https://developer.gptmaker.ai/api-reference/openapi.json (`info.version: 1.0.0`, `servers[0].url: https://api.gptmaker.ai`)
- Índice da documentação: https://developer.gptmaker.ai/llms.txt
- Documentação completa em texto: https://developer.gptmaker.ai/llms-full.txt
- Cada página de referência (`https://developer.gptmaker.ai/api-reference/...`) é gerada a partir do mesmo OpenAPI; a versão `.md` de cada página embute o trecho YAML correspondente.

Convenções deste documento:

- **Confirmado** = está no OpenAPI/documentação oficial.
- **NÃO DOCUMENTADO** = não encontrado em nenhuma fonte oficial.
- A documentação **não traz exemplos JSON completos de resposta** (apenas schemas e, em alguns campos de requisição, `example`). Os exemplos abaixo marcados como "montado a partir do schema" não foram copiados da documentação; valores `example` citados entre aspas foram copiados do OpenAPI.
- O OpenAPI **não marca nenhum campo como obrigatório** exceto onde indicado (`required`). Todos os demais devem ser tratados como opcionais.

---

## 0. Base, autenticação e convenções gerais

| Item              | Valor                                                                                                              | Status     | Fonte                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------- |
| Host              | `https://api.gptmaker.ai`                                                                                          | Confirmado | openapi.json `servers`                                                 |
| Prefixo de versão | `/v2` faz parte de cada rota (ex.: `/v2/workspaces`). Portanto base efetiva = `https://api.gptmaker.ai/v2`         | Confirmado | openapi.json `paths`                                                   |
| Autenticação      | `Authorization: Bearer <token>` (`securitySchemes.bearerAuth: {type: http, scheme: bearer}`, aplicado globalmente) | Confirmado | openapi.json; https://developer.gptmaker.ai/api-reference/introduction |
| Obtenção do token | Página "Chave de API": https://app.gptmaker.ai/browse/developers                                                   | Confirmado | https://developer.gptmaker.ai/api-reference/introduction               |
| Content-Type      | `application/json` em todos os corpos de requisição e resposta                                                     | Confirmado | openapi.json                                                           |
| IDs               | Todos os IDs de path são `string`                                                                                  | Confirmado | openapi.json                                                           |
| Status de sucesso | `200` em todas as rotas deste documento                                                                            | Confirmado | openapi.json                                                           |

Respostas de erro presentes em **todas** as rotas deste documento:

| Status | Descrição na doc  | Corpo                                                          |
| ------ | ----------------- | -------------------------------------------------------------- |
| `400`  | "Erro inesperado" | `{ "error": string }` (schema `Error`, `error` obrigatório)    |
| `403`  | "Erro de token"   | `{ "error": string }` (schema `Error403`, `error` obrigatório) |

Detalhes em §9.

---

## 1. Workspace

### 1.1 Listar workspaces

- **`GET /v2/workspaces`** — "Lista os workspaces da conta"
- Fonte: https://developer.gptmaker.ai/api-reference/workspace/list
- Parâmetros: nenhum.
- Resposta `200`: **array** de `Workspace` (sem envelope, sem paginação documentada).

| Campo  | Tipo   | Status     |
| ------ | ------ | ---------- |
| `id`   | string | Confirmado |
| `name` | string | Confirmado |

Exemplo (montado a partir do schema):

```json
[{ "id": "string", "name": "string" }]
```

### 1.2 Saldo de créditos do workspace

- **`GET /v2/workspace/{workspaceId}/credits`** — "Lista a quantidade de crédito disponível na conta."
- Fonte: https://developer.gptmaker.ai/api-reference/workspace/credits
- Path: `workspaceId` (string, obrigatório).
- Resposta `200` (schema `Credits`):

| Campo     | Tipo                                                                                 | Status     |
| --------- | ------------------------------------------------------------------------------------ | ---------- |
| `credits` | **integer** — "Quantidade de crédito disponível no workspace"                        | Confirmado |
| `status`  | string enum `TRIAL` \| `ACTIVE` \| `PAST_DUE` \| `CANCELED` — "Status da assinatura" | Confirmado |

```json
{ "credits": 0, "status": "ACTIVE" }
```

### 1.3 Listar agentes do workspace

- **`GET /v2/workspace/{workspaceId}/agents`** — "Lista os agentes disponíveis nesse workspace"
- Fonte: https://developer.gptmaker.ai/api-reference/workspace/list-agent
- Path: `workspaceId` (string, obrigatório).
- Query (todos opcionais):

| Nome       | Tipo            | Descrição                  |
| ---------- | --------------- | -------------------------- |
| `page`     | integer (int32) | Número da página           |
| `pageSize` | integer (int32) | Tamanho da página          |
| `query`    | string          | Filtro pelo nome do agente |

- Resposta `200`: **array** de `Assistant` (ver §2.0). **Não há envelope de paginação** (sem `total`, `hasMore` etc.). Base da página (0 ou 1), valor padrão e máximo de `pageSize`: **NÃO DOCUMENTADO**.

---

## 2. Agente

### 2.0 Schemas `Assistant` (resposta) e `NewAssistant` (requisição)

`Assistant` (retornado em listar/obter/criar/atualizar):

| Campo                | Tipo                                   | Descrição                  | Status                                            |
| -------------------- | -------------------------------------- | -------------------------- | ------------------------------------------------- |
| `id`                 | string                                 | ID do agente               | Confirmado                                        |
| `name`               | string                                 | Nome do agente             | Confirmado                                        |
| `behavior`           | string                                 | Comportamento do agente    | Confirmado                                        |
| `avatar`             | string                                 | URL de um avatar           | Confirmado                                        |
| `communicationType`  | enum `FORMAL` \| `NORMAL` \| `RELAXED` | Tipo de comunicação        | Confirmado                                        |
| `type`               | enum `SUPPORT` \| `SALE` \| `PERSONAL` | Objetivo do agente         | Confirmado                                        |
| `jobName`            | string                                 | Nome da empresa ou produto | Confirmado                                        |
| `jobSite`            | string                                 | Site da empresa            | Confirmado                                        |
| `jobDescription`     | string                                 | Descrição sobre a empresa  | Confirmado                                        |
| `status`             | string                                 | Status do agente           | **Observado** (fora do OpenAPI): `ACTIVE` (ativo) | `DISABLED` (inativo) em `GET /workspace/{id}/agents` e `GET /agent/{id}` |
| `workspaceId`, datas | —                                      | —                          | **NÃO DOCUMENTADO** (não fazem parte do schema)   |

`NewAssistant` = mesmos campos de `Assistant` **sem `id`**: `name`, `avatar`, `behavior`, `communicationType`, `type`, `jobName`, `jobSite`, `jobDescription`. Nenhum campo está marcado como obrigatório no OpenAPI (quais o servidor exige na prática: **NÃO DOCUMENTADO**).

### 2.1 Criar agente

- **`POST /v2/workspace/{workspaceId}/agents`** — "Cria um novo agente no workspace"
- Fonte: https://developer.gptmaker.ai/api-reference/workspace/create-agent
- Path: `workspaceId` (string, obrigatório).
- Body (obrigatório): `NewAssistant`.
- Resposta `200`: `Assistant`.

```json
{
  "name": "string",
  "avatar": "string",
  "behavior": "string",
  "communicationType": "FORMAL",
  "type": "SUPPORT",
  "jobName": "string",
  "jobSite": "string",
  "jobDescription": "string"
}
```

### 2.2 Obter agente

- **`GET /v2/agent/{agentId}`** — "Busca dados do agente por ID"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/get-by-id
- Resposta `200`: `Assistant`.

### 2.3 Atualizar agente

- **`PUT /v2/agent/{agentId}`** — "Atualiza os detalhes de um agente existente"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/update
- Body (obrigatório): `NewAssistant`. Se é atualização parcial (merge) ou substituição total: **NÃO DOCUMENTADO**.
- Resposta `200`: `Assistant`.

### 2.4 Remover agente

- **`DELETE /v2/agent/{agentId}`** — "Remover agente"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/delete-agent
- Resposta `200`: `{ "success": boolean }`.

### 2.5 Ativar agente

- **`PUT /v2/agent/{agentId}/active`** — "Ativa um agente existente"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/active
- Sem body. Resposta `200`: `{ "success": boolean }`.

### 2.6 Inativar agente

- **`PUT /v2/agent/{agentId}/inactive`** — "Inativa um agente existente"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/inactive
- Sem body. Resposta `200`: `{ "success": boolean }`.

---

## 3. Settings do agente

### 3.1 Obter configurações

- **`GET /v2/agent/{agentId}/settings`** — "Obtém as configurações de um agente existente"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/get-settings

### 3.2 Atualizar configurações

- **`PUT /v2/agent/{agentId}/settings`** — "Atualiza as configurações de um agente existente"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/settings
- Body (obrigatório): objeto abaixo. Parcial vs. total: **NÃO DOCUMENTADO**.
- Resposta `200`: `{ "success": boolean }` (não devolve as settings).

### 3.3 Campos

| Campo                         | Tipo                                                                                                                         | GET     | PUT | Descrição (doc)                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefferModel`                | enum string (lista abaixo)                                                                                                   | sim     | sim | "Modelo de LLM preferido". **Grafia oficial com dois "f" e um "r": `prefferModel`**                                                                                                                                       |
| `timezone`                    | string                                                                                                                       | sim     | sim | "Timezone do agente" (formato — ex. IANA — **NÃO DOCUMENTADO**)                                                                                                                                                           |
| `enabledHumanTransfer`        | boolean                                                                                                                      | sim     | sim | Se pode transferir para humano                                                                                                                                                                                            |
| `enabledReminder`             | boolean                                                                                                                      | sim     | sim | Se pode agendar lembretes                                                                                                                                                                                                 |
| `splitMessages`               | boolean                                                                                                                      | sim     | sim | Dividir mensagem grande em várias                                                                                                                                                                                         |
| `enabledEmoji`                | boolean                                                                                                                      | sim     | sim | Se pode usar emojis                                                                                                                                                                                                       |
| `limitSubjects`               | boolean                                                                                                                      | sim     | sim | Restringir a assuntos da empresa/produto                                                                                                                                                                                  |
| `messageGroupingTime`         | enum `NO_GROUP` \| `FIVE_SEC` \| `TEN_SEC` \| `THIRD_SEC` \| `ONE_MINUTE`                                                    | sim     | sim | (a doc copia por engano a descrição "Modelo de LLM preferido"; pelo nome, é o tempo de agrupamento de mensagens). Nota: o valor é literalmente `THIRD_SEC` (provavelmente "30 s"), não `THIRTY_SEC`                       |
| `signMessages`                | boolean                                                                                                                      | **não** | sim | "Define se a mensagem do agente vai ser assinada ou não" (só aparece no PUT)                                                                                                                                              |
| `maxDailyMessages`            | integer, `nullable` no GET                                                                                                   | sim     | sim | Limite de interações por atendimento. PUT: valores aceitos `null` (sem limite), `20`, `50`, `100`, `200`, `500`, `1000`; "qualquer valor além desses não será aceito"                                                     |
| `maxDailyMessagesLimitAction` | enum `TEMP_BLOCK_30S` \| `TEMP_BLOCK_5M` \| `TEMP_BLOCK_10M` \| `TEMP_BLOCK_30M` \| `TEMP_BLOCK_1H` \| `BLOCK` \| `TRANSFER` | sim     | sim | Ação ao atingir o limite; usado só quando `maxDailyMessages` não é nulo                                                                                                                                                   |
| `knowledgeByFunction`         | boolean                                                                                                                      | sim     | sim | Ativa a "busca inteligente" no treinamento                                                                                                                                                                                |
| `onLackKnowLedge`             | string                                                                                                                       | sim     | sim | "Na falta de conhecimento o agente lança um webhook" (grafia oficial `onLackKnowLedge`, com "L" maiúsculo em "Ledge"). Semântica exata do valor (URL? texto?) **NÃO DOCUMENTADA**; o mesmo nome aparece nos webhooks (§5) |

Enum de `prefferModel` (idêntico em GET e PUT, na ordem da doc):

```
GPT_5_6_SOL, GPT_5_6_TERRA, GPT_5_6_LUNA, GPT_5_5, GPT_5_4, GPT_5_4_MINI,
GPT_5_2, GPT_5_1, GPT_5, GPT_5_MINI, GPT_4_1, GPT_4_1_MINI,
OPEN_AI_O4_MINI, OPEN_AI_O3, OPEN_AI_O3_MINI, OPEN_AI_O1,
GPT_4_O, GPT_4_O_MINI, GPT_4,
CLAUDE_5_SONNET, CLAUDE_4_6_SONNET, CLAUDE_4_5_SONNET, CLAUDE_4_5_HAIKU,
CLAUDE_3_7_SONNET, CLAUDE_3_5_SONNET, CLAUDE_3_5_HAIKU,
DEEPINFRA_LLAMA3_3, QWEN_2_5_MAX,
DEEPSEEK_V4_PRO, DEEPSEEK_V4_FLASH, DEEPSEEK_CHAT,
SABIA_3_1, SABIA_3
```

Custo por resposta de cada modelo (tabela da página de cobrança, https://developer.gptmaker.ai/billing). O mapeamento enum → nome comercial abaixo é inferido pela correspondência de nomes (a doc não liga explicitamente enum a linha da tabela):

| Enum (inferido)    | Nome na tabela                    | Créditos/resposta |
| ------------------ | --------------------------------- | ----------------- |
| GPT_5_6_SOL        | GPT-5.6 Sol                       | 14                |
| GPT_5_6_TERRA      | GPT-5.6 Terra                     | 7                 |
| GPT_5_6_LUNA       | GPT-5.6 Luna                      | 1                 |
| GPT_5_5            | GPT-5.5                           | 14                |
| GPT_5_4            | GPT-5.4                           | 7                 |
| GPT_5_4_MINI       | GPT-5.4 Mini                      | 2                 |
| GPT_5_2            | GPT-5.2                           | 5                 |
| GPT_5_1            | GPT-5.1                           | 4                 |
| GPT_5              | GPT-5                             | 4                 |
| GPT_5_MINI         | GPT-5 Mini                        | 1                 |
| GPT_4_1            | GPT-4.1                           | 4                 |
| GPT_4_1_MINI       | GPT-4.1 Mini                      | 1                 |
| OPEN_AI_O4_MINI    | o4-Mini                           | 3                 |
| OPEN_AI_O3         | o3                                | 5                 |
| OPEN_AI_O3_MINI    | o3-Mini (Beta)                    | 3                 |
| OPEN_AI_O1         | o1                                | 25                |
| GPT_4_O            | GPT-4o                            | 5                 |
| GPT_4_O_MINI       | GPT-4o Mini                       | 1                 |
| GPT_4              | GPT-4 Turbo                       | 20                |
| CLAUDE_5_SONNET    | Claude 5 Sonnet                   | 10                |
| CLAUDE_4_6_SONNET  | Claude 4.6 Sonnet                 | 10                |
| CLAUDE_4_5_SONNET  | Claude 4.5 Sonnet                 | 10                |
| CLAUDE_4_5_HAIKU   | Claude 4.5 Haiku                  | 3                 |
| CLAUDE_3_7_SONNET  | Claude 3.7 Sonnet (descontinuado) | 10                |
| CLAUDE_3_5_SONNET  | Claude 3.5 Sonnet (descontinuado) | 10                |
| CLAUDE_3_5_HAIKU   | Claude 3.5 Haiku (descontinuado)  | 2                 |
| DEEPINFRA_LLAMA3_3 | LLaMA 3.3 (Meta)                  | 1                 |
| QWEN_2_5_MAX       | Qwen 2.5 Max (Alibaba)            | 3                 |
| DEEPSEEK_V4_PRO    | Deepseek V4 Pro                   | 5                 |
| DEEPSEEK_V4_FLASH  | Deepseek V4 Flash                 | 1                 |
| DEEPSEEK_CHAT      | Deepseek V3                       | 1                 |
| SABIA_3_1          | Sabiá 3.1 (Maritaca)              | 3                 |
| SABIA_3            | Sabiá 3 (Maritaca)                | 3                 |

Atenção: essa lista de modelos muda com frequência (a doc já inclui modelos marcados como descontinuados). Recomenda-se tipar `prefferModel` como `string` com união conhecida + fallback, em vez de enum fechado.

---

## 4. Treinamentos

### 4.1 Listar treinamentos do agente

- **`GET /v2/agent/{agentId}/trainings`** — "Lista os treinamentos do agente"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/list-trainings
- Query:

| Nome       | Tipo                                              | Obrigatório | Descrição                                     |
| ---------- | ------------------------------------------------- | ----------- | --------------------------------------------- |
| `type`     | enum `TEXT` \| `WEBSITE` \| `VIDEO` \| `DOCUMENT` | **sim**     | Tipo a filtrar (só lista um tipo por chamada) |
| `page`     | integer (int32)                                   | não         | Número da página                              |
| `pageSize` | integer (int32)                                   | não         | Tamanho da página                             |
| `query`    | string                                            | não         | Filtro                                        |

- Resposta `200`: **array** (sem envelope) de um dos schemas conforme o `type`:

| Schema             | Campos                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `TextTraining`     | `id`, `type: "TEXT"`, `text`, `image`                                                                           |
| `WebsiteTraining`  | `id`, `type: "WEBSITE"`, `website`, `trainingSubPages` (`DISABLED`\|`ACTIVE`), `trainingInterval` (enum abaixo) |
| `VideoTraining`    | `id`, `type: "VIDEO"`, `video`                                                                                  |
| `DocumentTraining` | `id`, `type: "DOCUMENT"`, `documentUrl`, `documentName`, `documentMimetype`                                     |

Status do processamento do treinamento (ex. pendente/erro), datas: **NÃO DOCUMENTADO**.

### 4.2 Criar treinamento

- **`POST /v2/agent/{agentId}/trainings`** — "Adiciona um novo treinamento ao agente"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/create-training
- Body (obrigatório), `oneOf` discriminado por `type` (nenhum campo marcado como obrigatório no OpenAPI):

**TEXT**

| Campo         | Tipo     | Descrição                                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------- |
| `type`        | `"TEXT"` |                                                                                 |
| `text`        | string   | Texto do treinamento                                                            |
| `image`       | string   | URL de uma imagem para o treinamento                                            |
| `callbackUrl` | string   | Webhook notificado quando o treinamento finaliza com sucesso ou erro (opcional) |

**WEBSITE**

| Campo              | Tipo                                                                                                                                     | Descrição                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `type`             | `"WEBSITE"`                                                                                                                              |                             |
| `website`          | string                                                                                                                                   | Website                     |
| `trainingSubPages` | enum `DISABLED` \| `ACTIVE`                                                                                                              | Treinar subpáginas          |
| `trainingInterval` | enum `THIRTY_SECONDS` \| `NEVER` \| `ONE_HOUR` \| `FOUR_HOUR` \| `EIGHT_HOUR` \| `TWELVE_HOUR` \| `ONE_DAY` \| `ONE_WEEK` \| `ONE_MONTH` | Intervalo de re-treinamento |
| `callbackUrl`      | string                                                                                                                                   | (opcional)                  |

**VIDEO**

| Campo         | Tipo      | Descrição    |
| ------------- | --------- | ------------ |
| `type`        | `"VIDEO"` |              |
| `video`       | string    | URL do vídeo |
| `callbackUrl` | string    | (opcional)   |

**DOCUMENT**

| Campo              | Tipo         | Descrição                                                     |
| ------------------ | ------------ | ------------------------------------------------------------- |
| `type`             | `"DOCUMENT"` |                                                               |
| `documentUrl`      | string       | URL do documento                                              |
| `documentName`     | string       | Nome do documento                                             |
| `documentMimetype` | string       | Tipo MIME (grafia oficial: `documentMimetype`, "t" minúsculo) |
| `callbackUrl`      | string       | (opcional)                                                    |

- Resposta `200`: `{ "success": boolean }`. **A resposta não devolve o `id` do treinamento criado** (para obtê-lo, é preciso listar).
- Formato do payload enviado ao `callbackUrl`: **NÃO DOCUMENTADO**. MIME types aceitos e tamanho máximo de documento: **NÃO DOCUMENTADO**.

### 4.3 Atualizar treinamento

- **`PUT /v2/training/{trainingId}`** (singular `training`, sem agentId)
- Fonte: https://developer.gptmaker.ai/api-reference/trainings/update-training
- Doc: "Atualmente só é possível atualizar treinamentos de texto, para os demais treinamentos, é necessário remover e adicionar novamente."
- Body (obrigatório): `{ "type": "TEXT", "text": string, "image": string }` (sem `callbackUrl`).
- Resposta `200`: `{ "success": boolean }`.

### 4.4 Remover treinamento

- **`DELETE /v2/training/{trainingId}`**
- Fonte: https://developer.gptmaker.ai/api-reference/trainings/delete-training
- Resposta `200`: `{ "success": boolean }`.

---

## 5. Webhooks do agente

### 5.1 Obter webhooks

- **`GET /v2/agent/{agentId}/webhooks`**
- Fonte: https://developer.gptmaker.ai/api-reference/agents/get-webhooks

### 5.2 Atualizar webhooks

- **`PUT /v2/agent/{agentId}/webhooks`**
- Fonte: https://developer.gptmaker.ai/api-reference/agents/webhooks
- Body (obrigatório): mesmo objeto do GET. Parcial vs. total e como remover um webhook (string vazia? `null`?): **NÃO DOCUMENTADO**.
- Resposta `200`: `{ "success": boolean }`.

### 5.3 Campos (todos `string` — URL do webhook)

| Campo                 | Disparo (texto da doc)                                      |
| --------------------- | ----------------------------------------------------------- |
| `onNewMessage`        | "sempre que uma nova mensagem chega em um chat"             |
| `onLackKnowLedge`     | "quando o agente não sabe responder a uma pergunta"         |
| `onTransfer`          | "quando o agente transfere o atendimento para um humano"    |
| `onFirstInteraction`  | "assim que o primeiro atendimento com o cliente é iniciado" |
| `onStartInteraction`  | "sempre que um atendimento com o cliente é iniciado"        |
| `onFinishInteraction` | "sempre que um atendimento é finalizado"                    |
| `onCreateEvent`       | "sempre que um agendamento é realizado"                     |
| `onCancelEvent`       | "sempre que um agendamento é cancelado"                     |

Os 8 nomes do rascunho estão todos confirmados com a grafia exata acima.

### 5.4 Payload enviado pelo GPTMaker

**NÃO DOCUMENTADO** na documentação oficial para os 8 eventos: corpo, headers, método HTTP, assinatura/HMAC, política de retry e timeout. Isso vale também para os callbacks `callbackUrl`/`onFinishCallback` da conversa (§6) e `callbackUrl` de treinamento (§4.2). Schemas que podem servir de pista: `Message`, `Chat`, `Interaction` no OpenAPI (ver Apêndice A).

#### 5.4.1 Payloads observados (capturados em 2026-10-01, conversa pela API, `channel: "API"`)

Capturados pelo endpoint `/gptmaker/webhooks/{event}` do app (gravados em `agent_event`). Chegam por `POST` com corpo JSON. Valores de ids e nomes trocados por exemplos.

`onFirstInteraction` e `onStartInteraction` (mesmo corpo; os dois chegaram juntos no primeiro atendimento do diálogo):

```json
{
  "name": "Maria",
  "agentId": "<id do agente>",
  "channel": "API",
  "protocol": 1005,
  "channelId": "<id do canal>",
  "contextId": "public-api-<id do agente>-<tenantId>:chat9498",
  "recipient": "<tenantId>:chat9498",
  "interactionId": "<id do atendimento>"
}
```

`onNewMessage` (um por mensagem, do cliente e do agente; `role` distingue):

```json
{
  "date": "2026-10-01T17:26:53.388+00:00",
  "role": "user",
  "audios": [],
  "images": [],
  "channel": "API",
  "message": "Boa tarde",
  "contextId": "public-api-<id do agente>-<tenantId>:chat9498",
  "documents": [],
  "messageId": "<id da mensagem>",
  "assistantId": "<id do agente>",
  "contactName": "Maria",
  "contactPhone": null
}
```

Observações:

- **`contextId` vem prefixado** pelo GPTMaker: `public-api-<agentId>-` + o `contextId` que o app mandou na conversa (§6). O valor original só aparece em `recipient`, e só nos eventos de atendimento (`onFirstInteraction`, `onStartInteraction`). O app tira o diálogo do Bitrix do que vem depois de `<tenantId>:`, em `contextId` ou `recipient`.
- `onNewMessage` chega também para as respostas do agente (`role: "assistant"`), poucos segundos depois da mensagem do cliente.
- O corpo do `onNewMessage` usa `assistantId`; o dos atendimentos, `agentId`.
- O `contextId` prefixado é o id do chat no GPTMaker: é o `id` que `GET /workspace/{id}/chats` devolve para esse diálogo (§7). O `interactionId` identifica o atendimento.
- **Não capturados** (não dispararam no teste): `onTransfer` (pedir humano só gerou `onNewMessage`; provavelmente exige transferência configurada no agente), `onLackKnowLedge`, `onFinishInteraction`, `onCreateEvent`, `onCancelEvent`. Headers, assinatura e retries também seguem sem confirmação.

---

## 6. Conversa com o agente

- **`POST /v2/agent/{agentId}/conversation`** — "Permite conversar com o agente via API enviando texto, imagem ou áudio"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/conversation
- Body (obrigatório): `oneOf` com 5 variantes. Campos comuns a todas:

| Campo              | Tipo   | Descrição (doc)                                                                                                          | `example` na doc         |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `contextId`        | string | "ID externo para identificar o cliente" — **obrigatório em todas as variantes**                                          | `"12345"`                |
| `callbackUrl`      | string | "Caso seja informado, a chamada será assíncrona, quando o agente responder, ele vai chamar esse webhook com a resposta." | `"https://webhook.site"` |
| `onFinishCallback` | string | "Caso seja informado, será disparado um webhook sempre que o atendimento for finalizado."                                | `"https://webhook.site"` |
| `chatName`         | string | Nome do cliente                                                                                                          | `"Fulano"`               |
| `chatPicture`      | string | Foto do cliente exibida no chat                                                                                          | `"https://foto.jpeg"`    |
| `phone`            | string | "Número de whatsapp do cliente."                                                                                         | `"55xxxxxxxx"`           |

Variantes (campos específicos e obrigatórios):

| Variante (título na doc) | Campos específicos                   | `required`                         |
| ------------------------ | ------------------------------------ | ---------------------------------- |
| Texto                    | `prompt` (string)                    | `contextId`, `prompt`              |
| Imagem                   | `prompt`, `image` (URL)              | `contextId`, `prompt`, `image` (¹) |
| Áudio                    | `audio` (URL) — sem `prompt`         | `contextId`, `audio`               |
| Vídeo                    | `video` (URL), `prompt` (caption)    | `contextId`, `video`               |
| Documento                | `document` (URL), `prompt` (caption) | `contextId`, `document`            |

(¹) Divergência da API real (testado em 2026-10-01): imagem sem `prompt` (ou com `prompt: ""`) é aceita, `200` com `success: true`, e o agente descreve a imagem. O app manda o texto do cliente como `prompt` só quando existe.

Exemplo (valores copiados dos `example` do OpenAPI, variante Texto):

```json
{
  "contextId": "12345",
  "prompt": "oi qual seu nome?",
  "callbackUrl": "https://webhook.site",
  "onFinishCallback": "https://webhook.site",
  "chatName": "Fulano",
  "chatPicture": "https://foto.jpeg",
  "phone": "55xxxxxxxx"
}
```

Resposta `200` ("Resposta do agente"):

| Campo       | Tipo     | Descrição                       |
| ----------- | -------- | ------------------------------- |
| `message`   | string   | Resposta do agente              |
| `images`    | string[] | URLs das imagens respondidas    |
| `audios`    | string[] | URLs dos áudios respondidos     |
| `documents` | string[] | URLs dos documentos respondidos |

```json
{ "message": "string", "images": ["string"], "audios": ["string"], "documents": ["string"] }
```

Observações:

- **A resposta NÃO informa créditos consumidos**, nem ID de mensagem/chat/interação. Para consumo, usar §8 (agregado por dia/modelo) ou calcular pela tabela de custo por modelo (§3.3).
- Campo `email`: **NÃO DOCUMENTADO** (não existe no schema).
- Resposta quando `callbackUrl` é informado (chamada assíncrona): corpo da resposta imediata e payload enviado ao callback **NÃO DOCUMENTADOS**.
- Comportamento quando o chat está sob controle humano (§7), agente inativo ou sem créditos: **NÃO DOCUMENTADO**.
- Relação `contextId` ↔ `chatId`: `chatId = public-api-<agentId>-<contextId>` (observado; ver §7).

Endpoint relacionado (fora do rascunho, útil para disparos ativos): **`POST /v2/agent/{agentId}/add-message`** — adiciona mensagem ao contexto sem gerar resposta; campos `contextId` (obrigatório), `prompt`, `image`/`audio`/`video`/`document`, `role` (`"user"` ou `"assistant"`, default `"assistant"`). Fonte: https://developer.gptmaker.ai/api-reference/agents/add-context

---

## 7. Controle humano do chat

### 7.1 Assumir atendimento

- **`PUT /v2/chat/{chatId}/start-human`** — "Marcar que um humano vai assumir o atendimento, IA para de responder o chat."
- Fonte: https://developer.gptmaker.ai/api-reference/chats/start-human
- Path: `chatId` (string). Sem body.
- Resposta `200`: `{ "success": boolean }`.

### 7.2 Encerrar atendimento humano

- **`PUT /v2/chat/{chatId}/stop-human`** — "Encerrar atendimento humano, isso fará que a proxima interação do cliente, o agente volte a responder."
- Fonte: https://developer.gptmaker.ai/api-reference/chats/stop-human
- Path: `chatId` (string). Sem body.
- Resposta `200`: `{ "success": boolean }`.

O estado atual é exposto pelo campo `humanTalk` (boolean) do schema `Chat`, retornado por `GET /v2/workspace/{workspaceId}/chats` (https://developer.gptmaker.ai/api-reference/chats/list-chats).

**`chatId` de uma conversa pela API (observado em 2026-10-01):** `public-api-<agentId>-<contextId>`, onde `<contextId>` é o valor mandado em `/conversation` (§6). A listagem de chats devolve esse `id`, com o `contextId` original em `recipient` e `type: "API"`; é o mesmo valor que chega como `contextId` nos webhooks (§5.4.1). O app calcula o `chatId` sem consultar a listagem. Ainda não testado: `start-human`/`stop-human` com esse id.

---

## 8. Consumo de créditos por agente

- **`GET /v2/agent/{agentId}/credits-spent`** — "Retorna o consumo de créditos por agente dentro de um período"
- Fonte: https://developer.gptmaker.ai/api-reference/agents/credits-spent
- Query (todos opcionais): `year` (int32), `month` (int32), `day` (int32). Valores padrão quando omitidos, base do mês (1–12?) e fuso horário usado no agrupamento: **NÃO DOCUMENTADO**.
- Resposta `200`:

| Campo            | Tipo            | Descrição                                                                                                                   |
| ---------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `total`          | integer (int32) | Total de créditos gastos                                                                                                    |
| `data`           | array           |                                                                                                                             |
| `data[].credits` | integer         | Créditos gastos                                                                                                             |
| `data[].year`    | integer         | Ano                                                                                                                         |
| `data[].month`   | integer         | Mês                                                                                                                         |
| `data[].day`     | integer         | Dia                                                                                                                         |
| `data[].model`   | string          | "Modelo de IA que consumiu os créditos" (se usa os valores do enum `prefferModel` ou o nome comercial: **NÃO DOCUMENTADO**) |

```json
{ "total": 0, "data": [{ "credits": 0, "year": 2026, "month": 9, "day": 25, "model": "string" }] }
```

**Observado em 2026-10-03** (workspace de teste, chamadas reais):

- `year` é **obrigatório**: sem ele a API responde `Year is required` (texto puro), apesar de o OpenAPI marcar todos como opcionais. Com `year` + `month` vêm os dias do mês; com `day`, só aquele dia.
- `data[].model` traz o **código do enum** `prefferModel` (ex.: `GPT_5_MINI`), o mesmo do catálogo de modelos do app.
- Os totais bateram com as respostas do app no mesmo dia (6 créditos em 03/10 para 6 respostas de GPT-5 Mini). O GPTMaker também conta conversas feitas fora do app (testes no painel), que só a reconciliação corrige.
- O **fuso** do agrupamento por dia segue a confirmar: as mensagens de teste caíram no mesmo dia em UTC e em Brasília. A reconciliação usa `RECONCILIATION_TIMEZONE` (padrão `America/Sao_Paulo`); uma mensagem entre 21:00 e 23:59 de Brasília resolve a dúvida.

**Inteiros ou fracionários?** Em toda a documentação os créditos são `integer`: `Credits.credits`, `total` (int32), `data[].credits`, e a tabela de cobrança usa apenas valores inteiros por resposta (1 a 25). Não há menção a créditos fracionários. Observação para implementação: `int32` limita `total` a 2.147.483.647.

---

## 9. Rate limits e formato de erro

- **Rate limits: NÃO DOCUMENTADO.** Nenhuma menção a limites de requisição, status `429`, headers `X-RateLimit-*` ou `Retry-After` no OpenAPI nem nas páginas.
- Formato de erro documentado (todas as rotas deste documento):
  - `400` — "Erro inesperado" — `{ "error": "<mensagem>" }`
  - `403` — "Erro de token" — `{ "error": "<mensagem>" }` (token inválido/ausente responde **403**, não 401)
- Outras rotas da API (fora do escopo) documentam também `500` com `{ "error": string }` e `204` com corpo — portanto um cliente robusto deve tratar `500` e `2xx` em geral.
- `401`, `404`, `422`, `429`: **NÃO DOCUMENTADOS**. Conteúdo/códigos das mensagens `error`: **NÃO DOCUMENTADO**.

---

## Apêndice A — Schemas auxiliares (OpenAPI)

`Chat`: `id`, `humanTalk` (bool), `userPicture`, `messageUserName`, `read` (bool), `role`, `agentName`, `agentId`, `whatsappPhone`, `finished` (bool), `avatar`, `title`, `type`, `userName`, `userId`, `picture`, `conversationType`, `createdAt` (integer), `name`, `recipient`, `time` (integer), `unReadCount` (integer), `conversation`.

`Message`: `id`, `role`, `type`, `text`, `time` (integer), `userPicture`, `fileName`, `documentUrl`, `userName`, `midiaContent`, `userId`, `audioUrl`, `imageUrl`, `width`, `height`.

`Interaction`: `id`, `agentId`, `agentName`, `agentAvatar`, `chatId` ("Id do chat/contextId"), `chatName`, `status` (`RUNNING`\|`WAITING`\|`RESOLVED`), `startAt`, `transferAt`, `resolvedAt` (date-time), `userId`.

---

## Divergências e lacunas

### Rotas: rascunho x real

| Rascunho                                  | Real (confirmado)                                           | Diferença                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/workspaces`                             | `GET /v2/workspaces`                                        | ok (plural)                                                                                             |
| `/workspace/{id}/credits`                 | `GET /v2/workspace/{workspaceId}/credits`                   | ok (singular); `status` TRIAL\|ACTIVE\|PAST_DUE\|CANCELED confirmado                                    |
| `/workspace/{id}/agents`                  | `GET /v2/workspace/{workspaceId}/agents`                    | ok; paginação por `page`/`pageSize` + filtro `query`, sem envelope                                      |
| criar agente "no workspace"               | `POST /v2/workspace/{workspaceId}/agents`                   | —                                                                                                       |
| obter/atualizar/remover agente            | `GET` / `PUT` / `DELETE /v2/agent/{agentId}`                | atualização é **PUT** (não PATCH)                                                                       |
| `/agent/{id}/active`, `/inactive`         | `PUT /v2/agent/{agentId}/active` e `/inactive`              | confirmados; verbo **PUT**                                                                              |
| settings                                  | `GET` / `PUT /v2/agent/{agentId}/settings`                  | `prefferModel` confirmado com essa grafia                                                               |
| treinamentos por agente                   | `GET` / `POST /v2/agent/{agentId}/trainings`                | plural; `type` é **obrigatório** no GET                                                                 |
| atualizar/remover treinamento             | `PUT` / `DELETE /v2/training/{trainingId}`                  | rota **singular** e fora de `/agent`; PUT só para TEXT                                                  |
| webhooks                                  | `GET` / `PUT /v2/agent/{agentId}/webhooks`                  | 8 nomes confirmados                                                                                     |
| `/agent/{id}/conversation`                | `POST /v2/agent/{agentId}/conversation`                     | ok                                                                                                      |
| `/chat/{id}/start-human` ou `human-start` | `PUT /v2/chat/{chatId}/start-human`                         | é **`start-human`**; encerrar é **`PUT /v2/chat/{chatId}/stop-human`** (não "end-human"/"finish-human") |
| `/agent/{id}/credits-spent`               | `GET /v2/agent/{agentId}/credits-spent`                     | ok; filtros `year`/`month`/`day`                                                                        |
| base `https://api.gptmaker.ai/v2`         | host `https://api.gptmaker.ai`, `/v2` embutido em cada path | equivalente                                                                                             |

### Campos: rascunho x real

- Conversa: **`email` não existe** no schema. Existem campos não previstos no rascunho: `onFinishCallback`, `chatPicture`, e variantes `video` e `document` (além de `image` e `audio`).
- Conversa com áudio: variante não tem `prompt`. Conversa com imagem exige `prompt`.
- Resposta da conversa: além de `message`, `images`, `audios`, tem `documents`. **Não informa créditos consumidos.**
- Settings: `signMessages` existe só no PUT (não aparece na resposta do GET). `messageGroupingTime` tem o valor `THIRD_SEC` (grafia oficial, provavelmente "30 s"). `onLackKnowLedge` aparece tanto em settings quanto em webhooks.
- Treinamento TEXT aceita `image`; treinamento VIDEO usa campo `video`.
- Criar treinamento retorna só `{ success }` (sem `id`).
- Criar/atualizar agente retornam `Assistant`; ativar/inativar/remover retornam `{ success }`.
- Erro de autenticação é **403**, não 401.

### Não documentado (precisa de validação empírica)

1. Payload, headers, método, assinatura e retries dos webhooks. Capturados `onFirstInteraction`, `onStartInteraction` e `onNewMessage` (§5.4.1); faltam `onTransfer`, `onLackKnowLedge`, `onFinishInteraction`, `onCreateEvent`, `onCancelEvent`, os callbacks da conversa e o `callbackUrl` de treinamento, além de headers, assinatura e retries de todos.
2. Resposta imediata da conversa quando `callbackUrl` é informado (modo assíncrono).
3. Rate limits (`429`, headers, cotas).
4. Paginação: base de `page`, padrão/máximo de `pageSize`, ausência de total.
5. Campos obrigatórios reais em `NewAssistant`, settings, webhooks e criação de treinamento (OpenAPI não marca `required`).
6. Semântica de PUT (merge parcial ou substituição) em agente, settings e webhooks; forma de limpar um webhook.
7. Enum completo de `status` do agente (observados `ACTIVE` e `DISABLED`; o campo não está no OpenAPI).
8. Status de processamento de treinamentos; MIME types e tamanhos aceitos.
9. Fuso horário do agrupamento por dia em credits-spent (o `model` é o código do enum e `year` é obrigatório: §8).
10. Formato de `timezone` e do valor de `onLackKnowLedge` em settings.
11. Comportamento da conversa com chat em modo humano, agente inativo ou workspace sem créditos (status HTTP e corpo).
12. Mapeamento oficial enum `prefferModel` → linha da tabela de custo (feito aqui por correspondência de nome).
