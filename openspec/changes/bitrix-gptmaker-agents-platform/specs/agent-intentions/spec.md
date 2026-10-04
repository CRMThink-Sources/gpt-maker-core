## ADDED Requirements

### Requirement: Cadastro de intenção
O sistema MUST permitir que o administrador do app cadastre intenções em um agente: a descrição do que o cliente final quer (quando o agente deve usar a intenção), os campos que o agente deve coletar na conversa (opcionais; cada um com nome, descrição opcional — sem ela o nome orienta o agente —, tipo `STRING` | `URL` | `DATE_TIME` | `DATE` | `NUMBER` | `BOOLEAN` e obrigatoriedade) e a chamada a ser feita (`GET` ou `POST`, URL, cabeçalhos, parâmetros e corpo, com geração automática opcional de parâmetros e corpo pelo agente). A intenção MUST ser criada no GPTMaker (`POST /agent/{id}/intentions`) e registrada localmente; o registro local é a fonte da verdade da tela.

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

### Requirement: Intenção com ações no Bitrix24
O sistema MUST permitir intenções do tipo "Ação no Bitrix24": em vez de uma API do cliente, a intenção executa no portal do tenant as mesmas ações dos gatilhos (criar lead, criar ou atualizar negócio, comentário na timeline, tarefa, processo de negócio), com o token do portal guardado pela plataforma, sem o cliente informar URL nem chave. Os textos das ações MUST aceitar os campos coletados pelo agente (`{{fields.<campo>}}`) além das variáveis dos gatilhos. No GPTMaker, a intenção aponta para um endpoint do app autenticado por um token próprio da intenção; o app executa as ações na hora e devolve ao agente um resultado em texto e JSON para ele responder ao cliente.

#### Scenario: Intenção cria lead durante a conversa
- **WHEN** o agente usa uma intenção Bitrix configurada para criar lead e o GPTMaker chama o endpoint com os campos coletados
- **THEN** o app cria o lead no portal do tenant com os campos preenchidos e responde ao GPTMaker que o lead foi criado, com o id

#### Scenario: Ação que depende do diálogo
- **WHEN** a ação precisa da entidade do CRM do atendimento (comentário na timeline, negócio do cliente) e a chamada identifica o chat
- **THEN** o app localiza o diálogo do Bitrix pelo chat do GPTMaker e usa a entidade vinculada a ele

#### Scenario: Transferir para atendente
- **WHEN** a intenção inclui a ação de transferir (operador livre da Linha Aberta ou usuário escolhido) e a chamada identifica a conversa
- **THEN** o app agenda a transferência, o agente responde ao cliente e, logo depois que a resposta é entregue, o diálogo passa para o atendente e o agente para de responder nele

#### Scenario: Chamada inválida ou portal indisponível
- **WHEN** o token não confere, a intenção está desativada ou removida, ou o portal está suspenso, desinstalado ou sem credencial
- **THEN** o app não executa nenhuma ação e responde com erro (token inválido) ou com uma mensagem para o agente explicar que não foi possível agora

#### Scenario: Chamada repetida
- **WHEN** o GPTMaker repete a mesma chamada (mesma intenção, chat e campos) em poucos minutos
- **THEN** o app devolve o resultado da primeira execução sem executar as ações de novo

#### Scenario: Histórico
- **WHEN** o administrador abre o histórico da intenção
- **THEN** o sistema mostra as execuções recentes com campos recebidos, resultado ou erro
