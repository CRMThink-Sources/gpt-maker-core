# Design

## Context

O agente acessa o CRM por um servidor MCP sem estado (`crm-tools`, design S8 de `crm-semantic-layer-mcp`): uma credencial por agente (`agent_crm_access`) determina tenant e portal; `CrmToolsService.run` aplica limite por agente (Redis), tempo máximo de 10 s, métricas e log sem dados pessoais; o cliente da conversa vem do vínculo do diálogo na Linha Aberta (ou do cliente simulado no chat de teste) e circula como referência assinada (`ClientRefs`). Hoje todas as ferramentas são somente leitura. Ver `proposal.md` para a motivação e `specs/agent-calendar-scheduling/spec.md` para o comportamento.

Fatos da API do Bitrix24 que moldam a solução (documentação oficial, a confirmar no portal de teste, ver tarefas):

- `calendar.event.add` (escopo `calendar`): cria o evento com `type`, `ownerId`, `from`, `to`, `name`, `timezone_from`/`timezone_to`, `attendees`, `crm_fields` (ex.: `C_5`, `L_11`, `CO_1`, `D_7`) e aceita `auto_detect_section: Y`, o que dispensa descobrir a seção do calendário.
- `calendar.accessibility.get` recebe `users`, `from` e `to` **só com data** (`YYYY-MM-DD`) e devolve os eventos que ocupam cada usuário, com `ACCESSIBILITY` e `DATE_FROM_TS_UTC`/`DATE_TO_TS_UTC`.
- `calendar.event.get` exige `type` e `ownerId`, **não filtra por vínculo com o CRM** (o vínculo vem em `UF_CRM_CAL_EVENT`) e devolve as recorrências expandidas, o que o torna pesado em agendas reais (ver D6).
- O app hoje não tem o escopo `calendar` (`docs/bitrix-observado.md`, "Escopos da instalação"). Chamada sem ele responde `insufficient_scope`.
- Não existe reserva transacional de horário: dois `event.add` concorrentes no mesmo horário criam dois eventos.

## Goals / Non-Goals

**Goals:**

- Reaproveitar a credencial, o guard, o limite, o isolamento e o registro de `crm-tools`; o agente enxerga as novas ferramentas no mesmo servidor MCP.
- Calcular a disponibilidade no servidor (agenda + expediente + antecedência), de forma que o agente só ofereça horários realmente válidos e nunca invente um.
- Impedir agendamento duplicado e reduzir a corrida entre dois agendamentos no mesmo horário.
- Isolar a escrita: um único tipo de dado criado (evento de calendário), com cliente já identificado.

**Non-Goals:**

- Remarcar, cancelar, convidar o cliente por e-mail, lembretes ativos, salas/recursos e sincronização com Google/Outlook.
- Um calendário próprio do GPTThink: a fonte de verdade é o Calendário do Bitrix24.
- Garantia forte de exclusividade de horário (o Bitrix24 não oferece); a solução é de melhor esforço, com verificação imediata antes de criar.

## Decisions

### D1. Ferramentas dentro de `crm-tools`, não num módulo novo

As ferramentas entram em `backend/src/modules/crm-tools/` (arquivos `calendar-*.ts`), registradas em `buildMcpServer`. A parte comum de `CrmToolsService.run` (limite, tempo máximo, métricas, log, `last_call_at`) é extraída para um executor compartilhado (`tool-runner.ts`) usado pelos dois serviços.

- *Por quê*: mesma credencial, mesmo guard, mesmo limite de 60/min. Um módulo `calendar` separado precisaria importar `crm-tools` (referência do cliente, `run`) e `crm-tools` registrar as ferramentas dele, criando ciclo (`depcruise` proíbe).
- *Alternativa descartada*: segundo servidor MCP para agenda: duplica credencial, conexão no GPTMaker e limite.

### D2. Configuração em tabela própria `agent_calendar_config`

