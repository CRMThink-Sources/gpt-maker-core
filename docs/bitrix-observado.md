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

O app precisa de `imbot`, `imopenlines`, `im`, `crm`, `task`, `bizproc`, `user` e, para o agendamento
do agente (change `agent-calendar-scheduling`), `calendar`. Sem `calendar`, `calendar.*` responde
`insufficient_scope` (`BitrixError.isScopeMissing`); o escopo é incluído no cadastro do app no
Bitrix24/plataforma e exige reinstalar.
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

## Calendário (`calendar.*`)

Observado em 2026-11-11 no portal `crmthinkers`, com um token OAuth (`auth=`) do usuário 508
(administrador, fuso `America/Sao_Paulo`) e os escopos `crm`, `user_brief`, `task`, `imbot`,
`imopenlines`, `placement`, `calendar` e `calendarmobile`. Usado pela change
`agent-calendar-scheduling`. Eventos, contato, lead e empresa de teste (prefixo `[TESTE]`) foram
criados e apagados na mesma execução.

- **Escopo**: `calendar` aparece no método `scope`. Sem ele, as chamadas respondem
  `insufficient_scope`.
- `calendar.event.add { type: 'user', ownerId, auto_detect_section: 'Y', name, from, to,
timezone_from, timezone_to, attendees, accessibility, crm_fields }`: devolve o id do evento
  (número). `from`/`to` aceitam `YYYY-MM-DD HH:mm:ss` com `timezone_from`/`timezone_to` explícitos.
  `auto_detect_section: 'Y'` dispensa descobrir a seção (o evento caiu na seção do dono, `SECTION_ID`).
- `calendar.event.get { type: 'user', ownerId, from, to }`: devolve a lista de eventos do dono.
  Cada evento traz `DATE_FROM_TS_UTC`/`DATE_TO_TS_UTC` (**não são UTC de verdade**: ver o item
  "Horário real do evento"), `TZ_FROM`, `~USER_OFFSET_FROM`,
  `ACCESSIBILITY` (`busy`), `CAL_TYPE`, `OWNER_ID`, `ATTENDEES_CODES` (`["U508"]`) e
  `UF_CRM_CAL_EVENT`. `DATE_FROM` vem formatada no idioma do usuário (`24/11/2026 14:00:00`):
  não usar para cálculo.
- **Vínculo com o CRM**: `crm_fields: ["C_<id>"]` (contato), `["L_<id>"]` (lead) e `["CO_<id>"]`
  (empresa) voltam idênticos em `UF_CRM_CAL_EVENT`. O método **não filtra** por esse campo: é
  preciso listar os eventos e filtrar no cliente.
- `calendar.accessibility.get { users, from, to }`: `from`/`to` só com data. Devolve, por usuário,
  os eventos que ocupam o período, com `ACCESSIBILITY`, `DATE_FROM_TS_UTC`, `DATE_TO_TS_UTC`,
  `TZ_FROM` e `~USER_OFFSET_FROM`. O evento criado apareceu logo em seguida como `busy`.
- **Horário real do evento (correção de 2026-11-11)**: `DATE_FROM_TS_UTC` **não é UTC**. É o instante
  escrito na hora de parede de **quem consulta** (o usuário do token), como se fosse UTC, e
  `~USER_OFFSET_FROM` é o deslocamento do fuso do evento em relação ao de quem consulta. Medido com o
  usuário 508 (perfil em São Paulo, UTC-3): evento de 14:20 em São Paulo (`timezone_from`
  `America/Sao_Paulo`) volta com `14:20Z` e offset `0`; evento de 10:00 em Nova York (= 15:00Z) volta
  com `12:00Z` e offset `-7200`; o exemplo da documentação do Bitrix24 (consulta em UTC, evento em
  Manágua) volta com o UTC real e offset `-21600`. A hora de parede **no fuso do evento** é
  `TS + ~USER_OFFSET_FROM`, e o instante real sai de convertê-la com `TZ_FROM`
  (`eventInterval` em `crm-tools/calendar-slots.ts`). A duração (`TO - FROM`) é a real. A
  `START_TIME` das atividades do CRM **é** o instante real, com o deslocamento do portal.
- **Sem proteção contra choque**: um segundo `calendar.event.add` no mesmo horário e na mesma agenda
  foi aceito e criou outro evento (id diferente), sem erro. A exclusividade do horário é do app.
- **Evento privado**: `private_event: 'Y'` volta em `PRIVATE_EVENT` como `"1"` (não `"Y"`).
- `calendar.event.delete { id }` e `crm.contact|lead|company.delete { id }`: `true`.
- **Agenda de outro usuário**: com o token do administrador 508, criar (`ownerId: 418`) e ler o
  calendário de outro usuário funcionou; o evento ficou com `OWNER_ID` e `MEETING_HOST` do dono
  (418), `CREATED_BY` do token (508) e apareceu na ocupação do 418. **Não testado**: token de
  usuário não administrador. Premissa informada pelo time (2026-11-11): o token da instalação
  guardado no banco é sempre o de um administrador.
- **`calendar.event.get` é pesado**: as recorrências vêm expandidas. A agenda de um usuário real
  devolveu 631 eventos em 14 dias (1,3 MB, ~1,0 s) e 2357 em 60 dias (4,9 MB, ~1,4 s); 205 eram
  privados e voltaram na lista (o filtro de privado é do app). Não serve para varrer agendas.
- **Atividade do CRM espelha o evento vinculado**: um evento com `crm_fields` gera uma atividade
  `CRM_TODO` (`PROVIDER_TYPE_ID: TODO`, `TYPE_ID: 6`) no contato/lead/empresa, com `SUBJECT` = nome
  do evento, `START_TIME`/`END_TIME` (instante correto, com o deslocamento do portal, ex.:
  `+03:00`), `RESPONSIBLE_ID` = dono da agenda e `ASSOCIATED_ENTITY_ID = 0` (sem o id do evento).
  Criar, editar (nome e horário) e apagar o evento refletem na atividade (testado com espera de
  1,5 s). `crm.activity.list { filter: { OWNER_TYPE_ID, OWNER_ID, PROVIDER_ID, '>=START_TIME' } }`
  levou ~240 ms. **Evento privado vinculado também gera atividade**, então a atividade não
  distingue o privado.
- **Evento criado à mão (tarefa 7.2, 2026-11-11)**: um evento criado na tela do Calendário, vinculado a
  um contato, gera a **mesma atividade `CRM_TODO`** (`TYPE_ID 6`, `ASSOCIATED_ENTITY_ID 0`, assunto =
  nome do evento, responsável = dono da agenda, `COMPLETED N`), e o `START_TIME` dela é o instante
  real do evento (evento de 17:20 em São Paulo ⇒ `2026-11-11T23:20:00+03:00` = 20:20Z). O
  `agendamentos_do_cliente` enxerga, portanto, compromissos criados por pessoas e pela API.
- **Filtros de `crm.activity.list` (tarefa 7.2)**: `>=START_TIME`, `<=START_TIME` (precisão de
  minuto, com `+00:00`), `PROVIDER_ID` e `RESPONSIBLE_ID` como lista são todos respeitados.
- **Ainda sem como distinguir**: uma atividade `CRM_TODO` criada à mão, sem evento, é indistinguível
  pelos campos acima e seria listada como compromisso.
