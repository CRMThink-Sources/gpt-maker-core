## ADDED Requirements

### Requirement: Cadastro de treinamento
O sistema MUST permitir adicionar treinamentos a um agente nos tipos `TEXT`, `WEBSITE`, `VIDEO` e `DOCUMENT`, enviando-os ao GPTMaker via `POST /agents/{id}/trainings` e persistindo localmente tipo, conteúdo/URL e status. Treinamentos e re-treinamentos MUST NOT consumir créditos do tenant (os limites de treinamento são definidos pelo plano). O texto de um treinamento `TEXT` MUST ter no máximo 1028 caracteres, na criação e na edição.

#### Scenario: Treinamento não debita créditos
- **WHEN** um treinamento é criado, reprocessado ou re-treinado automaticamente
- **THEN** nenhum lançamento é feito no ledger de créditos do tenant

#### Scenario: Treinamento de texto
- **WHEN** o administrador envia um texto de treinamento válido
- **THEN** o sistema cria o treinamento no GPTMaker e o registra localmente com status `PROCESSING` ou `DONE` conforme retorno

#### Scenario: Treinamento de website
- **WHEN** o administrador informa uma URL de site com opção de subpáginas e intervalo de re-treinamento
- **THEN** o sistema envia `website`, `trainingSubPages` e `trainingInterval` ao GPTMaker e registra o treinamento

#### Scenario: Treinamento de documento
- **WHEN** o administrador faz upload de um documento suportado
- **THEN** o sistema armazena o arquivo em storage de objetos com URL acessível ao GPTMaker, envia `documentUrl`, `documentName` e `documentMimetype`, e registra o treinamento

#### Scenario: Arquivo inválido
- **WHEN** o upload excede o tamanho máximo ou tem MIME type não suportado
- **THEN** o sistema recusa o upload com mensagem de validação sem chamar o GPTMaker

### Requirement: Atualização de status do treinamento
O sistema MUST acompanhar o status do processamento do treinamento usando o `callbackUrl` do GPTMaker e atualizar o registro local.

#### Scenario: Callback de conclusão
- **WHEN** o GPTMaker chama o `callbackUrl` informando conclusão do treinamento
- **THEN** o sistema valida o token do callback, atualiza o status para `DONE` e o frontend reflete a mudança

#### Scenario: Callback de falha
- **WHEN** o callback informa falha
- **THEN** o status fica `FAILED` e o usuário pode reenviar o treinamento

### Requirement: Listagem, edição e remoção de treinamentos
O sistema MUST listar os treinamentos do agente, permitir editar treinamentos de texto (`PUT /trainings/{id}`) e remover qualquer treinamento (`DELETE /trainings/{id}`), mantendo local e GPTMaker consistentes.

#### Scenario: Editar treinamento de texto
- **WHEN** o administrador altera o texto de um treinamento `TEXT`
- **THEN** o GPTMaker é atualizado e o registro local reflete o novo conteúdo

#### Scenario: Remover treinamento
- **WHEN** o administrador remove um treinamento
- **THEN** o treinamento é removido no GPTMaker e marcado como removido localmente

#### Scenario: Divergência com GPTMaker
- **WHEN** a listagem local difere da listagem retornada por `GET /agents/{id}/trainings`
- **THEN** o sistema sincroniza o estado local a partir do GPTMaker, sendo o GPTMaker a fonte da verdade para treinamentos

### Requirement: Limites de treinamento por plano
O sistema MUST aplicar limites de quantidade de treinamentos e de tamanho total de documentos definidos no plano do tenant.

#### Scenario: Limite excedido
- **WHEN** um novo treinamento ultrapassa o limite do plano
- **THEN** o sistema recusa com erro `PLAN_TRAINING_LIMIT`
