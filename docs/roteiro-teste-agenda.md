# Roteiro de teste: agenda do agente no Calendário do Bitrix24

Roteiro da tarefa 10.1 da change `agent-calendar-scheduling` (spec `agent-calendar-scheduling`). Serve para
validar, num portal de teste, que o agente consulta horários livres, marca compromissos e informa o que o
cliente já tem marcado, usando o horário real dos eventos.

## 1. Antes de começar

| Item            | O que conferir                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Código no ar    | A API e o worker rodam este código (branch `feat/agente-calendario-bitrix` ou `develop` com o PR da agenda) e o GPTMaker alcança o `/mcp` da API (`API_PUBLIC_URL` público). A migration `0025` roda no start da API. |
| Recurso ligado  | `CRM_TOOLS_ENABLED=true` no ambiente.                                                                                                                                                                                 |
| Escopo do app   | O app tem o escopo **Calendário** (`calendar`) no cadastro e foi reinstalado/reautorizado no portal de teste. Sem ele, o card avisa "reautorizar o aplicativo".                                                       |
| Portal de teste | Usuário para a agenda (ex.: 508), um segundo usuário (ex.: 418) e um **contato de teste** com nome fácil de reconhecer.                                                                                               |
| Agente          | Um agente do tenant de teste, **sincronizado** com o GPTMaker (não "fora de sincronia").                                                                                                                              |
| Função          | O agente usa a função "Agendamento no Calendário" (JSON gerado ao lado deste roteiro). Alternativa rápida: a instrução nas "Instruções adicionais".                                                                   |

## 2. Preparar o agente

1. Abra o agente e ligue o **Acesso ao CRM**. Espere o estado "Conectado" (até 30 s).
2. No card **Agenda**, escolha **Usuário fixo**, selecione o usuário 508 e salve. Deixe os padrões (30 minutos,
   60 minutos de antecedência, 7 dias).
3. Se o agente tem **horário de funcionamento**, ele define o expediente da agenda. Sem ele, valem segunda a
   sexta, 09:00 às 18:00 (Brasília). Anote qual vale no teste.
4. No Calendário do Bitrix24, deixe na agenda do usuário 508 **dois eventos ocupados** nos próximos dias úteis,
   dentro do expediente (por exemplo, amanhã 10:00-11:00 e 14:00-14:30), e **um evento marcado como "livre"**
   no meio da tarde.

## 3. Cenários

Use o **chat de teste do agente** (na tela do agente), escolhendo o contato de teste como **cliente simulado**.
Em cada cenário, anote o que o agente respondeu e o que aparece no Bitrix24.

> Não use o "Testar → Sandbox" da função no backoffice: ele não tem CRM, então "Consultar cliente no CRM" e as
> ferramentas de agenda não existem lá. O chat de teste do agente, com cliente simulado, tem.

| #   | Você diz ao agente                                                                            | Resultado esperado no chat                                                                                                                                                                                                                                                                                      | Conferir no Bitrix24                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Quero marcar um horário."                                                                    | Oferece **até 3 horários livres, por extenso** (ex.: "quinta-feira, 12 de novembro, às 9h30"), com quem será. **Nunca** mostra `2026-11-12`, `09:30` nem códigos. Não oferece 10:00-11:00 nem 14:00-14:30 (ocupados), nem fora do expediente, nem dentro da antecedência mínima. O evento "livre" não bloqueia. | Os horários oferecidos estão livres na agenda do 508, **no horário de Brasília**.                                                                                                                             |
| 2   | Escolhe um dos horários e **confirma** data e hora.                                           | Confirma o compromisso com a data e a hora por extenso e com quem será.                                                                                                                                                                                                                                         | **Um** evento novo na agenda do 508, no horário certo (confira a hora, não só o dia), título `Agendamento: <nome do contato>`, vinculado ao contato (campo CRM) e uma atividade na linha do tempo do contato. |
| 3   | Repete "confirmo" / pede de novo o mesmo horário.                                             | Confirma o que já foi marcado, sem criar outro.                                                                                                                                                                                                                                                                 | Continua **um** só evento.                                                                                                                                                                                    |
| 4   | Peça um horário **que acabou de ser ocupado** (o do cenário 2).                               | Diz que não está mais disponível e oferece alternativas próximas.                                                                                                                                                                                                                                               | Nenhum evento novo.                                                                                                                                                                                           |
| 5   | Peça um horário fora do expediente (ex.: 20:00 ou sábado).                                    | Não marca; oferece horários válidos ou explica.                                                                                                                                                                                                                                                                 | Nenhum evento novo.                                                                                                                                                                                           |
| 6   | "O que eu já tenho marcado?"                                                                  | Lista data, hora e com quem (sem título nem detalhes). Inclui o do cenário 2 e os eventos criados à mão com vínculo ao contato.                                                                                                                                                                                 | Confere com a linha do tempo do contato.                                                                                                                                                                      |
| 7   | Edite o evento do cenário 2 no Bitrix24 (outro horário) e pergunte de novo o que tem marcado. | Mostra o horário novo.                                                                                                                                                                                                                                                                                          | A atividade do contato acompanha.                                                                                                                                                                             |
| 8   | Crie um evento **privado** vinculado ao contato e pergunte o que tem marcado.                 | Aparece só data, hora e com quem; **nunca o título**.                                                                                                                                                                                                                                                           | -                                                                                                                                                                                                             |
| 9   | Peça para **remarcar** ou **cancelar**.                                                       | Não tenta fazer; segue o formulário da função (transfere ou orienta a equipe).                                                                                                                                                                                                                                  | Nenhum evento mudou.                                                                                                                                                                                          |