Uma linha por agente: `agent_id` (PK, FK), `tenant_id` (FK), `mode` (`FIXED_USER` | `CLIENT_OWNER` | `USER_LIST`), `user_ids` (lista de ids numéricos de usuários do Bitrix24; vazia em `CLIENT_OWNER`), `slot_minutes`, `min_notice_minutes`, `max_days_ahead`, `created_at`, `updated_at`. Ausência da linha = agenda não configurada. A API de configuração valida os usuários contra o portal (`UserNamesService`/`user.get`) e exige `agent_crm_access.status = CONNECTED`.

- *Por quê*: `agent_crm_access` guarda estado de credencial e de integração no GPTMaker; agenda é preferência do cliente e muda em outro ritmo. Migration aditiva, sem risco para dados existentes.
- *Alternativa descartada*: colunas novas em `agent_crm_access`: mistura ciclo de vida de credencial com configuração e engorda uma tabela quente (atualizada a cada chamada por `last_call_at`).

### D3. Disponibilidade calculada no servidor

`horarios_livres` monta uma grade de slots e subtrai os ocupados:

1. **Agendas**: resolvidas pelo modo (D5).
2. **Janela**: dias de `hoje` até `hoje + max_days_ahead` no fuso da agenda. Expediente: o horário de funcionamento do agente (`agent-business-hours`, com o fuso dele); sem horário configurado, segunda a sexta, 09:00–18:00, `America/Sao_Paulo`.
3. **Ocupação**: um `calendar.accessibility.get` por chamada, com todos os usuários da agenda e o intervalo de datas. Contam apenas `ACCESSIBILITY` `busy` e `absent`. Os instantes vêm de `DATE_FROM_TS_UTC`/`DATE_TO_TS_UTC` (UTC), sem interpretar as strings de data formatadas, que dependem do idioma do usuário.
4. **Grade**: slots de `slot_minutes`, alinhados ao início de cada intervalo do expediente, que cabem inteiros no intervalo, depois da antecedência mínima e sem sobrepor ocupação (no modo `USER_LIST`, o slot é livre se **qualquer** usuário estiver livre).
5. **Resposta**: os 10 primeiros, no fuso da agenda.

- *Por quê*: o LLM não deve fazer aritmética de calendário nem inventar horários; o servidor devolve só o que `agendar_compromisso` aceitaria.
- *Alternativa descartada*: devolver os eventos ocupados e deixar o agente deduzir: erra fuso, expediente e sobreposição.

### D4. Criação com trava, revalidação e idempotência

`agendar_compromisso` executa, para a chave `(tenant, agente, cliente, agenda escolhida, início)`:

1. Verifica a referência do cliente (`ClientRefs.verify`) e o início contra as regras de D3 (expediente, grade, antecedência, janela).
2. Adquire um `DistributedLock` curto por `(tenant, usuário-dono)`, relê a ocupação do dia (`accessibility.get`) e confirma que o slot continua livre; no modo `USER_LIST`, escolhe o primeiro usuário da lista livre.
3. Consulta a chave de idempotência no Redis (`calendar:booked:<hash>`, TTL 24 h); se existir, devolve o agendamento já feito.
4. Chama `calendar.event.add` (`type: user`, `ownerId`, `auto_detect_section: Y`, `from`/`to` com `timezone_from`/`timezone_to`, `attendees: [ownerId]`, `crm_fields` com o prefixo do cliente, `name` e `description` curtos, `accessibility: busy`) e grava a chave com o id do evento.

O lock reduz a corrida entre dois agentes do próprio sistema; agendamentos feitos diretamente por pessoas no Bitrix24 no mesmo instante ainda podem colidir (aceito, ver Riscos).

- *Alternativa descartada*: confiar só em verificar-depois-criar sem lock: dois agentes concorrentes passam na verificação e criam em duplicidade.
- *Alternativa descartada*: idempotência só por `eventId` devolvido: o `event.add` falha entre a criação e a resposta, e o retry duplica.

### D5. Quem é o dono da agenda

- `FIXED_USER`: `user_ids[0]`.
- `CLIENT_OWNER`: `ASSIGNED_BY_ID` do contato, lead ou empresa identificado na conversa (já lido por `identifyClient`/`getRecord`); sem responsável ou inativo, responde "sem agenda" (sem fallback silencioso).
- `USER_LIST`: todos os usuários da lista para a disponibilidade; na criação, o primeiro livre na ordem configurada.

