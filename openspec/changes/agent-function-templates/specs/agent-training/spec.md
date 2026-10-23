# Spec Delta

## MODIFIED Requirements

### Requirement: Cadastro de treinamento
O sistema MUST permitir adicionar treinamentos a um agente nos tipos `TEXT`, `WEBSITE` e `VIDEO`, enviando-os ao GPTMaker via `POST /agents/{id}/trainings` e persistindo localmente tipo, conteúdo/URL e status. No modo simples, os treinamentos `TEXT` MUST vir só dos itens estruturados do formulário da função (spec agent-function-configuration); `WEBSITE` e `VIDEO` MUST ser aceitos só com o modo avançado ligado. Treinamentos e re-treinamentos MUST NOT consumir créditos do tenant (os limites de treinamento são definidos pelo plano). O texto de um treinamento `TEXT` MUST ter no máximo 1028 caracteres, na criação e na edição.

#### Scenario: Treinamento não debita créditos
- **WHEN** um treinamento é criado, reprocessado ou re-treinado automaticamente
- **THEN** nenhum lançamento é feito no ledger de créditos do tenant

#### Scenario: Treinamento de texto
- **WHEN** a publicação da função cria um item da base de conhecimento
- **THEN** o sistema cria o treinamento no GPTMaker e o registra localmente, vinculado ao item, com status `PROCESSING` ou `DONE` conforme retorno

#### Scenario: Treinamento de website
- **WHEN** o administrador, com o modo avançado ligado, informa uma URL de site com opção de subpáginas e intervalo de re-treinamento
- **THEN** o sistema envia `website`, `trainingSubPages` e `trainingInterval` ao GPTMaker e registra o treinamento

#### Scenario: Site ou vídeo sem modo avançado
- **WHEN** o administrador tenta adicionar treinamento de site ou vídeo com o modo avançado desligado
- **THEN** o sistema recusa com erro de validação sem chamar o GPTMaker

### Requirement: Listagem, edição e remoção de treinamentos
O sistema MUST listar os treinamentos do agente, indicando quais são gerados pela função. Treinamentos gerados pela função MUST ser alterados e removidos só pela publicação do formulário; treinamentos de site e vídeo do modo avançado MUST poder ser removidos pela tela de treinamentos (`DELETE /trainings/{id}`). Local e GPTMaker MUST ficar consistentes.

#### Scenario: Treinamento gerado pela função
- **WHEN** o administrador tenta editar ou remover pela tela de treinamentos um treinamento gerado por item do formulário
- **THEN** o sistema recusa e orienta a alterar o item no formulário da função

#### Scenario: Remover treinamento do modo avançado
- **WHEN** o administrador remove um treinamento de site ou vídeo
- **THEN** o treinamento é removido no GPTMaker e marcado como removido localmente

#### Scenario: Divergência com GPTMaker
- **WHEN** a listagem local difere da listagem retornada por `GET /agents/{id}/trainings`
- **THEN** o sistema sincroniza o estado local a partir do GPTMaker, sendo o GPTMaker a fonte da verdade para treinamentos, e marca a configuração da função para republicação se um treinamento gerado sumiu

### Requirement: Limites de treinamento por plano
O sistema MUST aplicar o limite de quantidade de treinamentos definido no plano do tenant, contando os treinamentos gerados pela função e os de site e vídeo do modo avançado. O limite de tamanho total de documentos deixa de se aplicar, porque o treinamento por documento não é mais oferecido.

#### Scenario: Limite excedido
- **WHEN** um novo treinamento, gerado pela publicação da função ou adicionado no modo avançado, ultrapassa o limite do plano
- **THEN** o sistema recusa com erro `PLAN_TRAINING_LIMIT`
