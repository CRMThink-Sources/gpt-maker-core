# Spec Delta

## Purpose

Configuração do agente pelo cliente a partir de uma função: o cliente responde ao formulário sobre o negócio e o sistema compila e publica no GPT Maker o comportamento, os treinamentos, as intenções e os settings, sem que o cliente escreva instruções.

## ADDED Requirements

### Requirement: Uma função por agente
Todo agente MUST ter exatamente uma função, escolhida na criação entre os templates publicados. A função MUST NOT ser trocada depois da criação; para outra função o cliente cria outro agente.

#### Scenario: Criação com função
- **WHEN** o administrador do app cria um agente escolhendo a função Suporte
- **THEN** o agente fica vinculado ao template Suporte e o formulário exibido é o dessa função

#### Scenario: Troca de função
- **WHEN** o cliente tenta alterar a função de um agente existente
- **THEN** o sistema recusa e orienta a criar outro agente

### Requirement: Respostas do formulário
O sistema MUST guardar as respostas do formulário do agente como rascunho até a publicação, validando-as contra a definição do formulário da versão do template em uso (obrigatoriedade, limites de caracteres e de itens, campos dependentes, URLs). O formulário MUST exibir, enquanto o cliente preenche, a contagem de caracteres do comportamento resultante frente ao limite de 3000.

#### Scenario: Salvar rascunho
- **WHEN** o cliente preenche parte do formulário e salva
- **THEN** as respostas ficam guardadas e o agente publicado no GPT Maker não muda

#### Scenario: Resposta inválida
- **WHEN** o cliente informa uma lista com mais itens que o permitido ou um texto acima do limite
- **THEN** o sistema recusa apontando o campo, sem publicar

### Requirement: Compilação
O sistema MUST compilar o agente a partir da versão do template e das respostas: comportamento (texto do template com os marcadores substituídos), um treinamento de texto por item da base de conhecimento, as intenções e os settings derivados da função e das escolhas. A compilação MUST ser determinística: as mesmas respostas e a mesma versão produzem o mesmo resultado. Se o comportamento compilado passar de 3000 caracteres, a compilação MUST falhar listando o que excede, sem truncar.

#### Scenario: Compilar SDR
- **WHEN** o cliente com agente SDR pede a prévia com as respostas preenchidas
- **THEN** o sistema produz o comportamento com o perfil, as perguntas de qualificação e os trechos das escolhas, um treinamento por produto, objeção e pergunta frequente, a intenção de qualificação e `type` = `SALE`

#### Scenario: Comportamento acima do limite
- **WHEN** as respostas e as instruções adicionais somam mais de 3000 caracteres no comportamento
- **THEN** a compilação falha mostrando quanto excede e quais campos mais contribuem

### Requirement: Prévia e publicação
Antes de gravar no GPT Maker, o sistema MUST mostrar a prévia da publicação: diferenças do comportamento em relação ao publicado, treinamentos a criar, atualizar e remover, intenções a criar, atualizar e remover, e settings alterados. A publicação MUST acontecer só após confirmação do cliente. A publicação MUST ser idempotente e retomável: se falhar no meio, o agente fica com a publicação pendente, o cliente é avisado e pode repetir, e a repetição aplica só o que falta.

#### Scenario: Publicar
- **WHEN** o cliente confirma a prévia
- **THEN** o sistema atualiza comportamento e settings, cria, atualiza ou remove os treinamentos e intenções gerenciados no GPT Maker, e registra a versão do template e as respostas como a configuração publicada

#### Scenario: Falha parcial
- **WHEN** o GPT Maker falha depois de parte dos treinamentos ter sido criada
- **THEN** o agente fica marcado com publicação pendente, o cliente vê o erro com identificador de rastreio e, ao repetir, o sistema não duplica os treinamentos já criados

#### Scenario: Nada mudou
- **WHEN** a prévia não tem diferenças em relação ao publicado
- **THEN** o sistema informa que não há alterações e não chama o GPT Maker

### Requirement: Versão fixada e aviso de versão nova
Cada agente MUST guardar a versão do template com que foi publicado. Publicar uma nova versão do template MUST NOT alterar agentes. Quando existir versão mais recente, o agente MUST exibir o aviso de versão nova com o diff do comportamento; republicar MUST usar sempre a versão mais recente. Se a versão nova exigir campo que o agente não respondeu, a republicação MUST pedir esse campo antes da prévia.

#### Scenario: Template atualizado
- **WHEN** o template Suporte ganha a versão 5 e um agente está na versão 4
- **THEN** o agente continua igual no GPT Maker e mostra o aviso de versão nova com o diff

#### Scenario: Republicar com campo novo
- **WHEN** o cliente republica e a versão 5 tem um campo obrigatório novo
- **THEN** o formulário pede o campo novo antes de mostrar a prévia

