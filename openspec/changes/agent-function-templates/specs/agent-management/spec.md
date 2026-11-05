# Spec Delta

## MODIFIED Requirements

### Requirement: Criação de agente
O sistema MUST permitir que o tenant crie um agente informando nome, avatar, a função do agente (entre os templates de função publicados) e modelo de IA (entre os permitidos pelo plano, padrão do catálogo se omitido), criando o agente correspondente no workspace partner do GPTMaker e persistindo o vínculo `tenantId` ↔ `gptmakerAgentId`. O comportamento, o tipo (`SUPPORT`, `SALE`, `PERSONAL`), os dados da empresa (`jobName`, `jobDescription`) e os settings derivados MUST vir da compilação da função (spec agent-function-configuration), não de campos livres do formulário de criação; o tom de comunicação (`FORMAL`, `NORMAL`, `RELAXED`) vem do bloco comum do formulário da função. O agente MUST ser criado no GPTMaker só na primeira publicação, com o resultado compilado.

#### Scenario: Criação com sucesso
- **WHEN** um administrador do tenant escolhe a função, preenche o formulário válido, confirma a prévia e o tenant está abaixo do limite de agentes
- **THEN** o sistema registra a criação em andamento, cria o agente no GPTMaker com o nome dado pelo cliente e o comportamento compilado, aplica o modelo via `prefferModel` e os settings derivados, cria os treinamentos e intenções gerenciados, persiste o registro local com status `ACTIVE` e a versão do template, configura os webhooks do agente apontando para o backend e retorna o agente criado

#### Scenario: Função inexistente ou sem versão publicada
- **WHEN** o formulário de criação informa uma função que não tem template publicado
- **THEN** o sistema recusa com erro de validação sem chamar o GPTMaker

#### Scenario: Modelo não permitido
- **WHEN** o formulário informa modelo inativo ou não permitido pelo plano
- **THEN** o sistema recusa com erro `MODEL_NOT_ALLOWED` sem chamar o GPTMaker

#### Scenario: Limite de agentes atingido
- **WHEN** o tenant já possui 5 agentes não removidos (ativos ou inativos)
- **THEN** o sistema recusa a criação com erro de negócio `TENANT_AGENT_LIMIT` sem chamar o GPTMaker

#### Scenario: Falha no GPTMaker
- **WHEN** o GPTMaker retorna erro ou não responde na criação
- **THEN** o sistema não persiste agente ativo, registra o erro com identificador de rastreio e retorna mensagem de falha recuperável ao usuário

### Requirement: Edição de configurações do agente
O sistema MUST permitir editar nome, avatar, modelo e os settings operacionais do agente (fuso horário, agrupamento de mensagens, divisão de mensagens, assinatura, limite diário de mensagens e ação ao atingi-lo) e refletir as alterações no GPTMaker via `PUT /agents/{id}` e `PUT /agents/{id}/settings`. Comportamento, tipo, dados da empresa, tom, emojis, transferência humana, `limitSubjects` e mensagem de falta de conhecimento MUST ser alterados só pela publicação da função (formulário ou, para parceiros, assumir controle), nunca por edição direta.

#### Scenario: Edição refletida no GPTMaker
- **WHEN** o administrador salva alterações de nome, avatar, modelo ou settings operacionais
- **THEN** o sistema atualiza o GPTMaker e, após sucesso, atualiza o registro local e invalida o cache do agente

#### Scenario: Campo gerenciado pela função
- **WHEN** a edição direta tenta alterar o comportamento, o tipo ou um setting derivado da função
- **THEN** o sistema recusa com erro de validação e orienta a alterar pelo formulário da função

#### Scenario: Conflito de sincronização
- **WHEN** a atualização no GPTMaker falha
- **THEN** o registro local permanece com a versão anterior e o usuário recebe erro indicando que nada foi alterado
