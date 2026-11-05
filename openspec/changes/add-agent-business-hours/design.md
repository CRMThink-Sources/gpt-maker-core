# Design

## Context

O worker de `channel.inbound` passa cada mensagem pelo `InboundGate` (`backend/src/modules/channel/inbound-gate.ts`), que decide `forward`, `skip-inactive`, `skip-human` ou `no-credit`; o `InboundConsumer` aplica a decisão e grava o `message_log`. O agente vive na tabela `agent` (`shared/database/schema/agents.ts`) e é editado por `PATCH /agents/:id` (`updateAgentSchema` em `packages/contracts/src/agents.ts`). O gate já lê a linha do agente a cada mensagem, então uma configuração nova nela vale na hora, sem cache. O GPTMaker tem `settings.timezone`, mas não tem horário de funcionamento; a regra é do nosso lado. Requisitos em `specs/agent-business-hours/spec.md`.

## Goals / Non-Goals

**Goals:**

- Avaliar o horário no gate, antes de qualquer chamada ao GPTMaker ou consulta de saldo.
- Função pura de avaliação, testável sem banco, com o fuso do agente.
- Manter agentes sem horário exatamente como hoje.

**Non-Goals:**

- Feriados, exceções por data e horários diferentes por canal ou linha aberta.
- Agendar ativação/desativação do agente (o `status` não muda; o horário só filtra mensagens).
- Fora do horário, transferir o diálogo para operador ou rotear para outro agente.
- Mudar o chat de teste ou o `settings.timezone` enviado ao GPTMaker.

## Decisions

**D1. Horário em colunas no `agent`, não em tabela própria.** Duas colunas: `business_hours jsonb null` (`{ timezone, days: { mon: [{start,end}], ... } }`) e `out_of_hours_message text null`. `null` em `business_hours` = 24h. A configuração é 1:1 com o agente, sempre lida junto com ele e pequena. Alternativa: tabela `agent_business_hours` por intervalo; rejeitada por exigir join no caminho quente do gate e não trazer consulta que o jsonb não atenda. O fuso fica dentro do jsonb para que o horário seja um valor só, validado junto. Alternativa: reaproveitar `settings.timezone`; rejeitada porque é o fuso que o GPTMaker usa nas respostas do agente e mudá-lo alteraria o comportamento da IA.

**D2. Tipos e validação em `packages/contracts`.** Um schema zod `businessHoursSchema` (dias `mon..sun`, intervalos `HH:mm`, `24:00` só como fim, início < fim, sem sobreposição, fuso validado por `Intl.DateTimeFormat`) usado pelo `updateAgentSchema` e pelo front. `AgentView` expõe `businessHours` e `outOfHoursMessage`. `PATCH` aceita `businessHours: null` para remover. Alternativa: validar só no backend; rejeitada para o front dar o mesmo erro sem ida ao servidor.

**D3. Avaliação pura em módulo próprio.** `isWithinBusinessHours(hours, now)` em `modules/agents` (ou `channel`) converte `now` para dia da semana e minutos no fuso via `Intl.DateTimeFormat` (mesma técnica de `grace-period.ts`), sem lib nova. Intervalo `[início, fim)`. Recebe `now` por parâmetro para testes determinísticos (virada de dia, fuso Manaus, `24:00`). Intervalos que atravessam a meia-noite (22:00–06:00) não são aceitos; o cliente cadastra `22:00–24:00` no dia e `00:00–06:00` no seguinte. Alternativa: aceitar `fim < início`; rejeitada por ambiguidade sobre a qual dia pertence e por complicar a validação.

**D4. Nova decisão do gate `skip-out-of-hours`, entre "atendimento humano" e "saldo".** Ordem: agente/portal ativos → atendimento humano → horário → saldo. A decisão carrega `message` (texto ou `null`) e `installationId`. O `check` já seleciona a linha do agente; basta incluir as duas colunas. Status novo `SKIPPED_OUT_OF_HOURS` no enum `message_status` (migração `ALTER TYPE ... ADD VALUE`), usado pelo `SKIP_STATUS` do consumer. Colocar o horário antes do saldo evita consultar saldo e mandar "sem crédito" a quem escreve fora do expediente (spec: "Sem saldo fora do horário").

**D5. Aviso fora do horário: handler dedicado, deduplicado em Redis.** `OutOfHoursHandler` (análogo ao `NoCreditHandler`): se há texto e a chave `out-of-hours:{tenantId}:{dialogId}` não existe, faz `SET NX EX 43200` e publica o texto pelo `ReplyPublisher`/envio direto ao diálogo, sem passar pelo `ConversationService` (sem GPTMaker, sem débito). Sem texto, só registra. A chave é gravada antes do envio e removida se o envio falhar de forma que será retentada, para não perder o aviso nem duplicá-lo. Alternativa: dedupe consultando `message_log`; rejeitada por custo de query por mensagem e porque o log guarda só entradas `IN`.

**D6. Tela.** Seção "Horário de funcionamento" no `agent-form.tsx`: alternância "24 horas / Definir horário", seletor de fuso, linhas por dia da semana com intervalos adicionáveis, campo de mensagem fora do horário e selo "Dentro/Fora do horário agora" calculado com a mesma função pura (exportada pelo `contracts`, que é compartilhado). Para isso a função de D3 vive em `packages/contracts`, não no backend.

## Risks / Trade-offs

- [Cliente configura horário e esquece o fuso, atendendo no horário errado] → Fuso padrão `America/Sao_Paulo`, selo "agora" na tela mostra o estado real, textos de ajuda indicam o fuso em uso.
- [Mensagem retentada após o fim do horário muda de decisão] → A avaliação usa o instante do processamento (spec); mensagem retentada na virada pode ser tratada como fora do horário. Aceito: janela de segundos a minutos.
- [Aviso perdido ou duplicado por falha entre o `SET NX` e o envio] → Chave removida em falha retentável; pior caso é um aviso a mais ou a menos, sem impacto em cobrança.
- [`ALTER TYPE ADD VALUE` não roda dentro de transação em alguns fluxos] → Migração em arquivo próprio, como as anteriores que estendem enums.
- [Cliente espera que mensagens fora do horário sejam respondidas depois] → Fora de escopo; mensagens ficam sem resposta da IA e o aviso orienta o cliente final. Documentar na tela.

## Migration Plan

1. Migração Drizzle: duas colunas nulas em `agent` e o valor novo do enum `message_status`; sem backfill (nulo = 24h).
2. Deploy do backend (aceita e ignora a configuração até o front existir; sem mudança de comportamento com `business_hours` nulo).
3. Deploy do front com a seção nova.
Rollback: reverter o deploy; as colunas nulas e o valor do enum ficam inofensivos. Para desligar o filtro em emergência, basta zerar `business_hours` dos agentes afetados.