### Requirement: Base de conhecimento estruturada
No modo simples, a base de conhecimento do agente MUST vir só dos itens estruturados do formulário (ex.: produtos, perguntas frequentes, políticas, problemas comuns). Cada item MUST virar um treinamento de texto de no máximo 1028 caracteres, com o vínculo item ↔ treinamento guardado. Editar um item MUST atualizar apenas o treinamento correspondente; remover um item MUST remover o treinamento. Os treinamentos gerados MUST contar no limite de treinamentos do plano.

#### Scenario: Editar um item
- **WHEN** o cliente altera a resposta de uma pergunta frequente e publica
- **THEN** só o treinamento daquela pergunta é atualizado no GPT Maker

#### Scenario: Limite do plano
- **WHEN** a publicação criaria mais treinamentos do que o plano permite
- **THEN** a prévia aponta o excesso e a publicação é recusada com `PLAN_TRAINING_LIMIT`

### Requirement: Intenções e settings gerenciados
As intenções e os settings derivados da função MUST ser gerenciados pela compilação. Toda função MUST gerar a intenção "Registrar dúvida" (coleta a pergunta e o motivo, registra conforme "onde registrar" e segue o escalonamento escolhido) e, quando alguma escolha transferir, a intenção "Transferir para atendente". O comportamento de toda função MUST instruir o agente a usar "Registrar dúvida" quando a informação não estiver na base, em vez de deduzir. Além disso:
- SDR MUST gerar a intenção de qualificação, cujos campos são as perguntas de qualificação, que registra as respostas e executa a escolha para lead qualificado;
- Suporte MUST gerar a intenção "Abrir chamado" (tarefa ou negócio no funil escolhido) quando o escalonamento envolver chamado;
- Agendamento MUST gerar a intenção "Enviar link de agenda", que registra conforme a escolha e devolve o link do serviço; os pares serviço → link MUST ficar no comportamento;
- Pós-venda MUST gerar as intenções "Registrar avaliação positiva" e "Registrar avaliação negativa" quando coletar avaliação, com corte fixo (0–6 no NPS; 1–2 na escala de 1 a 5).

#### Scenario: Registrar dúvida
- **WHEN** o agente de Suporte não encontra a resposta na base e usa a intenção "Registrar dúvida"
- **THEN** a pergunta e o motivo são registrados no Bitrix24 conforme "onde registrar" e o escalonamento escolhido é executado

#### Scenario: Qualificação registrada
- **WHEN** o agente SDR conclui que o lead é qualificado e usa a intenção de qualificação com as respostas coletadas
- **THEN** as respostas são comentadas no registro vinculado à conversa (ou no negócio do funil escolhido) e a conversa é transferida, se essa foi a escolha

#### Scenario: Avaliação negativa
- **WHEN** o cliente final dá nota 5 no NPS a um agente de Pós-venda
- **THEN** o agente usa "Registrar avaliação negativa", que comenta a nota e executa a escolha para avaliação baixa

### Requirement: Modo avançado
O cliente MUST poder ligar o modo avançado do agente após confirmar um aviso. O modo avançado MUST liberar: instruções adicionais de até 400 caracteres, anexadas ao fim do comportamento compilado; e treinamentos por site e por vídeo, além dos itens estruturados. Desligar o modo avançado MUST remover as instruções adicionais e os treinamentos por site e vídeo na próxima publicação, após aviso.

#### Scenario: Ligar o modo avançado
- **WHEN** o cliente confirma o aviso e liga o modo avançado
- **THEN** o formulário passa a exibir as instruções adicionais e a tela de treinamentos libera site e vídeo

#### Scenario: Desligar o modo avançado
- **WHEN** o cliente desliga o modo avançado e publica
- **THEN** a prévia lista a remoção das instruções adicionais e dos treinamentos por site e vídeo, e a publicação os remove

### Requirement: Assumir controle
Só tenants marcados como parceiros no backoffice MUST poder assumir o controle de um agente. Assumir o controle MUST copiar o comportamento compilado atual para edição livre (até 3000 caracteres) e tirar o agente do versionamento: sem aviso de versão nova e sem recompilação. O parceiro MUST poder voltar ao formulário, após aviso de que as edições do comportamento serão perdidas; a volta recompila a partir das respostas guardadas e da versão mais recente do template.

#### Scenario: Tenant não parceiro
- **WHEN** um tenant que não é parceiro tenta assumir o controle
- **THEN** a opção não é exibida e a API recusa a ação

#### Scenario: Assumir e editar
- **WHEN** um parceiro assume o controle e edita o comportamento
- **THEN** a publicação grava o comportamento editado e o agente deixa de receber aviso de versão nova

#### Scenario: Voltar ao formulário
- **WHEN** o parceiro confirma a volta ao formulário
- **THEN** as edições do comportamento são descartadas e a prévia mostra o agente recompilado pela versão mais recente do template
