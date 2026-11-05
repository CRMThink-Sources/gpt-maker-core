# crm-semantic-layer Specification

## Purpose
Traduz o CRM do Bitrix24 de cada cliente (campos técnicos, listas, funis e etapas) em conceitos de negócio com nome e significado, e define quais dados o agente de IA pode ler.

## Requirements

### Requirement: Catálogo de campos por tenant
O sistema MUST manter, por tenant, um catálogo dos campos de lead, negócio, contato e empresa do portal Bitrix24, montado a partir dos metadados do próprio portal. Cada campo MUST ter código, entidade, tipo, rótulo amigável (rótulo do formulário para campos `UF_*`, título para campos padrão), valores aceitos quando for lista ou booleano e uma descrição de significado opcional escrita pelo cliente. Campos de funil e etapa MUST ser resolvidos para os nomes reais dos funis e etapas do portal, com a semântica da etapa (em andamento, ganha, perdida).

#### Scenario: Campo personalizado com rótulo
- **WHEN** o portal tem o campo `UF_CRM_1712345678` com rótulo de formulário "Origem do lead" e itens Instagram, Indicação e Site
- **THEN** o catálogo apresenta o campo como "Origem do lead", tipo lista, com esses três valores aceitos

#### Scenario: Etapa resolvida pelo nome
- **WHEN** um negócio está na etapa `C3:PREPARATION` do funil "Vendas B2B", cujo nome configurado é "Proposta enviada"
- **THEN** a etapa é apresentada como funil "Vendas B2B", etapa "Proposta enviada", situação em andamento

#### Scenario: Campo removido no portal
- **WHEN** um campo exposto deixa de existir nos metadados do portal
- **THEN** o campo deixa de ser entregue ao agente e aparece no painel como indisponível, sem apagar a descrição escrita pelo cliente

### Requirement: Exposição somente por lista de permissão
O agente MUST receber apenas os campos que o cliente marcou como expostos. Por padrão, nenhum campo personalizado é exposto; um conjunto mínimo de campos padrão (nome, empresa, responsável, funil, etapa, valor, moeda e datas de criação e fechamento) MUST vir pré-selecionado na primeira configuração e pode ser desmarcado. Campos de telefone e e-mail MUST NOT ser expostos sem marcação explícita.

#### Scenario: Campo não exposto
- **WHEN** um negócio tem o campo "Margem interna" e o cliente não o marcou como exposto
- **THEN** nenhuma resposta ao agente contém esse campo nem seu valor

#### Scenario: Primeira configuração
- **WHEN** o cliente abre a configuração do CRM pela primeira vez
- **THEN** apenas o conjunto mínimo de campos padrão está marcado e os campos personalizados aparecem desmarcados

#### Scenario: Funil e etapa configuráveis
- **WHEN** o cliente deixa de expor o campo Etapa do negócio
- **THEN** os negócios entregues ao agente não trazem a etapa nem a situação (em andamento, ganha, perdida), e o funil continua sendo entregue enquanto estiver exposto

### Requirement: Tradução de valores
Todo valor entregue ao agente MUST estar traduzido: listas e status pelo nome do item, booleanos como "Sim"/"Não", usuários pelo nome, funis e etapas pelo nome, datas em ISO 8601 e valores monetários com a moeda. Códigos técnicos de campo, de item de lista ou de etapa MUST NOT aparecer na resposta ao agente. Valor que não puder ser traduzido (item de lista inexistente) MUST ser omitido.

#### Scenario: Valor de lista traduzido
- **WHEN** o campo "Origem do lead" de um contato tem o id de item 46, correspondente a "Indicação"
- **THEN** o agente recebe "Origem do lead: Indicação" e nunca o número 46

#### Scenario: Item inexistente
- **WHEN** o valor gravado no campo não corresponde a nenhum item atual da lista
- **THEN** o campo é omitido da resposta

### Requirement: Configuração pelo painel
O sistema MUST permitir ao administrador do tenant, no painel do app, listar os campos do catálogo por entidade, marcar ou desmarcar a exposição e escrever ou editar a descrição de significado de cada campo (até 300 caracteres). As alterações MUST valer para as próximas consultas do agente sem reinstalação nem reconfiguração no GPTMaker.

#### Scenario: Descrever um campo
- **WHEN** o administrador escreve "Canal pelo qual o cliente chegou; Indicação tem prioridade no atendimento" no campo "Origem do lead"
- **THEN** a descrição é salva e passa a acompanhar o campo nas próximas respostas ao agente

#### Scenario: Isolamento entre tenants
- **WHEN** um administrador tenta ler ou alterar o catálogo usando o identificador de um campo de outro tenant
- **THEN** o sistema responde como recurso inexistente e nada é alterado

### Requirement: Metadados atualizados
O catálogo MUST refletir campos, itens de lista, funis e etapas criados ou alterados no portal em até 10 minutos, e o administrador MUST poder forçar a atualização pelo painel.

#### Scenario: Nova etapa no funil
- **WHEN** o cliente cria uma etapa no funil do Bitrix24
- **THEN** em até 10 minutos, ou imediatamente após "atualizar" no painel, a etapa aparece no catálogo e nas respostas ao agente
