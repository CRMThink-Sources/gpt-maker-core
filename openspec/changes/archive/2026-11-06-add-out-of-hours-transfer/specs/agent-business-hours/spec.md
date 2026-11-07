# Spec Delta

## MODIFIED Requirements

### Requirement: Mensagem automática fora do horário
O sistema MUST permitir configurar, por agente, um texto (até 1.000 caracteres) enviado ao cliente quando ele escreve fora do horário. O aviso MUST ser independente da transferência para atendente: com texto configurado, o sistema MUST enviá-lo no diálogo, sem passar pelo GPTMaker e sem débito de crédito. Sem transferência ligada, o aviso MUST ser enviado no máximo uma vez por diálogo a cada 12 horas; com transferência ligada, o aviso MUST ser enviado no momento da transferência e as mensagens seguintes, já em atendimento humano, MUST NOT gerar novo aviso. Sem texto configurado, o sistema MUST NOT enviar aviso. A mensagem MUST NOT ser enviada se um operador já estiver atendendo o diálogo.

#### Scenario: Aviso enviado
- **WHEN** o agente tem o texto "Atendemos de seg a sex, das 9h às 18h", a transferência está desligada e o cliente escreve no domingo
- **THEN** o cliente recebe esse texto no diálogo e nenhum crédito é debitado

#### Scenario: Aviso não repetido
- **WHEN** a transferência está desligada e o mesmo cliente envia três mensagens no mesmo domingo, com intervalos de minutos
- **THEN** o aviso é enviado só na primeira; as outras duas ficam registradas como "fora do horário" sem resposta

#### Scenario: Sem texto configurado
- **WHEN** o agente não tem texto fora do horário e o cliente escreve fora do horário
- **THEN** o cliente não recebe aviso automático

#### Scenario: Operador atendendo
- **WHEN** um operador está atendendo o diálogo e o cliente escreve fora do horário
- **THEN** nenhum aviso é enviado e o atendimento humano segue normalmente

## ADDED Requirements

### Requirement: Transferir para atendente fora do horário
O sistema MUST permitir configurar, por agente, se a conversa é transferida para um atendente quando o cliente escreve fora do horário. A opção MUST vir **ligada por padrão**, inclusive para agentes que já tinham horário configurado. Com a opção ligada, a mensagem fora do horário MUST NOT ser enviada ao GPTMaker nem gerar débito, MUST ser registrada como "fora do horário" e o diálogo MUST ser transferido para o operador livre da Linha Aberta e passar a atendimento humano, de modo que o agente não responda mais naquele diálogo. Se houver aviso configurado, ele MUST ser enviado antes da transferência. Uma recusa definitiva do Bitrix24 à transferência (por exemplo, diálogo já com operador) MUST NOT impedir o registro nem o aviso; falha transitória MUST fazer a mensagem ser retentada sem duplicar o aviso. Com a opção desligada, o comportamento MUST ser o da mensagem automática (aviso ou silêncio), sem transferência.

#### Scenario: Transferir sem avisar (padrão)
- **WHEN** o agente tem horário configurado, a transferência está ligada, não há texto de aviso e o cliente escreve fora do horário
- **THEN** o cliente não recebe aviso, o diálogo é transferido para o operador livre e a IA deixa de responder nele

#### Scenario: Avisar e transferir
- **WHEN** a transferência está ligada, há texto de aviso e o cliente escreve fora do horário
- **THEN** o cliente recebe o aviso e em seguida o diálogo é transferido para o operador livre

#### Scenario: Só avisar
- **WHEN** a transferência está desligada, há texto de aviso e o cliente escreve fora do horário
- **THEN** o cliente recebe o aviso, o diálogo não é transferido e a IA responde na próxima mensagem dentro do horário

#### Scenario: Mensagens seguintes depois da transferência
- **WHEN** o diálogo foi transferido fora do horário e o cliente envia mais mensagens
- **THEN** as mensagens ficam registradas como atendimento humano, sem aviso repetido e sem resposta da IA

#### Scenario: Sem devolução automática à IA
- **WHEN** o diálogo foi transferido fora do horário, o expediente começa e nenhum atendente encerrou o atendimento
- **THEN** o diálogo continua em atendimento humano e a IA não volta a responder

#### Scenario: Atendente encerra o atendimento
- **WHEN** o atendente encerra o atendimento de um diálogo transferido fora do horário
- **THEN** o diálogo volta para a IA nas mensagens seguintes, como em qualquer atendimento humano encerrado

#### Scenario: Agentes existentes com horário
- **WHEN** a funcionalidade entra em produção e um agente já tinha horário configurado
- **THEN** ele passa a transferir fora do horário, sem alteração manual, e o administrador pode desligar a opção

#### Scenario: Transferência recusada pelo Bitrix24
- **WHEN** o Bitrix24 recusa a transferência de forma definitiva
- **THEN** a mensagem fica registrada como "fora do horário", o aviso (se houver) já enviado permanece e nada é retentado

### Requirement: Configurar a transferência na tela do agente
A tela do agente MUST oferecer, na seção "Horário de funcionamento", a opção "Transferir para um atendente" e o texto de aviso, com a transferência ligada por padrão, e MUST informar que o expediente da Linha Aberta no Bitrix24 precisa estar configurado para a conversa ser atendida.

#### Scenario: Alterar a opção
- **WHEN** o administrador desliga "Transferir para um atendente", preenche o aviso e salva
- **THEN** o agente passa a só avisar fora do horário e a tela mostra a opção desligada

#### Scenario: Agente sem horário
- **WHEN** o agente não tem horário configurado
- **THEN** a opção de transferência não tem efeito e a tela mostra "24 horas"
