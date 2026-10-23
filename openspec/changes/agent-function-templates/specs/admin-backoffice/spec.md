# Spec Delta

## ADDED Requirements

### Requirement: Tenant parceiro
O backoffice MUST permitir marcar e desmarcar um tenant como parceiro. Só tenants parceiros podem assumir o controle do comportamento dos seus agentes (spec agent-function-configuration). A alteração MUST ser registrada na auditoria do backoffice. Desmarcar um tenant MUST NOT alterar agentes já em controle assumido; ele só deixa de poder assumir o controle de outros agentes.

#### Scenario: Marcar parceiro
- **WHEN** o operador do backoffice marca um tenant como parceiro
- **THEN** os administradores do app desse tenant passam a ver a opção de assumir o controle, e a ação fica na auditoria

#### Scenario: Desmarcar parceiro
- **WHEN** o operador desmarca um tenant que tem um agente em controle assumido
- **THEN** o agente continua com o comportamento editado, e o tenant não consegue assumir o controle de outros agentes

### Requirement: Gestão de templates de função
O backoffice MUST oferecer uma área de templates de função para editar o rascunho, ver a prévia com respostas de exemplo, testar no agente de sandbox, publicar versões, comparar versões e restaurar uma versão antiga (spec agent-function-templates). A área MUST mostrar, por versão, quantos agentes ainda estão nela.

#### Scenario: Agentes por versão
- **WHEN** o operador abre o template Suporte
- **THEN** o backoffice lista as versões publicadas com a quantidade de agentes em cada uma
