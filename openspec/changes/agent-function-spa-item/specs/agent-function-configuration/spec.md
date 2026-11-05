## ADDED Requirements

### Requirement: Escolha do SPA e dos campos no formulário
Para um campo de processo inteligente, o formulário MUST deixar o cliente escolher, nas listas do portal dele: o SPA, o funil e a etapa inicial do item, e, para cada valor declarado no template, o campo do SPA que recebe o valor (ou nenhum, se o valor não for obrigatório). Quando o valor declara opções e o campo escolhido é do tipo lista, o formulário MUST deixar o cliente ligar cada opção a um item da lista, já sugerindo o item cujo valor ou rótulo coincide com a opção. Fora do Bitrix24 ou sem permissão para ler as listas, o formulário MUST aceitar os ids e códigos digitados. Trocar o SPA MUST limpar funil, etapa, campos e ligações das opções.

#### Scenario: Cliente mapeia o chamado
- **WHEN** o cliente escolhe o SPA "Chamados", o funil "Suporte", a etapa "Novo" e liga Origem a "Origem", Prioridade a "Prioridade" (lista), Problema relatado a "Descrição", Chat de origem a "Chat", Diálogo de origem a "Diálogo" e Sessão a "Sessão"
- **THEN** as respostas são aceitas e a prévia mostra a ação "Criar item de SPA" com esses campos

#### Scenario: Opções sugeridas pela lista
- **WHEN** o campo "Prioridade" do SPA tem os itens "LOW", "NORMAL", "HIGH" e "URGENT"
- **THEN** o formulário já liga cada opção ao item de mesmo nome, e o cliente pode trocar

#### Scenario: Valor obrigatório sem campo
- **WHEN** o valor Problema relatado é obrigatório e o cliente não escolhe campo para ele
- **THEN** a publicação é recusada apontando o valor no campo de SPA

### Requirement: Compilação da ação de SPA
A compilação MUST gerar a ação "Criar item de SPA" da intenção com o SPA, o funil e a etapa escolhidos e, em cada valor, o código do campo do portal escolhido pelo cliente; valores sem campo escolhido MUST ficar de fora. As ligações das opções com itens de lista MUST ir junto na ação. Republicar com outro mapeamento MUST atualizar a intenção gerada.

#### Scenario: Valor opcional sem campo
- **WHEN** o valor Sessão é opcional e o cliente não escolhe campo para ele
- **THEN** a ação gerada não grava a sessão e as demais continuam

#### Scenario: Troca de SPA
- **WHEN** o cliente troca o SPA, refaz o mapeamento e republica
- **THEN** a intenção passa a criar itens no novo SPA
