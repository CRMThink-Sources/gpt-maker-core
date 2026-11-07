# Proposal

## Why

Hoje, fora do horário de funcionamento, o agente fica em silêncio ou só manda um aviso: a mensagem do cliente não é respondida e fica sem dono. O cliente quer que, fora do horário, a conversa vá para um atendente humano, esperando na fila da Linha Aberta até alguém pegar no expediente.

## What Changes

- Cada agente ganha a opção **transferir para atendente fora do horário** (`outOfHoursTransfer`), **ligada por padrão**.
- Fora do horário, com a opção ligada, o diálogo é transferido para o **operador livre** da Linha Aberta e passa a ser atendimento humano: a IA para de responder naquele diálogo.
- O aviso fora do horário continua opcional e independente da transferência, o que cobre as quatro combinações: transferir sem avisar (padrão), avisar e transferir, só avisar, ou nenhum dos dois (silêncio, como hoje).
- Quando há aviso e transferência, o aviso sai primeiro e a transferência depois.
- **Não há devolução automática à IA** no início do expediente: o diálogo só volta para a IA quando o atendente encerra o atendimento (comportamento atual de encerramento).
- **BREAKING (comportamento):** a coluna nova tem padrão `true` e não há backfill. Agentes que já têm horário configurado passam a transferir fora do horário; quem quiser só o aviso ou silêncio desliga a opção.
- A tela do agente ganha a opção "Transferir para um atendente" na seção de horário e um texto de ajuda lembrando que o expediente da Linha Aberta no Bitrix24 precisa estar configurado.

## Capabilities

### New Capabilities

<!-- Nenhuma. -->

### Modified Capabilities

- `agent-business-hours`: a mensagem automática fora do horário deixa de ser o único comportamento; entra a transferência para o operador livre, configurável por agente e ligada por padrão.

## Impact

- Backend: `shared/database/schema/agents.ts` (coluna `out_of_hours_transfer boolean not null default true`), migração em `backend/drizzle`, `modules/agents` (`PATCH /agents/:id`), `modules/channel` (`inbound-gate.ts`, `inbound.consumer.ts`, `out-of-hours.handler.ts`, uso do `HumanHandoff.start()`).
- Contratos: `packages/contracts` (`updateAgentSchema`, `AgentView`).
- Frontend: `business-hours-fields.tsx` e `agent-form.tsx`.
- Docs: `docs/agent-business-hours.md`.
- Deploy: backend e front devem ir juntos, ou o front logo depois; na janela entre os dois o comportamento já muda e o cliente ainda não consegue desligar a opção.
- Sem impacto na cobrança: mensagens fora do horário continuam sem débito.
