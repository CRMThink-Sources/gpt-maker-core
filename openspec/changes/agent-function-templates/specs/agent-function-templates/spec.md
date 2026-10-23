# Spec Delta

## Purpose

Templates de função mantidos pela CRMThink no backoffice: definem o formulário que o cliente responde e o texto do comportamento que a compilação monta, com versões imutáveis para que nenhuma edição altere agentes em produção.

## ADDED Requirements

### Requirement: Template de função
O sistema MUST manter, no backoffice, um template por função de agente. Cada template MUST ter código estável (ex.: `SDR`, `SUPPORT`, `SCHEDULING`, `POST_SALES`), nome e descrição exibidos ao cliente, o `type` do GPT Maker derivado (`SALE` ou `SUPPORT`), os settings derivados (transferência humana, `limitSubjects`, mensagem de falta de conhecimento), a definição do formulário e o texto do comportamento com marcadores `{{campo}}`. Só usuários com acesso ao backoffice MUST criar ou editar templates.

#### Scenario: Funções iniciais disponíveis
- **WHEN** a plataforma é implantada com este change
- **THEN** existem templates publicados para SDR/Qualificação, Suporte, Agendamento e Pós-venda, e o cliente só pode criar agentes dessas funções

#### Scenario: Acesso sem backoffice
- **WHEN** um usuário do app (tenant) tenta criar ou editar um template
- **THEN** o sistema recusa como acesso não autorizado

### Requirement: Definição do formulário
O formulário de um template MUST ser composto por campos dos tipos: texto livre (com limite de caracteres), lista de textos (com mínimo, máximo de itens e limite por item), URL, escolha única, múltipla escolha, seleção de usuário do Bitrix24, seleção de funil e etapa, número inteiro com limites, e item da base de conhecimento (lista de registros com subcampos, cada registro limitado ao tamanho de um treinamento de texto). Cada opção de escolha MUST trazer o rótulo exibido ao cliente e o trecho de texto que vai para o comportamento. Uma opção MAY declarar campos dependentes, exibidos e exigidos só quando ela está escolhida; o trecho da opção MAY citar esses campos.

#### Scenario: Opção carrega o trecho
- **WHEN** o cliente escolhe a opção "Não, encaminha ao consultor" do campo "Pode falar de preço?"
- **THEN** a compilação substitui o marcador do campo pelo trecho definido para essa opção no template, que o cliente não vê nem edita

#### Scenario: Campo dependente
- **WHEN** a opção "Informar o canal de suporte" está escolhida
- **THEN** o formulário exige o campo dependente "Qual o canal de suporte?" e o trecho da opção recebe o valor dele

#### Scenario: Campo dependente de opção não escolhida
- **WHEN** a opção que declara um campo dependente não está escolhida
- **THEN** o campo não é exibido, não é exigido e seu valor não entra na compilação

### Requirement: Texto do comportamento sem lógica
O texto do comportamento do template MUST conter apenas texto fixo e marcadores de campos do formulário; MUST NOT aceitar condicionais, laços ou expressões. Listas MUST ser renderizadas como tópicos; múltipla escolha MUST concatenar os trechos das opções marcadas; o marcador `{{avancado.instrucoes_adicionais}}` MUST ser vazio fora do modo avançado.

#### Scenario: Marcador de campo inexistente
- **WHEN** o rascunho do template cita um marcador que não corresponde a nenhum campo do formulário nem a um bloco
- **THEN** a publicação do rascunho é recusada apontando o marcador

#### Scenario: Seção opcional não marcada
- **WHEN** numa múltipla escolha o cliente não marca uma opção cujo trecho é uma seção inteira do comportamento
- **THEN** essa seção não aparece no comportamento compilado

### Requirement: Blocos compartilhados
O sistema MUST oferecer blocos reutilizáveis que os templates incluem em vez de copiar: bloco comum do formulário (nome do agente, nome da empresa, descrição da empresa até 300 caracteres, tom, emojis), "onde registrar" (registro vinculado à conversa ou negócio num funil e etapa), "abrir chamado / registrar dúvida" e "transferir para atendente". Um bloco MUST ser versionado com o template que o inclui: alterar um bloco só chega a um agente quando o template é publicado em nova versão e o agente é republicado.

#### Scenario: Correção num bloco
- **WHEN** o backoffice altera o texto do bloco "registrar dúvida" e publica novas versões dos templates que o usam
- **THEN** os agentes dessas funções recebem a correção na próxima republicação, e nenhum agente muda antes disso

### Requirement: Rascunho e versões imutáveis
Cada template MUST ter no máximo um rascunho editável e uma sequência de versões publicadas imutáveis. Publicar o rascunho MUST criar uma nova versão sem alterar as anteriores. Restaurar uma versão antiga MUST ser feito publicando seu conteúdo como nova versão. Toda publicação MUST ser registrada na auditoria do backoffice.

#### Scenario: Publicar nova versão
- **WHEN** o backoffice publica o rascunho do template SDR que está na versão 3
- **THEN** a versão 4 é criada, a versão 3 continua disponível sem alteração e nenhum agente existente é recompilado

#### Scenario: Rollback
- **WHEN** o backoffice restaura a versão 2 do template
- **THEN** o conteúdo da versão 2 é publicado como uma nova versão, e o histórico mantém todas as anteriores

### Requirement: Validação de orçamento
Ao publicar, o sistema MUST calcular o tamanho do comportamento no pior caso — texto fixo, todos os campos livres e listas no limite, a opção de trecho mais longo de cada escolha, todas as opções de múltipla escolha marcadas e instruções adicionais no limite — e MUST recusar a publicação se ultrapassar 3000 caracteres, informando o total e a contribuição de cada campo.

#### Scenario: Pior caso acima do limite
- **WHEN** o pior caso do rascunho soma 3.150 caracteres
- **THEN** a publicação é recusada mostrando o total e quanto cada campo contribui

#### Scenario: Pior caso dentro do limite
- **WHEN** o pior caso do rascunho soma até 3000 caracteres e não há marcadores inválidos
- **THEN** a publicação é aceita

### Requirement: Teste em sandbox
O backoffice MUST permitir compilar o rascunho com respostas de exemplo, ver o comportamento, os treinamentos e as intenções resultantes, e publicá-los num agente de sandbox no workspace do GPT Maker para conversar com ele, sem afetar agentes de tenants nem consumir créditos de tenants.

#### Scenario: Prévia do rascunho
- **WHEN** o backoffice preenche respostas de exemplo e pede a prévia do rascunho
- **THEN** o sistema mostra o comportamento compilado com a contagem de caracteres, a lista de treinamentos e as intenções que seriam geradas

#### Scenario: Conversa no sandbox
- **WHEN** o backoffice publica a prévia no agente de sandbox
- **THEN** o agente de sandbox é atualizado no GPT Maker com o resultado compilado e pode ser testado, sem relação com nenhum tenant
