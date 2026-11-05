# Proposal

## Why

Hoje o agente responde 24h por dia enquanto estiver `ACTIVE`. Muitos clientes só querem a IA
atendendo em certos dias e horários (por exemplo, fora do expediente da equipe, ou só no
comercial) e, no restante do tempo, preferem avisar o cliente final ou deixar a fila para os
operadores. Sem isso, o cliente precisa ativar e desativar o agente na mão.

## What Changes

- Cada agente passa a ter um **horário de funcionamento** configurável: dias da semana, com um
  ou mais intervalos de horário por dia, em um fuso horário próprio (padrão `America/Sao_Paulo`).
- O horário é **opcional**: agente sem horário configurado continua respondendo 24h (sem mudança
  para os agentes existentes).
- Fora do horário, o `InboundGate` não encaminha a mensagem ao GPTMaker (sem débito de crédito)
  e registra a mensagem como `SKIPPED_OUT_OF_HOURS` no `message_log`.
- Fora do horário o cliente pode, opcionalmente, receber uma **mensagem automática** configurada
  por ele (ex.: "Nosso atendimento funciona de seg a sex, 9h às 18h"). Sem mensagem configurada,
  o agente fica em silêncio.
- Atendimento humano em curso continua com precedência (o agente já não responde nesse caso).
- Tela do agente ganha uma seção "Horário de funcionamento" para editar dias, intervalos, fuso e
  mensagem fora do horário.
- Novo valor no enum `message_status` e novos campos no agente (migração Drizzle).

## Capabilities

### New Capabilities

- `agent-business-hours`: configuração do horário de funcionamento do agente (dias, intervalos,
  fuso, mensagem fora do horário) e o comportamento do agente dentro e fora dele.

### Modified Capabilities

<!-- Nenhuma: as specs existentes em openspec/specs não cobrem o ciclo de mensagens do agente. -->

## Impact

- Backend: `shared/database/schema/agents.ts` (colunas do horário, novo `message_status`),
  migração em `backend/drizzle`, `modules/agents` (validação e persistência via `PATCH
  /agents/:id`), `modules/channel` (`inbound-gate.ts`, `inbound.consumer.ts`, envio da mensagem
  fora do horário via `ReplyPublisher`).
- Contratos: `packages/contracts` (`updateAgentSchema`, `AgentView`).
- Frontend: tela de edição do agente.
- Sem impacto na integração com o GPTMaker nem na cobrança; mensagens fora do horário não geram
  débito.
