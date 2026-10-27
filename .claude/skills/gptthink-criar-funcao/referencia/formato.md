# Formato do JSON da função

## Raiz

| Chave | Tipo | Regra |
|---|---|---|
| `code` | string | `^[A-Z][A-Z0-9_]*$`, único (ex.: `COBRANCA`) |
| `name` | string | 1–100 |
| `description` | string | 1–500; o cliente lê ao escolher a função |
| `draft` | objeto | abaixo |

## `draft`

| Chave | Tipo | Regra |
|---|---|---|
| `agentType` | `"SALE"` \| `"SUPPORT"` \| `"PERSONAL"` | tipo do agente no GPT Maker (vendas/qualificação = `SALE`) |
| `settings` | objeto | settings padrão da função (ver abaixo); as opções podem sobrescrever |
| `profile` | `{ jobName ≤200, jobDescription ≤500, jobSite ≤200 }` | aceita marcadores; normalmente `{{empresa.nome}}` e `{{empresa.descricao}}` |
| `blocks` | string[] | ≤10 códigos de `blocos.json` |
| `crmAccess` | boolean | `false` se incluir o bloco `crm` (ele já liga) |
| `fields` | campo[] | ≥1 próprio; ≤40 de topo somando os dos blocos |
| `behavior` | string | 1–3000 caracteres crus; pior caso compilado ≤3000 |
| `intentions` | intenção[] | ≤10 próprias |
| `transfers` | transferência[] | ≤5; transferências para outro agente (abaixo) |

### `settings` (todas opcionais)

`enabledHumanTransfer`, `limitSubjects`, `enabledEmoji`, `enabledReminder`, `splitMessages`, `signMessages`, `knowledgeByFunction` (boolean); `timezone` (ex.: `"America/Sao_Paulo"`); `messageGroupingTime` (`NO_GROUP`, `FIVE_SEC`, `TEN_SEC`, `THIRD_SEC`, `ONE_MINUTE`); `maxDailyMessages` (`null`, 20, 50, 100, 200, 500, 1000); `maxDailyMessagesLimitAction` (`TEMP_BLOCK_30S`, `TEMP_BLOCK_5M`, `TEMP_BLOCK_10M`, `TEMP_BLOCK_30M`, `TEMP_BLOCK_1H`, `BLOCK`, `TRANSFER`); `onLackKnowLedge` (texto ≤2000; o evento não dispara na prática, use o bloco `duvida`).

Usual: `{ "enabledHumanTransfer": true, "limitSubjects": true }`.

## Campos

