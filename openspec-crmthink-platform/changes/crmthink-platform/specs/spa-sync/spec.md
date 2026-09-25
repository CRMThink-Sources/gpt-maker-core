## ADDED Requirements

### Requirement: Configuração dos SPAs validada
O sistema MUST obter de configuração os IDs dos SPAs (1134, 1138, 1060, 1142, 1146 por padrão), os códigos de campo UF e os IDs de enum de status, e validar no boot que SPAs, campos e valores de enum existem no portal CRMThink, reportando falha no health check se algo faltar.

#### Scenario: Campo ausente
- **WHEN** um campo UF obrigatório não existe no SPA
- **THEN** o serviço falha no health check indicando o SPA e o campo

### Requirement: Separação por ambiente
O sistema MUST gravar o campo Ambiente (`production` ou `homolog`, conforme `PLATFORM_ENVIRONMENT`) em todo item que criar nos SPAs 1060, 1142 e 1146, e MUST ignorar em eventos, varreduras e consultas os itens de outro ambiente. Item sem Ambiente preenchido MUST ser tratado como `production`.

#### Scenario: Item de homologação no serviço de produção
- **WHEN** o serviço de produção recebe evento de uma assinatura marcada `homolog`
- **THEN** o evento é ignorado e nenhum evento é emitido aos apps

#### Scenario: Assinatura manual sem ambiente
- **WHEN** o time comercial cria assinatura `manual` sem preencher Ambiente
- **THEN** o serviço de produção a processa normalmente

### Requirement: Campos legados não utilizados
O sistema MUST NOT ler nem escrever os campos STATUS e TRIAL_* do SPA 1060; esses campos são removidos do SPA.

#### Scenario: Registro de instalação
- **WHEN** uma instalação é criada ou atualizada
- **THEN** apenas os campos de identificação, contato, `appCode` e Ambiente são escritos

### Requirement: Recepção de eventos dos SPAs
O sistema MUST receber `onCrmDynamicItemAdd`, `onCrmDynamicItemUpdate` e `onCrmDynamicItemDelete` do portal CRMThink, validar o `application_token` em comparação de tempo constante, buscar o item completo via `crm.item.get`, invalidar o cache correspondente e responder 200 em todos os casos exceto autenticação inválida ou indisponibilidade.

#### Scenario: Token inválido
- **WHEN** chega evento com token inválido
- **THEN** o sistema responde 401 sem processar

#### Scenario: Assinatura manual alterada
- **WHEN** um item `manual` do SPA 1142 muda de status ou período
- **THEN** o sistema aplica a regra do ciclo de vida e emite o evento correspondente

### Requirement: Anti-loop
O sistema MUST comparar o estado atual do item antes de escrever no SPA e gravar marcador de versão em cada escrita própria, ignorando eventos do SPA cujo marcador seja igual ao último escrito pelo serviço.

#### Scenario: Evento da própria escrita
- **WHEN** chega evento de atualização provocado por escrita do serviço
- **THEN** o evento é ignorado sem emitir eventos aos apps

### Requirement: Varredura Stripe ↔ SPA
O sistema MUST executar varredura periódica comparando assinaturas `stripe` no Stripe com os itens do SPA 1142 (status, período, plano, quantidade de itens cobráveis), corrigindo o SPA e emitindo eventos que deixaram de ser emitidos.

#### Scenario: Webhook perdido
- **WHEN** a varredura encontra assinatura renovada no Stripe cujo período no SPA está desatualizado
- **THEN** o SPA é corrigido e `subscription.renewed` é emitido

#### Scenario: Assinatura Stripe sem item no SPA
- **WHEN** existe assinatura Stripe com metadados de um app cadastrado e sem item no SPA
- **THEN** o item é criado e o caso é registrado

### Requirement: Varredura dos SPAs
O sistema MUST varrer periodicamente os itens alterados nos SPAs 1142 e 1146 desde a última varredura para recuperar eventos perdidos de alterações humanas ou de automações externas.

#### Scenario: Evento de SPA perdido
- **WHEN** a varredura encontra assinatura `manual` com período estendido sem evento processado
- **THEN** `subscription.renewed` é emitido
