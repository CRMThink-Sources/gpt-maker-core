# Bitrix24: comportamento observado

O que a documentação oficial do Bitrix24 não descreve (ou descreve de forma incompleta) e foi
confirmado num portal real. Cada item diz onde o app depende dele.

## Eventos do chatbot (`imbot.v2`, webhook)

- **Autenticação:** comparar o `auth[application_token]` do nível de cima do evento com o token da
  instalação (o mesmo do `ONAPPINSTALL`). O `data.bot.auth.application_token` traz o mesmo valor.
  Sem o `ONAPPINSTALL` registrado, a plataforma fica sem token e todo evento é recusado
  (`token_mismatch` com `expected: null`). Observado em 2026-10-01.
- **Anexo do cliente** (`ONIMBOTV2MESSAGEADD`): vem em `data.message.params.FILE_ID`, lista de ids
  do Disco em texto (`{ "FILE_ID": ["247650"] }`), com `text` vazio quando só há o arquivo. O
  `imbot.v2.File.download` com esse id devolve o link de download. Usado em
  `channel/message-attachments.ts` e `chat-media.ts`. Observado em 2026-10-01.
- **Sessão nova da Linha Aberta:** o `ONIMBOTV2JOINCHAT` chega junto com a primeira mensagem do
  cliente. O app usa esse evento como fim do atendimento humano (9.8). A chegada a cada sessão nova
  depois de um atendimento humano ainda precisa ser confirmada.

## Vínculo do diálogo com o CRM (`imopenlines.dialog.get`)

Chamado com `DIALOG_ID` (`chat9498`). Resposta real (2026-10-01), só os campos de vínculo:

```json
{
  "id": 9498,
  "type": "lines",
  "entity_type": "LINES",
  "entity_id": "hubthink_thinkzap_homolog|136|271902299951214@lid|2002",
  "entity_data_1": "Y|DEAL|27134|N|N|1932|1790875607|0|0|0",
  "entity_data_2": "LEAD|0|COMPANY|39964|CONTACT|9448|DEAL|27134",
  "entity_data_3": "N",
  "dialog_id": "chat9498"
}
```

- `entity_data_2`: pares tipo e id (`LEAD`, `COMPANY`, `CONTACT`, `DEAL`), `0` quando não há vínculo.
  É o que o app lê para as ações dos gatilhos (`triggers/actions/crm-binding.ts`).
- `entity_data_1`: começa com `Y` (vinculado ao CRM) e a entidade principal (`DEAL|27134`). O
  **6º segmento é a sessão atual** da Linha Aberta daquele chat: em 2026-10-30, no portal
  `crmthinkers`, o `chat9500` teve as sessões 2002, 2006 e 2008 (atividades `IMOPENLINES_SESSION`
  do CRM) e o `imopenlines.dialog.get` devolveu `Y|DEAL|39808|N|N|2008|1793305311|0|0|0` para
  qualquer uma delas, ou seja, sempre a mais recente. O 7º parece um timestamp. É de onde vem
  `{{dialog.sessionId}}` (`triggers/actions/crm-binding.ts`).
- `entity_id`: conector, linha, id do cliente no conector e usuário (aqui, uma linha de WhatsApp).

## Escopos da instalação

O app precisa de `imbot`, `imopenlines`, `im`, `crm`, `task`, `bizproc` e `user` (tarefa 6.1).
Para conferir os concedidos, chame o método `scope` com o token da instalação. Em 2026-10-01, a
instalação de teste (`2017`) tinha só `crm`, `imbot`, `imopenlines`, `im`, `user_brief` e
`placement`. Sem `task`, o `tasks.task.add` responde `insufficient_scope`, e o mesmo vale para o
`bizproc.workflow.start` sem `bizproc`. As ações "criar tarefa" e "business process" dos gatilhos
dependem desses escopos. Corrigir no cadastro do app no Bitrix24 e reinstalar.

## Processos inteligentes (SPA)

Observado em 2026-10-30 no portal `crmthinkers` (SPA "SPA Vitor", `entityTypeId` 1204). Usado pela
ação "Criar item de SPA" (`triggers/actions/action-executor.ts`) e pelo seletor do formulário
(`frontend/src/lib/crm-fields`).

- `crm.type.list`: paginado (`next`), 50 por página; `types[].entityTypeId` (≥ 1030) e `title`.
  `isCategoriesEnabled = N` ⇒ só o funil padrão.
- `crm.category.list { entityTypeId }`: `categories[]` com `id`, `name`, `isDefault`.
- Etapas: `crm.status.list` com `ENTITY_ID = DYNAMIC_<entityTypeId>_STAGE_<categoryId>`; o
  `STATUS_ID` é `DT1204_180:NEW` (esse texto é o `stageId` do item).
- `crm.item.fields { entityTypeId }`: chaves em camelCase. Os campos do cliente vêm com
  `isDynamic: true`, e o formato do código **varia** conforme como e quando o campo foi criado:
  `ufCrm136_1750943184955` (criado na tela do SPA), `ufCrm_6712345`, `ufCrm_ADDRESS_2` e
  `ufCrmContactId` (o "SPA Vitor" tem 94 campos assim) e `ufCrmCodigo` (todos os 8 do SPA 1310).
  Os do sistema (`title`, `stageId`, `assignedById`...) vêm com `isDynamic: false`. O seletor do
  formulário usa `isDynamic`, não o formato do código (2026-10-30). Campo lista:
  `type = enumeration`, `items[] = { ID, VALUE }` (sem `XML_ID` nesse portal). `title` é "Nome",
  não obrigatório.
- `crm.item.add`: ainda não exercitado com campo lista; a confirmação fica para o teste de
  integração da change `agent-function-spa-item` (6.1).