Todos têm `kind`, `id` (`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, sem começar por `contact`, `message`, `agent`, `event`, `dialog`, `interaction`, `payload`, `fields`), `label` (1–120), `required` (boolean) e `help` opcional (≤300).

| `kind` | Chaves extras | No comportamento vira | Peso no pior caso |
|---|---|---|---|
| `TEXT` | `maxLength` 1–3000, `multiline` (bool), `placeholder` ≤200 | o texto | `maxLength` |
| `TEXT_LIST` | `minItems` 0–20, `maxItems` 1–20, `itemMaxLength` 1–1000, `placeholder` | linhas `- item` | `maxItems × (itemMaxLength + 3) − 1` |
| `URL` | `maxLength` 10–2000 (padrão 200) | o link | `maxLength` |
| `INTEGER` | `min`, `max` | o número | dígitos |
| `BITRIX_USER` | `multiple` (bool, padrão `false`) | id do usuário (use em `responsibleId`/`userId`); com `multiple: true` o cliente escolhe vários e a ação usa **um de cada vez, em rodízio** | 7 (vários: 20 × 9) |
| `BITRIX_OPENLINE` | — | id do canal aberto (use em `lineId` do `TRANSFER_TO_HUMAN`) | 7 |
| `AGENT` | — | **nada**: o cliente escolhe outro agente do portal, destino de uma `transfers[]` | 0 |
| `BITRIX_STAGE` | — | use `{{id.categoryId}}` e `{{id.stageId}}` em `UPSERT_DEAL` | — |
| `CHOICE` | `options` (1–10) | o `snippet` da opção escolhida | o trecho mais longo |
| `MULTI_CHOICE` | `options` (1–10), `separator` ≤10 (padrão `"\n\n"`) | trechos marcados unidos pelo separador | todos os trechos |
| `KNOWLEDGE` | `maxItems` 1–50, `subfields` (1–6), `format` 1–500 | **nada**: cada item vira um treinamento | 0 |

### Opção (`CHOICE` / `MULTI_CHOICE`)

```json
{
  "value": "funil",                      // ^[a-z][a-z0-9_]*$, único no campo
  "label": "Em um negócio de um funil",  // 1–120, o cliente vê
  "snippet": "Registre em um negócio do funil escolhido.", // 1–3000, obrigatório; pode citar outros campos
  "dependents": [ /* campos, ≤10: aparecem e são exigidos só com esta opção */ ],
  "effects": { "communicationType": "FORMAL", "settings": { "enabledEmoji": false } }
}
```

`effects.communicationType`: `FORMAL`, `NORMAL` ou `RELAXED` (o bloco `comum` já cuida do tom).

### Subcampo de `KNOWLEDGE`

`{ "id": "pergunta", "label": "Pergunta", "required": true, "maxLength": 200, "multiline": false }`. O `id` segue `^[a-z][a-z0-9_]*$`; o `format` usa `{{pergunta}}` (sem prefixo). Uma linha do `format` cujos subcampos ficaram todos vazios some do treinamento. `format` + soma dos `maxLength` ≤ 1028. Comece o format com um rótulo: `"Pergunta: {{pergunta}}\nResposta: {{resposta}}"`.

## Intenções

```json
{
  "key": "abrir_chamado",            // ^[a-z][a-z0-9_]*$, estável: liga às versões publicadas
  "name": "Abrir chamado",           // 1–255; é o nome citado no comportamento entre aspas
  "whenToUse": "Quando ...",         // 1–512; aceita marcadores de campo
  "when": { "field": "suporte.escalonamento", "in": ["chamado"] }, // opcional: só existe com essa escolha
  "fields": [                        // ≤20: o que o agente coleta na conversa
    { "name": "Resumo", "description": "O problema e o que já foi tentado.", "type": "STRING", "required": true }
  ],
  "collectFrom": "sdr.perguntas",    // opcional: TEXT_LIST cujos itens viram pergunta_1, pergunta_2...
  "actions": [ /* 1–10 passos, abaixo */ ],
  "responseMode": "INSTRUCTIONS",    // ou "API"
  "instructions": "Confirme que o chamado foi aberto." // obrigatória com INSTRUCTIONS; ≤5000; aceita marcadores
}
```

- `fields[].type`: `STRING`, `NUMBER`, `BOOLEAN`, `DATE`, `DATE_TIME`, `URL`.
- Nas ações, o campo coletado é `{{fields.<nome normalizado>}}`: sem acento, minúsculas, não alfanumérico vira `_` ("Dados do cliente" → `fields.dados_do_cliente`).
- Com `collectFrom`: `{{intencao.respostas}}` lista "pergunta: resposta" e `{{fields.pergunta_N}}` existe.
- Variáveis da conversa: `{{contact.name}}`, `{{contact.phone}}`, `{{message.text}}`, `{{agent.name}}`, `{{dialog.id}}`, `{{interaction.protocol}}`, `{{event.date}}`.
- `when` na ação liga só aquele passo. Passo que usa um dependente precisa de `when` com a opção pai.

### Passos (`actions[]`): `{ "when"?, "type", "config" }`

| `type` | `config` |
|---|---|
| `TIMELINE_COMMENT` | `{ "text": "..." }`: comentário no registro do CRM vinculado à conversa |
| `CREATE_LEAD` | `{ "fields": { "TITLE": "...", "COMMENTS": "...", "NAME": "{{contact.name}}", "PHONE": "{{contact.phone}}" } }`: `TITLE` obrigatório; chaves são campos do Bitrix (aceita `UF_CRM_...`) |
| `UPSERT_DEAL` | `{ "categoryId": "{{x.funil.categoryId}}", "stageId": "{{x.funil.stageId}}", "fields": { "TITLE": "...", "COMMENTS": "..." } }` |
| `CREATE_TASK` | `{ "title": "...", "description": "...", "responsibleId": "{{x.responsavel}}", "deadlineDays": "{{x.prazo}}" }`: prazo 0–365 |
| `START_BIZPROC` | `{ "templateId": 12, "documentType": "LEAD" \| "DEAL" \| "CONTACT" \| "COMPANY", "parameters": { "Param": "..." } }` |
| `TRANSFER_TO_HUMAN` | `{ "target": "OPERATOR" }`, `{ "target": "USER", "userId": "{{x.usuario}}" }` (campo de vários usuários ⇒ rodízio) ou `{ "target": "LINE", "lineId": "{{x.canal}}" }` (fila de um canal aberto): transfere depois da resposta |

Números (`categoryId`, `responsibleId`, `deadlineDays`, `templateId`, `userId`, `lineId`) são número literal ou **um marcador sozinho** de `INTEGER`, `BITRIX_USER`, `BITRIX_OPENLINE` ou `<funil>.categoryId`; na compilação viram número. Marcador de `BITRIX_USER` com `multiple: true` vira a lista de ids (rodízio) em `responsibleId` e `userId`.

## Transferências entre agentes (`transfers[]`)

Viram regras de transferência do agente no GPT Maker: o modelo decide transferir lendo `instructions`; a conversa, o chat e o bot do Bitrix24 continuam os mesmos. Não são intenções e não aparecem no texto.

```json
{
  "key": "orcamento",                       // ^[a-z][a-z0-9_]*$, estável
  "when": { "field": "x.orcamento", "in": ["agente"] }, // opcional
  "agent": "{{x.agente_vendas}}",           // marcador sozinho de um campo AGENT
  "instructions": "Quando o cliente pedir orçamento.", // 1–1000, aceita marcadores de campo
  "returnOnFinish": false                   // true: a conversa volta a este agente quando o destino terminar
}
```

- Se o campo `AGENT` é dependente de uma opção, a transferência precisa de `when` com essa opção.
- Transferir para **pessoa** continua sendo a ação `TRANSFER_TO_HUMAN` de uma intenção.

Textos de ação (≤5000) aceitam marcadores de campo do formulário (resolvidos ao publicar) e variáveis da conversa (resolvidas na hora).

## Padrão "onde registrar"

Com o bloco `registro`, faça dois passos com `when` em `registro.onde`, como o bloco `duvida` faz:

```json
{ "when": { "field": "registro.onde", "in": ["conversa"] }, "type": "TIMELINE_COMMENT", "config": { "text": "..." } },
{ "when": { "field": "registro.onde", "in": ["funil"] }, "type": "UPSERT_DEAL",
  "config": { "categoryId": "{{registro.funil.categoryId}}", "stageId": "{{registro.funil.stageId}}", "fields": { "TITLE": "...", "COMMENTS": "..." } } }
```