## 4. Variações de agenda (card Agenda)

| Variação               | Como configurar                                                                              | Esperado                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Responsável do cliente | Modo "Responsável do cliente no CRM"; o contato de teste tem como responsável o usuário 418. | Os horários e o compromisso são da agenda do **418**. Se o contato não tiver responsável: "não há agenda para este cliente", sem marcar.      |
| Lista de usuários      | Modo "Lista de usuários" com 508 e 418 (nessa ordem). Deixe o 508 ocupado num horário.       | Esse horário aparece livre (por causa do 418) e o compromisso vai para o **418**. Com os dois livres, vai para o **508** (primeiro da lista). |
| Agenda removida        | Remover a agenda no card.                                                                    | O agente avisa que a equipe retorna o contato, sem erro.                                                                                      |
| CRM desligado          | Desligar o Acesso ao CRM.                                                                    | O card avisa; o agente deixa de ter as ferramentas. A configuração da agenda fica guardada.                                                   |
| Sem o escopo           | (só se der para simular) app sem o escopo Calendário.                                        | O agente diz que o calendário não está liberado; o card mostra "reautorizar o aplicativo".                                                    |

## 5. Conversa real (Linha Aberta)

1. Ative o agente num canal aberto (WhatsApp de teste) e inicie a conversa com um número cadastrado como o
   contato de teste.
2. Repita os cenários 1, 2 e 6.
3. Confira que o cliente é identificado **pelo vínculo da conversa** (não pelo telefone digitado) e que o
   evento fica vinculado ao contato certo.

## 6. O que eu confiro no portal (com o token)

Depois de cada cenário, posso conferir pela API, sem escrever nada: o instante real de cada evento criado
(o `DATE_FROM_TS_UTC` do Bitrix24 **não é UTC**; ver `docs/bitrix-observado.md`), o vínculo com o contato, a
atividade `CRM_TODO` gerada e se há eventos duplicados. Para isso, passe o token no mesmo arquivo do
scratchpad e o id do contato.

## 7. Onde olhar se algo falhar

- **Card Agenda com aviso de escopo:** reautorizar o aplicativo com a permissão de Calendário.
- **Agente não usa as ferramentas:** conferir o Acesso ao CRM "Conectado" e se a função está publicada no
  agente; no GPTMaker, as ferramentas do MCP precisam estar **ativas** (o worker as ativa ao subir).
- **Logs da API** (`ferramenta do CRM`): trazem só ferramenta, resultado, quantidade e duração, nunca nome,
  horário ou assunto. Resultado `unavailable` indica Bitrix24 fora do ar, sem escopo ou sem permissão.

## 8. Registro dos resultados

Preencha e me envie (ou cole nas anotações do portal):

| Cenário                         | Passou? | Observação (o que o agente disse, o que apareceu no Bitrix24) |
| ------------------------------- | ------- | ------------------------------------------------------------- |
| 1 a 9                           |         |                                                               |
| Responsável do cliente          |         |                                                               |
| Lista de usuários               |         |                                                               |
| Agenda removida / CRM desligado |         |                                                               |
| Conversa real                   |         |                                                               |
