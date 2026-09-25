## ADDED Requirements

### Requirement: Webhooks do agente gerenciados pela plataforma
O sistema MUST configurar os webhooks do agente no GPTMaker (`PUT /agents/{id}/webhooks`) apontando para endpoints do backend com token assinado por agente, cobrindo `onNewMessage`, `onLackKnowLedge`, `onTransfer`, `onFirstInteraction`, `onStartInteraction`, `onFinishInteraction`, `onCreateEvent` e `onCancelEvent`. O cliente MUST NOT informar URLs de webhook diretamente no GPTMaker.

#### Scenario: Webhooks configurados na criação
- **WHEN** um agente é criado
- **THEN** todos os webhooks suportados são configurados no GPTMaker com URL do backend contendo token do agente

#### Scenario: Webhook com token inválido
- **WHEN** o backend recebe chamada de webhook com token inexistente ou de agente removido
- **THEN** o sistema responde 401 e descarta o payload

### Requirement: Cadastro de gatilhos
O sistema MUST permitir ao administrador criar, editar, ativar/desativar e remover gatilhos que associam um evento do agente a uma ou mais ações no Bitrix24.

#### Scenario: Criar gatilho
- **WHEN** o administrador seleciona o evento `onFinishInteraction` e a ação "criar lead"
- **THEN** o gatilho é salvo ativo e vinculado ao agente

#### Scenario: Gatilho desativado
- **WHEN** um evento ocorre e o gatilho correspondente está desativado
- **THEN** nenhuma ação é executada

### Requirement: Ações suportadas
O sistema MUST suportar, no mínimo, as ações: criar lead, criar/atualizar negócio (com funil e etapa), adicionar comentário na timeline da entidade CRM vinculada ao diálogo, criar tarefa, iniciar processo de negócio (business process) e chamar URL externa (webhook de saída), com mapeamento de campos a partir do payload do evento.

#### Scenario: Criar lead com dados do contato
- **WHEN** um gatilho "criar lead" é disparado com payload contendo nome e telefone do contato
- **THEN** o sistema cria o lead no portal do tenant com os campos mapeados

#### Scenario: Webhook de saída
- **WHEN** um gatilho de "chamar URL externa" é disparado
- **THEN** o sistema envia POST com o payload do evento para a URL configurada, assinado com segredo do gatilho

### Requirement: Execução assíncrona e auditável
O sistema MUST executar ações de gatilhos de forma assíncrona via fila, com retentativas, e registrar cada execução (evento, ação, status, erro) consultável pelo administrador.

#### Scenario: Ação com falha transitória
- **WHEN** a API do Bitrix falha ao executar a ação
- **THEN** a ação é retentada com backoff e, esgotadas as tentativas, fica registrada como `FAILED` com o erro

#### Scenario: Consultar histórico
- **WHEN** o administrador abre o histórico de execuções de um gatilho
- **THEN** o sistema lista as execuções com data, evento, status e mensagem de erro quando houver
