# Tasks

## 1. Contrato e avaliação do horário

- [x] 1.1 Criar `businessHoursSchema` em `packages/contracts/src/agents.ts` (dias, intervalos `HH:mm`, `24:00` só como fim, início < fim, sem sobreposição, fuso IANA válido) e verificar com testes de unidade cobrindo intervalo invertido, sobreposição, fuso inválido e `24:00`
- [x] 1.2 Implementar `isWithinBusinessHours(hours, now)` em `packages/contracts` (intervalo `[início, fim)`, fuso do agente via `Intl.DateTimeFormat`, `null` = 24h) e verificar com testes dos limites 09:00/18:00, fuso `America/Manaus`, virada de dia e dia sem intervalo
- [x] 1.3 Incluir `businessHours` (nulável) e `outOfHoursMessage` (nulável, até 1.000 caracteres) em `updateAgentSchema` e `AgentView`, e verificar com teste de schema que `null` remove e que campo ausente não altera

## 2. Persistência e API

- [x] 2.1 Adicionar `business_hours jsonb` e `out_of_hours_message text` ao `agent` e o valor `SKIPPED_OUT_OF_HOURS` ao enum `message_status` em `shared/database/schema/agents.ts`; gerar a migração em `backend/drizzle` (enum em arquivo próprio) e verificar que aplica em banco limpo e sobre dados existentes, com agentes antigos ficando com `null`
- [x] 2.2 Persistir e devolver os dois campos em `agent.service.ts`/`agent.repository.ts` pelo `PATCH /agents/:id`, e verificar com teste de serviço: salvar, alterar, remover (`null`) e recusa de payload inválido sem alterar o salvo

## 3. Gate e aviso fora do horário

- [x] 3.1 Selecionar as duas colunas no `InboundGate.check` e retornar `skip-out-of-hours` após a checagem de atendimento humano e antes do saldo; verificar com testes do gate: dentro do horário encaminha, fora não consulta saldo, agente inativo prevalece, operador ativo prevalece, sem horário = 24h
- [x] 3.2 Criar `OutOfHoursHandler` que envia o texto ao diálogo sem GPTMaker e sem débito, deduplicado por diálogo em Redis (12 h), sem texto = silêncio, sem aviso com operador atendendo; verificar com testes: primeiro aviso enviado, segundo e terceiro suprimidos, falha de envio libera a chave
- [x] 3.3 Tratar `skip-out-of-hours` no `InboundConsumer` (log `SKIPPED_OUT_OF_HOURS` com `onConflictDoNothing` e chamada ao handler) e registrar o módulo no `channel.module.ts`; verificar com teste do consumer que mensagem fora do horário não chama o `ConversationService` e fica no `message_log` com o status novo
- [x] 3.4 Confirmar que o chat de teste (`modules/agent-test`) não usa o gate e segue respondendo fora do horário; verificar com teste do serviço de teste com agente fora do horário

## 4. Tela do agente

- [x] 4.1 Criar o componente "Horário de funcionamento" (alternância 24 h/definir, fuso, intervalos por dia com adicionar/remover, mensagem fora do horário, validação com `businessHoursSchema`) e integrá-lo ao `agent-form.tsx`; verificar com teste de componente: adicionar intervalo, erro de sobreposição, remover horário volta a "24 horas"
- [x] 4.2 Mostrar o selo "Dentro/Fora do horário agora" no fuso do agente usando `isWithinBusinessHours`; verificar com teste de componente com relógio fixo em dia útil e em sábado

## 5. Documentação e integração

- [x] 5.1 Documentar o recurso (comportamento fora do horário, aviso único a cada 12 h, mensagens não respondidas depois, fuso) em `docs/agent-business-hours.md` e verificar que o texto bate com a spec
- [x] 5.2 Rodar `npm run lint`, `npm run typecheck` e a suíte de testes do backend, contratos e frontend, e verificar que passam; testar manualmente em staging um agente com horário fora do expediente: sem resposta do GPTMaker, sem débito, aviso uma vez
