# Design

## Context

Fora do horário, o `InboundGate` devolve `skip-out-of-hours` com o aviso opcional (`notice`) e o `InboundConsumer` chama o `OutOfHoursHandler`, que grava `SKIPPED_OUT_OF_HOURS` e envia o aviso uma vez a cada 12 h por diálogo (trava `SET NX` no Redis). O `HumanHandoff.start()` (`modules/channel/human-handoff.ts`) já faz a transferência completa: marca o diálogo como `human_active` (a partir daí o gate devolve `skip-human`), chama `imopenlines.bot.session.operator` para o operador livre e avisa o GPTMaker (`start-human` e `stop-human`). O `HumanHandoff.stop()` devolve o diálogo à IA quando o atendente encerra. O `NoCreditHandler` é o modelo de aviso mais transferência com retentativa segura (marca no Redis com os passos `notified` e `transferred`). Requisitos em `specs/agent-business-hours/spec.md`.

## Goals / Non-Goals

**Goals:**

- Fora do horário, transferir o diálogo para o operador livre, configurável por agente e ligado por padrão.
- Manter aviso e transferência independentes (as quatro combinações).
- Reaproveitar o `HumanHandoff.start()` sem duplicar a lógica de transferência.

**Non-Goals:**

- Escolher linha ou usuário de destino (sempre operador livre).
- Devolver o diálogo à IA no início do expediente.
- Transferir para outro agente de IA.
- Configurar o expediente da Linha Aberta no Bitrix24 (é do cliente, no Bitrix24).

## Decisions

**D1. Coluna booleana própria, padrão `true`, sem backfill.** `out_of_hours_transfer boolean not null default true` em `agent`. Aviso e transferência são duas escolhas independentes: o texto já existe (`out_of_hours_message`) e a coluna nova cobre o resto, sem enum de quatro modos. Agentes existentes recebem `true` pelo padrão da coluna, o que muda o comportamento de quem já configurou horário (decisão do produto, aceita). Alternativa: enum `NOTICE | TRANSFER | BOTH | SILENT`; rejeitada por duplicar a informação que o texto vazio ou preenchido já dá. Alternativa: backfill `false` nos agentes com horário; rejeitada pelo produto.

**D2. A transferência só vale com horário configurado.** O gate só chega a `skip-out-of-hours` quando `business_hours` não é nulo e o instante está fora dele. Agente sem horário atende 24h e a coluna não tem efeito; a tela esconde a opção ou a mostra desativada nesse caso.

**D3. O gate carrega `transfer`.** `skip-out-of-hours` passa a trazer `transfer: boolean` junto de `notice` e `installationId`. A ordem das checagens não muda (agente/portal → atendimento humano → horário → saldo). Fora do horário o saldo continua sem ser consultado, então nenhum aviso de "sem crédito" sai fora do expediente.

**D4. O handler faz aviso e depois transferência, com marca por passo.** Com `transfer` ligado, o `OutOfHoursHandler` segue o modelo do `NoCreditHandler`: grava `SKIPPED_OUT_OF_HOURS`; se há texto e a marca não está em `notified` nem `transferred`, envia o aviso e grava `notified`; depois chama `HumanHandoff.start({ tenantId, agentId, dialogId })` (sem `userId` nem `lineId`, ou seja, operador livre) e grava `transferred`. A retentativa depois de falha no meio não repete o aviso, e o `start()` é idempotente. Com `transfer` desligado, o handler fica como hoje: aviso com `SET NX` de 12 h, ou silêncio. A marca de transferência usa a mesma janela, mas o que impede avisos repetidos depois da transferência é o diálogo ficar `human_active`: as mensagens seguintes caem em `skip-human`, antes do horário.

**D5. Recusas definitivas não bloqueiam; falhas transitórias sobem.** O `HumanHandoff.start()` já trata recusa definitiva do Bitrix24 ou do GPTMaker só no log e deixa subir falha transitória (mensagem retentada). Isso vale aqui sem mudança. Ponto a confirmar na implementação: o diálogo fora do horário nunca chegou ao GPTMaker, então o chat não existe lá e `start-human`/`stop-human` podem ser recusados como "chat inexistente". Esperado: tolerado como recusa definitiva. Se não for, o `start()` ganha um modo que pula os passos do GPTMaker quando o chat não existe.

**D6. Sem retorno automático à IA.** Nada novo: o `stop()` já devolve o diálogo quando o atendente encerra. Não se cria job no início do expediente. Risco aceito: diálogo transferido que ninguém pegar fica em atendimento humano até alguém encerrar.

**D7. Tela.** Na seção "Horário de funcionamento" do `business-hours-fields.tsx`, uma opção "Transferir para um atendente" (ligada por padrão) e o campo de aviso já existente, que passa a ser descrito como opcional. Texto de ajuda: o expediente da Linha Aberta no Bitrix24 precisa estar configurado para a conversa ser atendida. O contrato recebe `outOfHoursTransfer` em `updateAgentSchema` (booleano, ausente não altera) e em `AgentView`.

## Risks / Trade-offs

- [Mudança de comportamento para agentes que já têm horário] → Padrão `true` sem backfill, por decisão do produto; comunicar na entrega e deixar a opção visível na tela para desligar.
- [Janela entre deploy do backend e do front sem como desligar] → Subir backend e front juntos, ou o front logo depois.
- [Diálogo transferido sem ninguém para atender] → Ajuda na tela sobre o expediente da Linha Aberta; sem retorno automático à IA (decisão).
- [Aviso perdido ou duplicado entre o envio e a transferência] → Marca por passo (`notified`, `transferred`) e `start()` idempotente; pior caso é um aviso a mais.
- [`start-human` recusado pelo GPTMaker por chat inexistente] → Tratado como recusa definitiva (D5); verificar com teste de integração do handler.

## Migration Plan

1. Migração Drizzle: `ALTER TABLE agent ADD COLUMN out_of_hours_transfer boolean NOT NULL DEFAULT true`. Sem backfill.
2. Deploy do backend e do front juntos.
Rollback: reverter o deploy volta ao comportamento anterior (aviso ou silêncio); a coluna fica inofensiva. Para desligar a transferência de um agente em emergência, basta pôr `out_of_hours_transfer = false`. Diálogos já transferidos continuam em atendimento humano até o atendente encerrar.
