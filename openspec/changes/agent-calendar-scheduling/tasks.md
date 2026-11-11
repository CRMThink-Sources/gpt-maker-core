# Tasks

## 1. Investigação no portal de teste

- [x] 1.1 No portal de teste com o escopo `calendar` concedido, rodar `calendar.event.add` (`type: user`, `ownerId` de outro usuário, `auto_detect_section: Y`, `crm_fields`), `calendar.accessibility.get` e `calendar.event.get`, e registrar em `docs/bitrix-observado.md` (seção "Calendário", com data e portal): qual usuário o token da instalação representa, se criar na agenda de terceiros é aceito, o formato de `crm_fields` (`C_`, `L_`, `CO_`), se `UF_CRM_CAL_EVENT` volta em `event.get`, e os campos `DATE_*_TS_UTC`/`ACCESSIBILITY`. Verificar com o documento publicado e com os exemplos de resposta reais colados nele
- [x] 1.2 Decidir, a partir de 1.1, o plano B caso o token não possa criar na agenda de terceiros (calendário da empresa ou exigir administrador) e atualizar `design.md` (Riscos) se algo divergir do previsto. Verificar com a seção "Riscos" revisada ou com a nota "sem divergência" no próprio `design.md`

## 2. Escopo `calendar` e cliente do Bitrix

- [x] 2.1 Incluir `calendar` na lista de escopos exigidos pelo app (documentação em `docs/bitrix-observado.md`, "Escopos da instalação", e no cadastro do app/plataforma) e expor `BitrixError.isScopeMissing` para `insufficient_scope` de `calendar.*` (mantém `kind: API_ERROR` para não mudar `getRecord` e o consumer de entrada); verificar com teste de `bitrix.client` que o erro é classificado e não é repetido
- [x] 2.2 Criar o executor compartilhado `crm-tools/tool-runner.ts` (limite por agente, tempo máximo, métricas, log sem dados, `last_call_at`) extraído de `CrmToolsService.run`, e passar `CrmToolsService` a usá-lo; verificar que `crm-tools.service.test.ts` continua passando sem alteração de comportamento

## 3. Contratos e persistência

- [x] 3.1 Criar em `packages/contracts/src/crm.ts` o `calendarConfigSchema` (modo, usuários conforme o modo, duração 15–240 em múltiplos de 5, antecedência 0–1440, janela 1–30) e os tipos `CalendarConfigView`; verificar com testes de unidade: usuário fixo com 2 usuários, lista com 11, duração 10, valores padrão e remoção (`null`)
- [x] 3.2 Adicionar a tabela `agent_calendar_config` (PK `agent_id`, `tenant_id` com FK e índice, `mode`, `user_ids`, `slot_minutes`, `min_notice_minutes`, `max_days_ahead`, `last_scope_error_at`, timestamps) em `shared/database/schema/` e gerar a migration com `npm run db:generate -w backend`; verificar que aplica em banco limpo e sobre dados existentes e que `git status backend/drizzle` mostra só a migration nova
- [x] 3.3 Auditar a migration e o schema com o agente `guardiao-migracoes` e registrar o veredito; verificar com o relatório sem bloqueantes

## 4. Configuração por agente (API)

- [x] 4.1 Criar `CalendarConfigService` e repository com `tenantId` em toda query: ler, salvar, remover; validar usuários ativos do portal (`UserNamesService`/`user.get`) e exigir `agent_crm_access.status = CONNECTED`; verificar com testes de serviço: salvar, alterar, remover, usuário inexistente/inativo, CRM desativado, agente de outro tenant (404)
- [x] 4.2 Expor os endpoints de leitura, gravação e remoção em controller com `@AppAuth()` e DTO via `createZodDto(calendarConfigSchema)`, e devolver `scopeMissing` quando `last_scope_error_at` for recente; verificar com teste de controller e de integração (`backend/test/integration/`) cobrindo isolamento entre tenants
- [x] 4.3 Preservar a configuração ao desativar o CRM e voltar a usá-la ao reativar; verificar com teste de integração do ciclo desativar/reativar sem perda de dados

## 5. Disponibilidade

- [x] 5.1 Implementar o cálculo de slots como função pura em `crm-tools/calendar-slots.ts` (expediente do agente ou padrão seg–sex 09:00–18:00 `America/Sao_Paulo`, antecedência, grade, ocupação em UTC, só `busy`/`absent` bloqueiam, qualquer usuário livre no modo lista, limite de 10); verificar com testes tabulares (`it.each`): evento ocupado no meio do dia, evento livre, antecedência, virada de dia, fuso `America/Manaus`, horário de verão do fuso, sem expediente no dia e lista com um usuário ocupado
- [x] 5.2 Implementar `CalendarToolsService.freeSlots` (resolução da agenda por modo, `calendar.accessibility.get`, resposta com nome de quem atende e duração, validação de data fora da janela sem chamar o Bitrix24); verificar com testes de serviço com `BitrixClient` simulado: usuário fixo, responsável do cliente (com e sem responsável), lista de usuários, sem configuração, `insufficient_scope`

