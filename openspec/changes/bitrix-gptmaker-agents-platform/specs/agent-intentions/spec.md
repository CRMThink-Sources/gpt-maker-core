## ADDED Requirements

### Requirement: Cadastro de intenção
O sistema MUST permitir que o administrador do app cadastre intenções em um agente: a descrição do que o cliente final quer (quando o agente deve usar a intenção), os campos que o agente deve coletar na conversa (nome, descrição, tipo `STRING` | `URL` | `DATE_TIME` | `DATE` | `NUMBER` | `BOOLEAN` e obrigatoriedade) e a chamada a ser feita (`GET` ou `POST`, URL, cabeçalhos, parâmetros e corpo, com geração automática opcional de parâmetros e corpo pelo agente). A intenção MUST ser criada no GPTMaker (`POST /agent/{id}/intentions`) e registrada localmente; o registro local é a fonte da verdade da tela.

#### Scenario: Intenção criada
- **WHEN** o administrador salva uma intenção válida em um agente do tenant
- **THEN** o sistema cria a intenção no GPTMaker, registra localmente com o id do GPTMaker e a exibe na lista do agente

#### Scenario: Campo citado na URL ou no corpo
- **WHEN** a URL, um parâmetro ou o corpo citam `{campo}` que não está entre os campos a coletar
- **THEN** o sistema recusa com erro de validação apontando o campo desconhecido, sem chamar o GPTMaker

#### Scenario: Descrição repetida
- **WHEN** o administrador cadastra no mesmo agente uma intenção com a mesma descrição de outra existente
- **THEN** o sistema recusa com erro de validação (a descrição identifica a intenção para o agente e para localizar o id no GPTMaker)

#### Scenario: GPTMaker recusa ou está fora
- **WHEN** a criação no GPTMaker falha
- **THEN** nada fica registrado localmente e o administrador recebe erro recuperável com o identificador para o suporte

### Requirement: Edição e remoção de intenção
O sistema MUST permitir editar e remover intenções, refletindo no GPTMaker (`PUT /intention/{id}`, `DELETE /intention/{id}`). Intenção já ausente no GPTMaker MUST contar como removida.

#### Scenario: Editar intenção
- **WHEN** o administrador altera uma intenção
- **THEN** o sistema atualiza o GPTMaker e o registro local

#### Scenario: Remover intenção
- **WHEN** o administrador remove uma intenção
- **THEN** o sistema remove no GPTMaker e marca o registro local como removido

#### Scenario: Agente removido
- **WHEN** o agente é removido
- **THEN** as intenções dele são marcadas como removidas localmente

### Requirement: Segredos nos cabeçalhos
Valores de cabeçalhos (tipicamente chaves de API do cliente) MUST ser cifrados no registro local e MUST NOT voltar ao navegador: a tela mostra apenas que há valor configurado, e manter o valor na edição não exige digitá-lo de novo.

#### Scenario: Editar intenção com cabeçalho secreto
- **WHEN** o administrador edita uma intenção sem alterar o valor de um cabeçalho
- **THEN** o sistema mantém o valor gravado e o reenvia ao GPTMaker

### Requirement: Isolamento e permissão
Intenções MUST pertencer a um agente do tenant da sessão e só o administrador do app MUST criar, editar ou remover. Intenções não têm limite por plano; o consumo de créditos das conversas que as usam é cobrado pelo débito por resposta e pela reconciliação diária.

#### Scenario: Agente de outro tenant
- **WHEN** a requisição cita um agente que não é do tenant da sessão
- **THEN** o sistema responde como agente inexistente
