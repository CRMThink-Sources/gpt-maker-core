# Horário de funcionamento do agente

Cada agente pode ter um horário em que atende. Configure em **Agentes → Configurações → Horário de funcionamento**.

## Como funciona

- **Sem horário** (padrão): o agente responde 24 horas, todos os dias. Agentes existentes não mudam.
- **Com horário**: dias da semana, cada um com zero ou mais intervalos `início–fim`, no **fuso do agente** (padrão `America/Sao_Paulo`). O início é inclusivo e o fim exclusivo; `24:00` vale como fim do dia. Intervalos não podem se sobrepor nem atravessar a meia-noite (use `22:00–24:00` num dia e `00:00–06:00` no seguinte).
- **Fora do horário**: a mensagem não vai ao GPTMaker, não consome créditos e fica registrada como `SKIPPED_OUT_OF_HOURS`. O agente **não a responde depois**.
- **Transferir para um atendente** (`outOfHoursTransfer`, **ligado por padrão**): fora do horário, o diálogo vai para o **operador livre** da Linha Aberta e passa a atendimento humano; o agente deixa de responder nele.
- **Mensagem fora do horário** (opcional, até 1.000 caracteres), independente da transferência.

### As quatro combinações

| Mensagem   | Transferir   | O que o cliente vê                                             |
| ---------- | ------------ | -------------------------------------------------------------- |
| vazia      | sim (padrão) | Transfere sem avisar.                                          |
| preenchida | sim          | O aviso e, em seguida, a transferência.                        |
| preenchida | não          | Só o aviso, no máximo **uma vez a cada 12 horas por diálogo**. |
| vazia      | não          | Silêncio.                                                      |

### Depois da transferência

- O diálogo fica em atendimento humano: as mensagens seguintes não geram novo aviso nem resposta do agente.
- **Não há devolução automática ao agente** no início do expediente. O diálogo só volta ao agente quando o atendente encerra o atendimento.
- Para a conversa ser atendida, o **expediente da Linha Aberta** (fila e operadores) precisa estar configurado no Bitrix24. Sem operador, a conversa fica na fila.
- Se o atendente encerrar e o cliente escrever de novo ainda fora do horário, ele é avisado e transferido outra vez.

### Agentes que já tinham horário

A opção nasceu **ligada para todos**, inclusive para agentes que já tinham horário configurado: eles passam a transferir fora do horário. Quem quiser só o aviso ou o silêncio desliga **Transferir para um atendente**.

## Precedência (ordem do worker)

1. Agente e portal ativos (agente inativo nunca responde, nem avisa).
2. Atendimento humano em curso (nenhum aviso e nenhuma transferência).
3. Horário de funcionamento.
4. Saldo de créditos (fora do horário o saldo nem é consultado).

O chat de teste do agente **não** é limitado pelo horário.

## API

`PATCH /agents/:id` aceita `businessHours` (`{ timezone, days: { mon..sun: [{ start, end }] } }`, ou `null` para remover) `outOfHoursMessage` (texto ou `null`) e `outOfHoursTransfer` (booleano; padrão `true`). Campo ausente não altera.
