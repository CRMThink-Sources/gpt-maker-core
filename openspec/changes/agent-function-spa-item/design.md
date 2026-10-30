# Design

## Context

- As ações das intenções "Ação no Bitrix24" vêm de `actionSchemas(true)` em `packages/contracts/src/triggers.ts` e rodam no `TriggerActionExecutor` (`backend/src/modules/triggers/actions/action-executor.ts`), chamado pelo `intention-runner.ts`.
- No template de função, a ação é `{ type, config: record }` livre (`functionIntentionSchema`); a compilação (`agent-function-compiler.ts`, `renderConfig`) troca os marcadores e valida o resultado com o schema real da intenção. Marcador sozinho que vira número vira número (funil, usuário).
- Campos do Bitrix no formulário (`BITRIX_STAGE`, `BITRIX_OPENLINE`, `BITRIX_USER`) são escolhidos no navegador via BX24 (`frontend/src/lib/crm-fields`, `bitrix-pickers.tsx`), com digitação manual quando as listas falham.
- `{{dialog.id}}` é `chat9498`. O `imopenlines.dialog.get` (já chamado para o vínculo com o CRM) traz `entity_data_1` = `Y|DEAL|27134|N|N|1932|1790875607|0|0|0` (`docs/bitrix-observado.md`).

## Goals / Non-Goals

**Goals:**
- Template portátil entre portais: nenhum código de campo do portal no template.
- Reaproveitar o pipeline atual (template livre → compilação → schema da intenção → executor) sem um segundo caminho de execução.

**Non-Goals:**
- A ação nos gatilhos (editor de gatilhos) e na tela de intenções manuais. O schema fica disponível no `triggerActionInputSchema` só se sair de graça; a UI não.
- Vincular o item ao contato/empresa do diálogo, atualizar item existente, campos de arquivo, multi-valor e campos `crm` (vínculo).

## Decisions

### D1. Ação compilada `CREATE_SPA_ITEM` com códigos reais
Schema (intenção):
```ts
{ type: 'CREATE_SPA_ITEM', config: {
  entityTypeId: positiveId,            // SPA (>= 1030 nos dinâmicos)
  categoryId: nonnegative.optional(),  // funil do SPA
  stageId: string.max(50).optional(),  // DT1030_5:NEW
  title: template,
  fields: fieldMap,                    // { ufCrm5_123: '{{fields.prioridade}}' }
  lists: record(code, record(option, positiveId)).optional(), // { ufCrm5_123: { HIGH: 103 } }
} }
```
É a mesma forma dos outros passos: o executor não conhece o formulário. `lists` guarda só a escolha do cliente; a correspondência automática fica no executor (D4).

*Alternativa:* o executor receber o "slot" e resolver o mapeamento na hora lendo as respostas. Recusada: espalha conhecimento do formulário pelo runtime e quebra a regra "ação inteira validada depois de compilada".

### D2. Campo `BITRIX_SPA` com valores declarados (slots)
```ts
{ kind: 'BITRIX_SPA', id, label, help?, required,
  values: [{ id: /^[a-z][a-z0-9_]*$/, label, help?, required, options?: string[] (1–20) }] (1–20) }
```
Resposta do cliente:
```ts
{ entityTypeId: number, categoryId?: number, stageId?: string,
  fields: { [valueId]: string /* código do campo */ },
  lists?: { [valueId]: { [option]: number /* id do item da lista */ } } }
```
Marcadores: o campo não vira texto (`fieldText` → `''`) e o peso no orçamento é 0, como `AGENT`. Só é válido como `spa` da ação.

*Alternativa:* deixar o cliente adicionar pares livres campo = valor (sem slots). Recusada pelo usuário: o template perde o controle do que é gravado e não dá para checar uso nem obrigatoriedade.

### D3. Ação no template com `spa` + `values`, traduzida na compilação
No template:
```json
{ "type": "CREATE_SPA_ITEM", "config": { "spa": "{{suporte.spa}}", "title": "Chamado: {{fields.resumo}}",
  "values": { "origem": "CHAT", "prioridade": "{{fields.prioridade}}", "chat": "{{dialog.chatId}}" } } }
```
A compilação, antes do `renderConfig`, troca `spa`/`values` por `entityTypeId`/`categoryId`/`stageId`/`fields`/`lists` usando a resposta do campo; valor sem código escolhido sai. As checagens estáticas (`agent-function-check` / `checkTemplate`) cobrem: `spa` é marcador sozinho de `BITRIX_SPA`; chaves de `values` ⊂ valores declarados; todo valor declarado usado em alguma ação; dependente com `when`. Na validação das respostas (`agent-function-answers.ts`): SPA escolhido quando o campo é obrigatório; valor obrigatório com código.

