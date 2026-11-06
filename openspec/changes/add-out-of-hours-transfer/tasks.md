# Tasks

## 1. Contrato

- [x] 1.1 Incluir `outOfHoursTransfer` (booleano) em `updateAgentSchema` (ausente não altera) e em `AgentView` em `packages/contracts/src/agents.ts`; verificar com teste de schema: `true`/`false` aceitos, ausente não altera, valor não booleano recusado

## 2. Persistência e API

- [x] 2.1 Adicionar `out_of_hours_transfer boolean not null default true` ao `agent` em `shared/database/schema/agents.ts` e gerar a migração em `backend/drizzle`; verificar que aplica em banco limpo e sobre dados existentes, com agentes antigos ficando em `true`
- [x] 2.2 Persistir e devolver o campo em `agent.service.ts` pelo `PATCH /agents/:id`; verificar com teste de serviço: ligar, desligar, ausente não altera e payload inválido recusado sem alterar o salvo

## 3. Gate e handler

- [x] 3.1 Selecionar `outOfHoursTransfer` no `InboundGate.check` e incluir `transfer` na decisão `skip-out-of-hours`; verificar com testes do gate: fora do horário devolve `transfer` conforme a coluna, ordem das checagens inalterada, sem horário atende 24h
- [x] 3.2 No `OutOfHoursHandler`, com `transfer` ligado: gravar `SKIPPED_OUT_OF_HOURS`, enviar o aviso (se houver texto) e chamar `HumanHandoff.start` sem `userId` nem `lineId`, com marca por passo (`notified`, `transferred`) no Redis; com `transfer` desligado manter o comportamento atual; verificar com testes: transferir sem avisar, avisar e transferir, só avisar, silêncio, retentativa depois de falha na transferência sem repetir o aviso, recusa definitiva sem bloquear
- [x] 3.3 Passar `transfer` do `InboundConsumer` ao handler e registrar a dependência do `HumanHandoff` no `channel.module.ts`; verificar com teste do consumer que mensagem fora do horário não chama o `ConversationService`, fica no `message_log` com o status novo e dispara a transferência quando ligada
- [x] 3.4 Verificar contra o GPTMaker (ou o dublê de integração) que `start-human`/`stop-human` num chat que nunca existiu é tratado como recusa definitiva e não impede a transferência; se não for, adaptar o `HumanHandoff.start` para pular os passos do GPTMaker nesse caso
- [x] 3.5 Verificar com teste de integração que, depois da transferência, a próxima mensagem do diálogo cai em `skip-human` (sem aviso e sem IA) e que, depois do `HumanHandoff.stop`, a IA volta a responder

## 4. Tela do agente

- [x] 4.1 Adicionar a opção "Transferir para um atendente" (ligada por padrão) e o texto de ajuda sobre o expediente da Linha Aberta no Bitrix24 em `business-hours-fields.tsx`, integrando o campo ao `agent-form.tsx` e a `[id]/page.tsx`; verificar com teste de componente: padrão ligado, desligar e salvar envia `false`, aviso continua opcional, sem horário a opção não tem efeito

## 5. Documentação e integração

- [x] 5.1 Atualizar `docs/agent-business-hours.md` (as quatro combinações, padrão transferir, sem retorno automático à IA, expediente da Linha Aberta, mudança para agentes existentes) e verificar que o texto bate com a spec
- [ ] 5.2 Rodar `npm run lint`, `npm run typecheck` e a suíte de testes do backend, contratos e frontend, e verificar que passam; testar manualmente em staging com um agente fora do expediente: transferência ao operador livre, aviso antes dela quando configurado, IA sem responder depois, volta à IA ao encerrar o atendimento
