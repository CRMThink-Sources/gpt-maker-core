## Purpose

Permite a quem gerencia agentes conversar com o agente dentro do app para testá-lo, com histórico de conversas de teste por agente, cliente do CRM simulado opcional e consumo de créditos igual ao das conversas reais.

## ADDED Requirements

### Requirement: Iniciar conversa de teste
O sistema MUST permitir a quem gerencia agentes iniciar uma conversa de teste com um agente ativo de um tenant ativo. Cada conversa MUST ter um contexto próprio no GPTMaker, nunca reutilizado por outra conversa, para que o agente não lembre de testes anteriores. Ao iniciar, o testador MAY escolher um contato, lead ou empresa do CRM do próprio portal como cliente simulado. Cada agente MUST manter no máximo 50 conversas de teste; ao criar a 51ª, a mais antiga é excluída.

#### Scenario: Nova conversa sem cliente
- **WHEN** o administrador clica em "Nova conversa" no teste de um agente ativo
- **THEN** uma conversa vazia é criada e listada como a mais recente, sem cliente simulado

#### Scenario: Nova conversa com cliente simulado
- **WHEN** o administrador inicia a conversa escolhendo o contato "Maria Souza" do CRM
- **THEN** a conversa guarda Maria Souza como cliente simulado e mostra o nome dela no cabeçalho da conversa

#### Scenario: Agente inativo
- **WHEN** o administrador tenta iniciar ou continuar uma conversa de teste de um agente inativo
- **THEN** o sistema recusa e informa que o agente precisa estar ativo para ser testado

#### Scenario: Limite de conversas
- **WHEN** um agente já tem 50 conversas de teste e uma nova é criada
- **THEN** a conversa mais antiga do agente é excluída e a nova é criada

### Requirement: Conversar com o agente
O testador MUST poder enviar mensagens de texto (até 4.000 caracteres) e receber a resposta do agente na mesma conversa, na ordem. Enquanto uma resposta está sendo gerada, a mesma conversa MUST NOT aceitar outra mensagem. Falha ou demora do GPTMaker MUST resultar em erro recuperável na conversa, sem resposta registrada e sem débito; a mensagem do testador fica registrada como não respondida e pode ser reenviada.

#### Scenario: Pergunta e resposta
- **WHEN** o testador envia "Quais planos vocês têm?"
- **THEN** a mensagem e a resposta do agente aparecem na conversa e ficam guardadas no histórico

#### Scenario: Envio simultâneo na mesma conversa
- **WHEN** o testador tenta enviar uma segunda mensagem antes de a primeira ser respondida
- **THEN** o sistema recusa a segunda mensagem e informa que a resposta anterior ainda está sendo gerada

#### Scenario: GPTMaker indisponível
- **WHEN** o GPTMaker não responde dentro do tempo limite
- **THEN** a conversa mostra que o agente não respondeu, nada é debitado e o testador pode tentar de novo

### Requirement: Créditos no teste
Cada resposta de teste entregue MUST debitar o custo vigente do modelo do agente, uma única vez por mensagem, como uma resposta real. Com saldo zerado ou negativo, o envio MUST ser recusado antes de chamar o GPTMaker, com aviso de saldo insuficiente. O modal MUST informar que o teste consome créditos.

#### Scenario: Resposta debitada
- **WHEN** o agente responde uma mensagem de teste usando um modelo de custo 2 créditos
- **THEN** o saldo do tenant diminui 2 créditos e o lançamento identifica a resposta de teste

#### Scenario: Sem saldo
- **WHEN** o tenant está sem créditos e o testador envia uma mensagem
- **THEN** o sistema recusa com aviso de saldo insuficiente, sem chamar o GPTMaker e sem debitar

### Requirement: Listar, reabrir e excluir conversas
O sistema MUST listar as conversas de teste do agente da mais recente para a mais antiga, com data, cliente simulado (quando houver) e trecho da última mensagem, e permitir reabrir qualquer uma com o histórico completo. O testador MUST poder excluir uma conversa; a exclusão remove o histórico do app e o contexto dela nunca volta a ser usado. Conversas MUST ser isoladas por tenant e por agente.

#### Scenario: Reabrir conversa
- **WHEN** o administrador abre uma conversa de teste anterior
- **THEN** o histórico completo aparece e ele pode continuar a conversa, com o agente lembrando das mensagens anteriores

#### Scenario: Excluir conversa
- **WHEN** o administrador exclui uma conversa de teste
- **THEN** ela some da lista e do banco, e uma nova conversa nunca reaproveita o contexto dela

#### Scenario: Conversa de outro tenant
- **WHEN** alguém tenta abrir, enviar mensagem ou excluir uma conversa de teste de outro tenant ou de outro agente
- **THEN** o sistema responde como conversa inexistente

### Requirement: Permissão para testar
Só usuários que gerenciam agentes (administrador do portal ou usuário autorizado) MUST poder ver, criar, usar e excluir conversas de teste. O botão "Testar" MUST NOT aparecer para quem só tem leitura.

#### Scenario: Usuário somente leitura
- **WHEN** um usuário sem permissão de gerenciar abre a página do agente
- **THEN** o botão "Testar" não aparece e as rotas de teste recusam o acesso

### Requirement: Teste não altera o CRM nem dispara automações
Conversas de teste MUST NOT disparar gatilhos de eventos do agente nem executar ações de intenções no Bitrix24 (criar lead, atualizar negócio, comentário, tarefa, processo de negócio, transferência para atendente). Nas intenções com ações no Bitrix, o sistema MUST responder ao agente como simulação, listando as ações que seriam executadas, para o testador ver o fluxo sem efeito no portal. Consultas somente leitura ao CRM continuam funcionando.

#### Scenario: Gatilho não dispara
- **WHEN** um agente com gatilho "criar lead ao finalizar o atendimento" encerra uma conversa de teste
- **THEN** o evento é recebido, mas nenhum lead é criado e nenhuma execução de gatilho é registrada

#### Scenario: Intenção com ação no Bitrix
- **WHEN** numa conversa de teste o agente usa uma intenção que cria um negócio e transfere para um atendente
- **THEN** nada é criado nem transferido, e o agente recebe a resposta de que, em teste, as ações "negócio registrado" e "transferência para um atendente" seriam executadas