## 6. Agendamento

- [x] 6.1 Implementar `CalendarToolsService.book` na ordem do design D4: verificar referência do cliente e regras do horário, lock distribuído por (tenant, usuário), releitura da ocupação, escolha do primeiro usuário livre, idempotência em Redis (15 min) e `calendar.event.add` com `crm_fields`; verificar com testes de serviço: sucesso, horário tomado (devolve até 3 alternativas), início fora das regras, referência de outro tenant, repetição da mesma chamada, falha do Bitrix24 ao criar (sem chave de idempotência gravada) e acesso negado na agenda do dono (resposta "sem permissão nessa agenda", sem criar em outra agenda e sem repetir a chamada)
- [x] 6.2 Garantir que a resposta de `book` não traz identificadores internos e que o título e a descrição do evento são curtos e sem dados além do nome do cliente; verificar com teste que inspeciona o corpo da resposta e o payload enviado ao Bitrix24
- [x] 6.3 Escrever um teste de integração com Redis (Testcontainers) que dispara duas chamadas concorrentes para o mesmo horário e verifica que só um `calendar.event.add` é feito; verificar com o teste passando em `npm run test:integration -w backend`

## 7. Agendamentos do cliente

- [x] 7.1 Implementar `CalendarToolsService.clientAppointments` sobre `crm.activity.list` (design D6: dono do cliente, `PROVIDER_ID = CRM_TODO`, `START_TIME` de agora a +60 dias, `RESPONSIBLE_ID` entre os usuários das agendas, ordenação por início, limite de 10, conversão do instante para o fuso da agenda, sem título nem descrição); verificar com testes: com agendamentos, sem agendamentos, responsável fora da configuração, vínculo com contato/lead/empresa, título nunca na resposta, conversão de fuso (`+03:00` para `America/Sao_Paulo`)
- [ ] 7.2 Confirmar no portal de teste, e registrar em `docs/bitrix-observado.md`, que um evento criado à mão na tela do Calendário com vínculo ao CRM gera a mesma atividade `CRM_TODO` e que o `START_TIME` bate com o horário do evento; se não gerar, ajustar o design D6 e a spec antes de seguir. Verificar com o resultado registrado

## 8. Servidor MCP e orientação ao agente

- [x] 8.1 Registrar `horarios_livres`, `agendar_compromisso` e `agendamentos_do_cliente` em `buildMcpServer` (descrições em português, esquemas zod, `agendar_compromisso` instruindo a confirmar data e hora com o cliente antes de chamar) e subir `TOOLS_VERSION` para `'3'`; verificar com `mcp.controller.test.ts` que as três aparecem na listagem e que o `CrmToolsSync` pede nova leitura ao GPTMaker
- [x] 8.2 Incluir os novos nomes em `ToolName`, nas métricas e no log sem dados pessoais, e acrescentar a orientação de agendamento em `crm-guidance.defaults.ts`; verificar com testes que o log não contém nome, título nem horário do evento e que o limite de 60/min soma as ferramentas novas e antigas
- [x] 8.3 Verificar que nenhuma ferramenta de consulta faz chamada de escrita e que `book` só chama `calendar.event.add`; verificar com teste que falha se o cliente simulado do Bitrix24 receber qualquer método de escrita fora desse

## 9. Tela do agente

- [ ] 9.1 Criar `calendar-card.tsx` ao lado do `crm-access-card.tsx` em `frontend/src/app/app/agents/[id]/` (modo, seletor de usuários com `lib/portal-users.ts`, duração, antecedência, janela, remover, desabilitado sem CRM conectado, alerta "reautorizar o app" quando `scopeMissing`) e o cliente de API em `frontend/src/lib/`; verificar com testes de componente: escolher modo, validar limites, remover, estado sem CRM, alerta de escopo
- [ ] 9.2 Revisar a tela e os testes com o agente `revisor-frontend`, conferindo a doc do Next em `node_modules/next/dist/docs/`; verificar com o relatório sem bloqueantes

## 10. Verificação integrada e operação

- [ ] 10.1 Validar no chat de teste do app e numa conversa real da Linha Aberta (portal de teste): consultar horários, agendar, repetir a chamada, consultar os agendamentos, sem escopo e com agenda removida; verificar com os cenários da spec `agent-calendar-scheduling` conferidos um a um e os resultados anotados em `docs/bitrix-observado.md`
- [ ] 10.2 Auditar o diff com `revisor-codigo`, `auditor-multitenant` e `guardiao-migracoes`, e `npm run build -w @gptmaker/contracts`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run depcruise`, `npm test` e `npm run test:integration -w backend`; verificar com os relatórios e comandos sem erro novo
- [ ] 10.3 Documentar a reautorização do escopo `calendar` e o rollback (remover a configuração) em `docs/runbook.md` e a nova capacidade no `README`/docs conforme o padrão do projeto; verificar com o passo a passo executado no portal de teste
