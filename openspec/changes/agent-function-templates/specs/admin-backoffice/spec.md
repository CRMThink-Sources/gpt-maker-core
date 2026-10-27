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

### Requirement: Editor visual de templates e blocos
O backoffice MUST permitir criar e editar o rascunho de um template e de um bloco sem escrever JSON, em seções: geral (nome, descrição, tipo no GPTMaker, settings derivados, blocos incluídos, dados da empresa), formulário (campos, opções com trecho, campos dependentes, itens da base), texto do agente e ações (intenções). O editor JSON MUST continuar disponível como seção avançada, sincronizado com as demais: o que é editado numa aparece na outra. O editor MUST mostrar, enquanto o operador edita e sem salvar, o tamanho do comportamento no pior caso e os problemas que impedem a publicação (spec agent-function-templates, "Validação de orçamento" e "Texto do comportamento sem lógica"), apontando o campo, a opção ou a ação com problema.

#### Scenario: Criar campo de escolha sem JSON
- **WHEN** o operador adiciona um campo de escolha, escreve o rótulo, adiciona duas opções com rótulo e trecho e salva
- **THEN** o rascunho é gravado com o campo, o id gerado a partir do rótulo e os valores das opções gerados, e o JSON da seção avançada mostra o mesmo conteúdo

#### Scenario: Campo dependente
- **WHEN** o operador adiciona um campo dependente dentro de uma opção
- **THEN** o campo aparece aninhado sob a opção no editor e só é exigido no formulário do cliente quando a opção é escolhida

#### Scenario: Marcador pelo editor
- **WHEN** o operador edita o texto do agente ou o trecho de uma opção
- **THEN** o editor oferece para inserir só marcadores que existem naquele ponto (campos do formulário, marcadores do sistema, blocos incluídos) e destaca marcador que não existe

#### Scenario: Problema visto antes de publicar
- **WHEN** uma alteração deixa o pior caso acima de 3000 caracteres ou um dependente sem uso
- **THEN** o editor mostra o problema e a contribuição de cada campo antes de o operador salvar ou publicar

#### Scenario: JSON inválido na seção avançada
- **WHEN** o operador deixa o JSON da seção avançada inválido
- **THEN** as demais seções não são alteradas até o JSON voltar a ser válido, e o erro aparece com o caminho do campo

### Requirement: Nova função a partir de outra
O backoffice MUST permitir criar uma função nova copiando o rascunho de uma função existente, informando só código, nome e descrição. A cópia MUST ser independente: alterar uma não muda a outra.

#### Scenario: Duplicar Suporte
- **WHEN** o operador cria a função "Suporte técnico" a partir de Suporte
- **THEN** a nova função nasce com o rascunho de Suporte, sem versões publicadas, e editar o rascunho dela não altera Suporte
