# Spec Delta

## ADDED Requirements

### Requirement: Intenções gerenciadas pela função
Intenções geradas pela compilação da função do agente (spec agent-function-configuration) MUST ser marcadas como gerenciadas. Intenções gerenciadas MUST aparecer na lista do agente identificadas como da função, MUST NOT ser editadas nem removidas pela tela de intenções e MUST ser criadas, atualizadas e removidas só pela publicação da função. As intenções cadastradas pelo administrador continuam com as regras atuais e MUST NOT usar a mesma descrição de uma intenção gerenciada do agente.

#### Scenario: Editar intenção gerenciada
- **WHEN** o administrador tenta editar ou remover pela tela de intenções a intenção "Registrar dúvida" gerada pela função
- **THEN** o sistema recusa e orienta a alterar pelo formulário da função

#### Scenario: Publicação atualiza intenção gerenciada
- **WHEN** o cliente muda as perguntas de qualificação do agente SDR e publica
- **THEN** a intenção de qualificação é atualizada no GPTMaker com os novos campos, sem criar uma intenção nova

#### Scenario: Descrição em conflito
- **WHEN** o administrador cadastra uma intenção com a mesma descrição de uma intenção gerenciada do agente
- **THEN** o sistema recusa com erro de validação
