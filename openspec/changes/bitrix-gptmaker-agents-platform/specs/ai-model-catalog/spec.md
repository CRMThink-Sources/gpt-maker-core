## ADDED Requirements

### Requirement: Cadastro de modelos
O sistema MUST manter uma tabela de modelos de IA gerenciada no backoffice, contendo: código do modelo no GPTMaker (valor de `prefferModel`, ex.: `GPT_5_MINI`, `CLAUDE_4_5_HAIKU`), nome de exibição, descrição, custo em créditos por resposta, flag de ativo e flag de modelo padrão.

#### Scenario: Criar modelo
- **WHEN** um operador `ADMIN` cadastra um modelo com código válido e custo por resposta
- **THEN** o modelo fica disponível para seleção nos agentes dos planos que o permitem

#### Scenario: Código duplicado
- **WHEN** um operador tenta cadastrar um código de modelo já existente e não removido
- **THEN** o sistema recusa o cadastro

#### Scenario: Modelo padrão único
- **WHEN** um modelo é marcado como padrão
- **THEN** qualquer outro modelo deixa de ser padrão

### Requirement: Alteração de custo com histórico
O sistema MUST registrar cada alteração de custo do modelo em histórico (valor anterior, novo valor, autor, data) e aplicar o novo custo apenas a respostas processadas após a alteração. Cada débito MUST guardar o custo usado.

#### Scenario: Custo alterado
- **WHEN** o custo de um modelo muda de 2 para 3 créditos
- **THEN** débitos já lançados permanecem com 2 e novas respostas são debitadas com 3

### Requirement: Desativação e remoção de modelos
O sistema MUST permitir desativar um modelo (não pode ser escolhido em novos agentes) e remover um modelo apenas quando nenhum agente ativo o utiliza, ou mediante escolha de modelo substituto para migrar os agentes afetados.

#### Scenario: Remover modelo em uso sem substituto
- **WHEN** um operador tenta remover modelo usado por agentes ativos sem informar substituto
- **THEN** o sistema recusa e lista os agentes afetados

#### Scenario: Remover modelo com substituto
- **WHEN** o operador remove o modelo informando um substituto ativo
- **THEN** os agentes afetados passam a usar o substituto (atualizando `prefferModel` no GPTMaker) e o modelo fica removido (soft delete)

### Requirement: Modelos permitidos por plano
O sistema MUST permitir definir em cada plano quais modelos ativos podem ser usados pelos agentes do tenant.

#### Scenario: Tenant escolhe modelo
- **WHEN** o administrador do tenant edita o modelo do agente
- **THEN** somente modelos ativos permitidos pelo plano são oferecidos, com o custo por resposta exibido