O agente nunca informa nem recebe ids de usuário; recebe o nome (via `UserNamesService`) e a referência do cliente.

- *Alternativa descartada*: rodízio ponderado ou por menor carga no `USER_LIST`: exige contar eventos por usuário a cada agendamento e não foi pedido. Fica como evolução.

### D6. Consulta dos agendamentos do cliente

`agendamentos_do_cliente` lê as **atividades do CRM** do cliente, não as agendas. Observado no portal de teste (`docs/bitrix-observado.md`): um evento criado com `crm_fields` gera uma atividade `CRM_TODO` no contato, lead ou empresa, com início, fim e responsável (o dono da agenda), e ela acompanha a edição e a exclusão do evento. A consulta é um único `crm.activity.list` com `OWNER_TYPE_ID`/`OWNER_ID` do cliente, `PROVIDER_ID = CRM_TODO`, `START_TIME` de agora a +60 dias e `RESPONSIBLE_ID` entre os usuários das agendas do agente (D5; em `CLIENT_OWNER`, o responsável do cliente). Devolve até 10, por início, só com data, hora, duração, fuso e quem atende (nome via `UserNamesService`), convertendo o instante para o fuso da agenda.

- *Por quê*: `calendar.event.get` não filtra por vínculo com o CRM e devolve as recorrências expandidas (631 eventos em 14 dias para um usuário real, 4,9 MB em 60 dias, e até 10 usuários por agente); a atividade custa ~240 ms e uma chamada.
- *Privado*: o evento privado vinculado também gera atividade e ela não o distingue. Como a atividade já aparece na linha do tempo do cliente, a ferramenta **nunca devolve título nem descrição**: só o horário ocupado e quem atende.
- *Limite aceito*: uma atividade `CRM_TODO` criada à mão, sem evento, é indistinguível pelos campos observados e seria listada como compromisso; evento criado à mão com vínculo deve gerar a mesma atividade (a confirmar na tarefa 7.1).
- *Alternativa descartada*: varrer `calendar.event.get` das agendas filtrando por `UF_CRM_CAL_EVENT`: payload e tempo imprevisíveis, ainda precisa excluir privados.
- *Alternativa descartada*: guardar no nosso banco os agendamentos feitos pelo agente e listar só esses: perderia compromissos criados por pessoas e ficaria defasado se o evento fosse movido ou apagado no Bitrix24.

### D7. Escopo `calendar` e falhas

`BitrixError` com `isScopeMissing` (`insufficient_scope`, mantendo `kind: API_ERROR` para não mudar `getRecord` e o consumer de entrada) vira resposta de ferramenta "calendário não liberado" (resultado `unavailable`, sem repetir a chamada) e fica registrada para o painel. A configuração na tela mostra o alerta "reautorizar o app" quando uma chamada recente teve esse erro (campo `last_scope_error_at` em `agent_calendar_config`). O escopo é incluído no cadastro do app no Bitrix24 e na lista de escopos da instalação, e a documentação (`docs/bitrix-observado.md`, runbook) é atualizada.

### D8. Ferramentas sempre publicadas, com resposta clara quando não configuradas

`TOOLS_VERSION` passa para `'3'` e as três ferramentas são sempre registradas no MCP; sem configuração, respondem "agenda não configurada" e orientam o agente. A descrição das ferramentas diz que só funcionam com agenda configurada.

- *Por quê*: a lista de ferramentas é lida pelo GPTMaker por `sync-tools` e fica em cache; republicar a cada alteração de configuração multiplicaria chamadas ao GPTMaker e abriria janela de inconsistência.
- *Alternativa descartada*: publicar a lista por agente conforme a configuração: exige `sync-tools` a cada salvamento e falha silenciosa se o GPTMaker demorar.

### D9. Confirmação pelo cliente

O servidor não consegue saber se o cliente confirmou. A garantia é de três camadas: a descrição da ferramenta (e a orientação do `crm-guidance`) manda confirmar data e hora antes de chamar; a ferramenta exige referência de cliente válida e horário livre; e o resultado detalha o que foi marcado, para o agente repetir ao cliente. Não há criação sem cliente identificado.

