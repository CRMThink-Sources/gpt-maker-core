# Horário de funcionamento do agente

Cada agente pode ter um horário em que atende. Configure em **Agentes → Configurações → Horário de funcionamento**.

## Como funciona

- **Sem horário** (padrão): o agente responde 24 horas, todos os dias. Agentes existentes não mudam.
- **Com horário**: dias da semana, cada um com zero ou mais intervalos `início–fim`, no **fuso do agente** (padrão `America/Sao_Paulo`). O início é inclusivo e o fim exclusivo; `24:00` vale como fim do dia. Intervalos não podem se sobrepor nem atravessar a meia-noite (use `22:00–24:00` num dia e `00:00–06:00` no seguinte).
- **Fora do horário**: a mensagem não vai ao GPTMaker, não consome créditos e fica registrada como `SKIPPED_OUT_OF_HOURS`. Ela **não é respondida depois**.
- **Mensagem fora do horário** (opcional, até 1.000 caracteres): enviada ao cliente no máximo **uma vez a cada 12 horas por diálogo**. Em branco, o agente fica em silêncio.

## Precedência (ordem do worker)

1. Agente e portal ativos (agente inativo nunca responde, nem avisa).
2. Atendimento humano em curso (nenhum aviso é enviado).
3. Horário de funcionamento.
4. Saldo de créditos (fora do horário o saldo nem é consultado).

O chat de teste do agente **não** é limitado pelo horário.

## API

`PATCH /agents/:id` aceita `businessHours` (`{ timezone, days: { mon..sun: [{ start, end }] } }`, ou `null` para remover) e `outOfHoursMessage` (texto ou `null`). Campo ausente não altera.
