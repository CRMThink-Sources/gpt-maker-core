## Purpose

Permite agrupar os treinamentos do agente por assunto com tags livres, para o cliente achar e entender uma base grande de treinamentos.

## ADDED Requirements

### Requirement: Atribuir tags a um treinamento
O sistema MUST permitir a quem gerencia agentes definir as tags de um treinamento, na criação e depois dela, em qualquer tipo de treinamento manual, mesmo nos que não têm o conteúdo editável (site, vídeo, documento). Alterar só as tags MUST NOT reenviar o treinamento ao GPTMaker nem alterar o estado dele. Cada treinamento MUST aceitar no máximo 10 tags. Quem apenas consulta MUST NOT poder alterar tags. Treinamentos gerados pela função do agente MUST NOT aceitar tags.

#### Scenario: Marcar um site com tags
- **WHEN** o administrador adiciona as tags "preços" e "2026" a um treinamento de site já concluído
- **THEN** as tags aparecem no treinamento e ele continua com o mesmo estado, sem novo processamento

#### Scenario: Mais de 10 tags
- **WHEN** o administrador tenta salvar um treinamento com 11 tags
- **THEN** o sistema recusa e informa o limite de 10

#### Scenario: Perfil somente consulta
- **WHEN** um usuário sem permissão de gerenciar tenta alterar tags
- **THEN** o sistema recusa

### Requirement: Normalização das tags
O sistema MUST aparar espaços das pontas e reduzir espaços repetidos de cada tag, tratar tags que diferem só por maiúsculas/minúsculas como a mesma tag (guardando em minúsculas) e descartar duplicatas e tags vazias. Cada tag MUST ter de 1 a 30 caracteres.

#### Scenario: Duplicatas e caixa
- **WHEN** o administrador salva as tags "Preços", "preços " e "PREÇOS"
- **THEN** o treinamento fica com uma única tag "preços"

#### Scenario: Tag grande demais
- **WHEN** o administrador informa uma tag com 31 caracteres
- **THEN** o sistema recusa e informa o limite de 30 caracteres

### Requirement: Sugestão de tags já usadas
O sistema MUST oferecer, ao editar tags e ao filtrar, as tags já usadas em treinamentos não removidos do mesmo agente, ordenadas alfabeticamente e sem repetição. As tags de um agente MUST NOT aparecer para outro agente nem para outro tenant.

#### Scenario: Sugestões do agente
- **WHEN** o agente A tem as tags "preços" e "horários" e o agente B tem "devolução"
- **THEN** ao editar um treinamento do agente A, as sugestões são "horários" e "preços"

#### Scenario: Tag some quando ninguém a usa
- **WHEN** o único treinamento com a tag "promo" é removido
- **THEN** "promo" deixa de ser sugerida