### D10. Tela do agente

Seção "Agenda" ao lado do acesso ao CRM em `/app` (só habilitada com o CRM conectado): modo, seletor de usuários (reaproveita `lib/portal-users.ts`), duração, antecedência e janela, mais o alerta de reautorização. Tipos e validação (zod) em `@gptmaker/contracts`; endpoints em `crm-access`/novo controller de configuração com `@AppAuth()` e filtro por `tenantId` da sessão.

## Risks / Trade-offs

- **Corrida de horário com agendamentos manuais** → o lock e a releitura imediata cobrem o sistema; a janela residual com pessoas no Bitrix24 é aceita e documentada. A resposta de erro oferece alternativas.
- **Token da instalação sem permissão para criar eventos na agenda de outro usuário** → no portal de teste, o token de um administrador (usuário 508) criou e leu a agenda de outro usuário (418); **premissa informada pelo time**: o token guardado da instalação é sempre o de um administrador, então o caso de usuário comum não foi testado nem é esperado. Se um administrador perder o perfil ou o token passar a ser de outro usuário, vale o plano B. Se a criação responder acesso negado: a ferramenta responde que o app não tem permissão nessa agenda, o painel mostra "o usuário que instalou o app precisa ser administrador ou ter acesso às agendas escolhidas", e nada é criado em outra agenda como substituto (nem `company_calendar`, que muda quem enxerga o compromisso). A tarefa 6.1 cobre a recusa com teste.
- **Volume de dados em `agendamentos_do_cliente`** → resolvido ao ler atividades do CRM (uma chamada); permanece o limite de 10 s e a resposta "indisponível" no estouro.
- **Atividade que não representa um evento** (To-do criado à mão) ou evento sem atividade → a tarefa 7.1 confirma o comportamento com evento criado à mão e a spec descreve o limite (o compromisso listado é o que o CRM mostra na linha do tempo do cliente).
- **Fuso e formato de data do Bitrix24** (strings de data dependem do idioma do usuário) → usar sempre timestamps UTC na leitura e enviar `timezone_from`/`timezone_to` explícitos na escrita; testes com fusos diferentes.
- **Tenants existentes sem o escopo** → as ferramentas respondem "não liberado" e o painel avisa; nada quebra para quem não usa agenda. Reinstalar é passo operacional (ver Migration Plan).
- **Primeira escrita das ferramentas do agente** (risco de duplicidade, de dado errado no CRM do cliente) → escopo mínimo (somente evento), cliente obrigatório, idempotência, revalidação, teste de integração e auditoria com `auditor-multitenant`.
- **Agente agenda sem confirmação do cliente** → orientação na descrição e na orientação do CRM; monitorar nas conversas de teste; sem controle técnico possível além disso.

## Migration Plan

1. Migration aditiva `agent_calendar_config` (revisada pelo `guardiao-migracoes`); nenhuma tabela existente é alterada.
2. Deploy no staging (`develop`) com `TOOLS_VERSION = '3'`; o `CrmToolsSync` pede ao GPTMaker que releia as ferramentas dos agentes com CRM ativo.
3. Cadastrar o escopo `calendar` no app (portal de teste primeiro), reinstalar o app de teste, validar os cenários da spec no chat de teste e numa conversa real da Linha Aberta.
4. Produção (`master`): após aprovação, publicar e comunicar aos clientes que usarem agenda o passo de reautorização do app; atualizar `docs/bitrix-observado.md` e o runbook.
5. **Rollback**: remover a configuração dos agentes (as ferramentas passam a responder "não configurada") ou reverter o deploy; a tabela é aditiva e pode permanecer. Eventos já criados no Bitrix24 não são desfeitos pelo sistema.

## Open Questions

- Incluir lembrete (`remind`) padrão no evento criado (ex.: 30 minutos antes)? Não muda specs nem tarefas; decidir após o piloto.
- Cache curto da disponibilidade por (tenant, usuário) para reduzir chamadas ao Bitrix24, caso a medição em produção justifique.
