## ADDED Requirements

### Requirement: Chatbot por agente
O sistema MUST registrar no portal do tenant um chatbot Bitrix do tipo Linhas Abertas (`imbot.v2.Bot.register`, idempotente por código) para cada agente ativo, com nome e avatar do agente, e desregistrá-lo quando o agente for removido.

#### Scenario: Agente criado
- **WHEN** um agente é criado com sucesso
- **THEN** o sistema registra o chatbot correspondente no portal e persiste o `botId` vinculado ao agente

#### Scenario: Agente renomeado
- **WHEN** nome ou avatar do agente mudam
- **THEN** os dados do chatbot no Bitrix são atualizados

### Requirement: Recepção assíncrona de mensagens
O sistema MUST receber os eventos de nova mensagem do chatbot, validar o `application_token` do tenant, deduplicar pelo identificador da mensagem e enfileirar para processamento, respondendo ao Bitrix rapidamente sem aguardar o GPTMaker.

#### Scenario: Mensagem nova
- **WHEN** chega um evento de mensagem válido para um bot vinculado a agente ativo
- **THEN** o sistema publica a mensagem na fila de entrada e responde HTTP 200 ao Bitrix

#### Scenario: Evento duplicado
- **WHEN** o mesmo evento de mensagem chega mais de uma vez
- **THEN** o sistema processa apenas a primeira ocorrência

#### Scenario: Token de aplicação inválido
- **WHEN** o evento chega com `application_token` que não corresponde ao tenant
- **THEN** o sistema rejeita o evento e não enfileira nada

### Requirement: Encaminhamento ao GPTMaker e resposta no Bitrix
O worker MUST, para cada mensagem enfileirada, verificar saldo do tenant, enviar a mensagem à API `POST /agents/{id}/conversation` do GPTMaker usando `contextId` único por diálogo (prefixado pelo tenant) e publicar a resposta no chat do Bitrix via chatbot, incluindo imagens, áudios e documentos retornados.

#### Scenario: Resposta de texto
- **WHEN** o GPTMaker retorna `message` para a mensagem do cliente
- **THEN** o sistema envia a resposta no mesmo diálogo do Bitrix e registra o evento de consumo para débito

#### Scenario: Mensagens em sequência no mesmo diálogo
- **WHEN** várias mensagens do mesmo diálogo chegam em sequência
- **THEN** o sistema as processa em ordem, sem paralelismo dentro do mesmo diálogo

#### Scenario: Mídia recebida do cliente
- **WHEN** o cliente envia imagem, áudio ou documento
- **THEN** o sistema encaminha o anexo ao GPTMaker usando o tipo de conteúdo correspondente

### Requirement: Saldo insuficiente
O sistema MUST NOT encaminhar mensagens ao GPTMaker quando o tenant estiver sem saldo disponível (saldo total menor ou igual a zero); nesse caso MUST enviar no diálogo uma mensagem de sistema do bot (`SYSTEM = Y`) informando que a mensagem não será processada por falta de créditos, e MUST transferir o diálogo para a fila de operadores da Linha Aberta.

#### Scenario: Tenant sem saldo
- **WHEN** chega mensagem de tenant com saldo menor ou igual a zero
- **THEN** o sistema não chama o GPTMaker, envia no diálogo a mensagem de sistema (`SYSTEM = Y`) de falta de créditos, transfere o diálogo para operador humano, não lança débito e registra o evento `BLOCKED_NO_CREDIT`

#### Scenario: Créditos restabelecidos
- **WHEN** o tenant volta a ter saldo positivo (novo ciclo ou pacote avulso)
- **THEN** as novas mensagens voltam a ser encaminhadas ao GPTMaker; mensagens bloqueadas anteriormente não são reprocessadas

### Requirement: Transferência para humano
O sistema MUST transferir o diálogo para operador da Linha Aberta quando o GPTMaker disparar `onTransfer`, e sinalizar ao GPTMaker (`human-start`/`human-stop`) quando o atendimento humano iniciar e terminar, para que o agente não responda durante o atendimento humano.

#### Scenario: Agente solicita transferência
- **WHEN** o webhook `onTransfer` é recebido para um diálogo
- **THEN** o sistema transfere o diálogo para operador no Bitrix e para de encaminhar novas mensagens desse diálogo ao GPTMaker até o atendimento humano terminar

### Requirement: Resiliência no processamento
O sistema MUST reprocessar falhas transitórias do GPTMaker ou Bitrix com backoff exponencial, limitar tentativas e mover mensagens esgotadas para uma DLQ, sem debitar créditos de mensagens não respondidas.

#### Scenario: GPTMaker indisponível
- **WHEN** a chamada ao GPTMaker falha com erro 5xx ou timeout
- **THEN** a mensagem é reenfileirada com atraso crescente até o limite de tentativas

#### Scenario: Tentativas esgotadas
- **WHEN** a mensagem atinge o limite de tentativas
- **THEN** ela vai para a DLQ, o diálogo é transferido para operador e nenhum crédito é debitado