### D4. Listas: ligação do cliente, depois correspondência automática
O executor, quando há algum campo em `fields`, lê `crm.item.fields { entityTypeId }` (uma vez por execução, sem cache: a intenção roda poucas vezes por conversa e o campo pode mudar no portal). Para campo `enumeration` (ou `crm_status`): usa `lists[code][texto]`; senão procura item com `VALUE` ou `XML_ID` igual ao texto (case-insensitive); senão omite o campo e devolve `warnings`. Campos fora da lista vão como texto.
A chave de `fields` vem do `crm.item.fields`, que já devolve o nome em camelCase (`ufCrm5_1712345678`), o formato aceito pelo `crm.item.add`.

### D5. `dialog.chatId` e `dialog.sessionId`
- `chatId`: derivado de `dialog.id` (`/^chat(\d+)$/`), sem chamada ao Bitrix. Entra no `TemplateContext.dialog` e em `TEMPLATE_VARIABLES`.
- `sessionId`: 6º segmento de `entity_data_1` do `imopenlines.dialog.get`. O executor já faz essa chamada (lazy, uma por execução) para o vínculo; passa a extrair as duas coisas do mesmo resultado. O render só pede a sessão se algum texto da ação citar `dialog.sessionId` (o binding continua lazy).
- O segmento não é documentado: a tarefa 1 confirma num portal real (comparando com `imopenlines.session` / o histórico do chat) e registra em `docs/bitrix-observado.md`. Se não confirmar, a implementação da sessão para e a decisão volta ao usuário (ver Riscos); o resto da change segue.

### D6. Prioridade pelo agente com critérios do formulário
Sem mecanismo novo: o template declara campos de texto ("Quando é urgente", "Quando é alta"…) e o campo coletado "Prioridade" da intenção diz na `description`: "Uma de: LOW, NORMAL, HIGH, URGENT. URGENT: {{suporte.criterio_urgent}}…". A descrição já aceita marcadores (`intentionTexts`). O limite da descrição (500) é o orçamento; a skill orienta textos curtos.

### D7. Frontend
- `bitrix-pickers.tsx`: `SpaPicker` (lista de `crm.type.list`), funil (`crm.category.list { entityTypeId }`), etapa (`crm.status.list` `ENTITY_ID = DYNAMIC_<id>_STAGE_<categoryId>`), e por valor um select de campos (`crm.item.fields`, só `isReadOnly = false`). Com opções e campo lista: um select por opção, pré-preenchido pela mesma correspondência do D4. Fallback digitado, como `PipelineStageFields`.
- Editor do backoffice: o campo `BITRIX_SPA` (lista de valores) em `field-editor.tsx` e a ação em `intention-editor.tsx` (escolher o campo de SPA e preencher cada valor declarado).

## Risks / Trade-offs

- [Segmento da sessão em `entity_data_1` não documentado] → confirmar num portal antes de implementar (tarefa 1); teste de unidade com a resposta real; se o formato mudar, a variável fica vazia em vez de gravar lixo.
- [Campo do SPA apagado ou renomeado depois da publicação] → o Bitrix recusa ou ignora; a ação falha com a mensagem do Bitrix e o histórico da intenção mostra. Republicar refaz o mapeamento.
- [Agente envia prioridade fora da lista] → item criado sem o campo + aviso (D4); a descrição do campo coletado lista as opções exatas.
- [Uma chamada a mais por execução (`crm.item.fields`)] → só quando há `fields`; se pesar, cache curto por portal+SPA.

## Migration Plan

Aditivo: novo tipo de campo, nova ação e novas variáveis; templates e agentes existentes não mudam. Rollback = reverter o deploy; templates que já usem `BITRIX_SPA` deixam de validar e precisam ser despublicados antes.

## Open Questions

- Nome exato do campo do título em SPAs com título desativado: `crm.item.add` aceita `title` sempre? Confirmar no portal junto com a tarefa 1; não muda o desenho.
