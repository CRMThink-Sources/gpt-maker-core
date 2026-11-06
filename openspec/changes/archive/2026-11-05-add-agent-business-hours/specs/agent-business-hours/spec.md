# Spec Delta

## Purpose

Permite que o cliente configure em quais dias e horários cada agente atende, define o que o agente faz fora desse período e preserva o atendimento 24h para agentes sem horário configurado.

## ADDED Requirements

### Requirement: Configurar o horário de funcionamento
O sistema MUST permitir a quem gerencia agentes definir, por agente, um horário de funcionamento composto por: fuso horário (nome IANA, padrão `America/Sao_Paulo`) e, para cada dia da semana, zero ou mais intervalos `início–fim` no formato `HH:mm`. Dentro de um dia, `início` MUST ser anterior a `fim`, os intervalos MUST NOT se sobrepor e `fim` MAY ser `24:00`. Um dia sem intervalos MUST significar que o agente não atende naquele dia. O horário MUST ser opcional e removível: agente sem horário configurado atende 24h por dia, todos os dias.

#### Scenario: Definir expediente comercial
- **WHEN** o administrador configura segunda a sexta das 09:00 às 12:00 e das 13:00 às 18:00 e salva
- **THEN** o agente passa a ter esse horário, sábado e domingo ficam sem atendimento e a tela mostra o horário salvo

#### Scenario: Intervalo inválido
- **WHEN** o administrador tenta salvar um intervalo com início 18:00 e fim 09:00, ou dois intervalos sobrepostos no mesmo dia
- **THEN** o sistema recusa, indica o dia e o intervalo com problema e não altera o horário salvo

#### Scenario: Fuso horário inválido
- **WHEN** o administrador informa um fuso que não existe
- **THEN** o sistema recusa o salvamento e informa que o fuso é inválido

#### Scenario: Remover o horário
- **WHEN** o administrador remove o horário de funcionamento do agente
- **THEN** o agente volta a atender 24h por dia

#### Scenario: Agentes existentes
- **WHEN** a funcionalidade entra em produção
- **THEN** todo agente já existente continua sem horário configurado e responde como antes

### Requirement: Atender somente dentro do horário
Quando o agente tem horário configurado, o sistema MUST encaminhar ao agente apenas as mensagens recebidas dentro de um intervalo do dia da semana corrente, avaliado no fuso do agente no momento em que a mensagem é processada. O início do intervalo MUST ser inclusivo e o fim exclusivo. Mensagem recebida fora do horário MUST NOT ser enviada ao GPTMaker, MUST NOT gerar débito de crédito e MUST ser registrada com o status "fora do horário". A mudança do horário MUST valer para as mensagens seguintes, sem reiniciar o agente.

#### Scenario: Mensagem dentro do horário
- **WHEN** o agente atende seg–sex 09:00–18:00 e chega uma mensagem na quarta às 10:30 (fuso do agente)
- **THEN** a mensagem é encaminhada ao agente e respondida normalmente

#### Scenario: Mensagem fora do horário
- **WHEN** chega uma mensagem no sábado às 10:30 para o mesmo agente
- **THEN** a mensagem não é enviada ao GPTMaker, nenhum crédito é debitado e o registro da mensagem fica como "fora do horário"

#### Scenario: Limites do intervalo
- **WHEN** chega uma mensagem exatamente às 09:00 e outra exatamente às 18:00, em dia útil
- **THEN** a das 09:00 é atendida e a das 18:00 é tratada como fora do horário

#### Scenario: Fuso diferente do servidor
- **WHEN** o agente está no fuso `America/Manaus` com horário 09:00–18:00 e chega uma mensagem às 17:30 de Manaus (18:30 de Brasília)
- **THEN** a mensagem é atendida, porque a avaliação usa o fuso do agente

#### Scenario: Alteração do horário
- **WHEN** o administrador amplia o horário às 14:00 e chega uma mensagem às 19:00 dentro do novo horário
- **THEN** a mensagem é atendida sem nenhuma ação adicional

### Requirement: Mensagem automática fora do horário
O sistema MUST permitir configurar, por agente, um texto (até 1.000 caracteres) enviado ao cliente quando ele escreve fora do horário. Com texto configurado, o sistema MUST enviá-lo no diálogo, sem passar pelo GPTMaker e sem débito de crédito, no máximo uma vez por diálogo a cada 12 horas, para não repetir o aviso a cada mensagem. Sem texto configurado, o agente MUST permanecer em silêncio fora do horário. A mensagem MUST NOT ser enviada se um operador estiver atendendo o diálogo.

#### Scenario: Aviso enviado
- **WHEN** o agente tem o texto "Atendemos de seg a sex, das 9h às 18h" e o cliente escreve no domingo
- **THEN** o cliente recebe esse texto no diálogo e nenhum crédito é debitado

#### Scenario: Aviso não repetido
- **WHEN** o mesmo cliente envia três mensagens no mesmo domingo, com intervalos de minutos
- **THEN** o aviso é enviado só na primeira; as outras duas ficam registradas como "fora do horário" sem resposta

#### Scenario: Sem texto configurado
- **WHEN** o agente não tem texto fora do horário e o cliente escreve fora do horário
- **THEN** o cliente não recebe resposta automática

#### Scenario: Operador atendendo
- **WHEN** um operador está atendendo o diálogo e o cliente escreve fora do horário
- **THEN** nenhum aviso é enviado e o atendimento humano segue normalmente

### Requirement: Convivência com o estado do agente e o teste
O horário de funcionamento MUST ser avaliado depois das checagens de agente ativo e de portal ativo, e antes da checagem de saldo: agente inativo continua sem responder, independentemente do horário, e fora do horário o saldo não é consultado. O chat de teste do agente MUST NOT ser limitado pelo horário de funcionamento.

#### Scenario: Agente inativo dentro do horário
- **WHEN** o agente está inativo e chega uma mensagem dentro do horário
- **THEN** a mensagem é descartada como agente inativo, sem aviso de fora do horário

#### Scenario: Sem saldo fora do horário
- **WHEN** o tenant está sem saldo e chega uma mensagem fora do horário
- **THEN** a mensagem é tratada como fora do horário e o aviso de falta de crédito não é enviado

#### Scenario: Teste fora do horário
- **WHEN** o administrador conversa com o agente no chat de teste num horário fora do funcionamento
- **THEN** o agente responde normalmente

### Requirement: Visualizar o estado atual
A tela do agente MUST mostrar o horário configurado e se, no momento, o agente está dentro ou fora do horário, no fuso do agente. Agente sem horário MUST ser exibido como "24 horas".

#### Scenario: Agente fora do horário agora
- **WHEN** o administrador abre a tela de um agente com horário seg–sex 09:00–18:00 num sábado
- **THEN** a tela mostra "Fora do horário agora" e a tabela semanal com os intervalos

#### Scenario: Agente sem horário
- **WHEN** o administrador abre a tela de um agente sem horário configurado
- **THEN** a tela mostra "24 horas" e oferece a configuração do horário
