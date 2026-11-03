# agent-knowledge-gaps Specification

## Purpose
Mede se a base de conhecimento do agente cobre o que o cliente espera dele e propõe os itens que faltam, como rascunho para o cliente completar, sem inventar fatos do negócio.

## Requirements

### Requirement: Expectativa do agente
Na revisão por IA, o cliente MUST poder descrever, em texto livre, o que espera que o agente resolva (situações reais e perguntas que chegam). O campo MUST ser opcional: sem ele, a revisão por IA MUST funcionar como antes, sem a análise de cobertura. A expectativa MUST aceitar de 20 a 1000 caracteres e MUST NOT ser salva nem publicada: vive só na tela, como o resultado da revisão. O texto MUST ser tratado como dado a avaliar, nunca como instrução à IA.

#### Scenario: Revisão sem expectativa
- **WHEN** o cliente pede "Revisar com IA" sem preencher a expectativa
- **THEN** a revisão roda como antes e nenhuma análise de cobertura é feita nem cobrada

#### Scenario: Expectativa curta demais
- **WHEN** o cliente escreve "atender bem" (menos de 20 caracteres) e pede a revisão
- **THEN** a análise de cobertura não roda e a tela diz que a expectativa precisa descrever situações reais

#### Scenario: Expectativa não é guardada
- **WHEN** o cliente recarrega a tela depois de uma revisão com expectativa
- **THEN** o campo da expectativa vem vazio e as lacunas não aparecem

### Requirement: Análise de cobertura da base
Com a expectativa preenchida, a revisão por IA MUST, depois de revisar os campos, comparar a expectativa com a base de conhecimento do agente (todos os campos de base visíveis, inclusive os vazios) e devolver as **lacunas**: situações que o cliente espera e a base não cobre, cada uma com um título curto, o motivo e o campo de base onde o item novo caberia. A análise MUST também listar, só como informação, o que a base cobre e a expectativa não pediu. A análise MUST NOT salvar nem alterar nada. Uma falha na análise MUST NOT impedir o resultado da revisão dos campos.

#### Scenario: Lacuna encontrada
- **WHEN** a expectativa cita "cliente pedindo segunda via de boleto" e nenhum item da base trata de boleto
- **THEN** a análise aponta a lacuna "Segunda via de boleto" no campo "Problemas comuns", com o motivo

#### Scenario: Base vazia
- **WHEN** o campo "Políticas" está vazio e a expectativa cita trocas e devoluções
- **THEN** a análise aponta a lacuna no campo "Políticas", mesmo sem nenhum item nele

#### Scenario: Base já cobre a expectativa
- **WHEN** todos os pontos da expectativa têm item na base
- **THEN** a tela mostra "Nenhuma lacuna encontrada" e a lista do que a base cobre

#### Scenario: Falha só na cobertura
- **WHEN** a IA devolve a análise fora do formato duas vezes
- **THEN** a tela diz que a cobertura não pôde ser conferida e os resultados dos campos continuam visíveis

### Requirement: Sugestão de itens novos
Para cada lacuna, a análise MUST propor um rascunho de item com os subcampos do campo de base indicado, em pt-BR, e a tela MUST oferecer o botão "Adicionar", que insere o item novo no fim do campo no formulário, sem salvar nem publicar. O rascunho MUST respeitar os limites de caracteres de cada subcampo. O botão "Adicionar" MUST NOT aparecer quando o campo já está no máximo de itens ou quando o rascunho não passa nas regras de validação do campo; a lacuna aparece então só como leitura, dizendo o motivo. Uma lacuna que repete um item já existente (mesmo título, ignorando maiúsculas, acentos e pontuação) MUST NOT ser sugerida. Depois de adicionar, os avisos por regras fixas MUST ser recalculados e a lacuna MUST aparecer como adicionada.

#### Scenario: Adicionar item sugerido
- **WHEN** o cliente clica em "Adicionar" na lacuna "Segunda via de boleto"
- **THEN** o item entra no fim de "Problemas comuns", o formulário fica com alterações não salvas e a lacuna mostra "Adicionado"

#### Scenario: Campo cheio
- **WHEN** o campo "Políticas" já tem o máximo de itens
- **THEN** a lacuna aparece só como leitura, dizendo que o campo está cheio

#### Scenario: Item que já existe
- **WHEN** a IA sugere "Prazo de entrega" e a base já tem um item com esse título
- **THEN** a sugestão não aparece

### Requirement: Fatos que só o cliente sabe
O rascunho de item MUST NOT afirmar prazo, valor, condição, política, horário ou qualquer dado do negócio que não esteja no texto do cliente (nas respostas ou na expectativa). Cada trecho que depende desse dado MUST sair como marcador `[preencher: <o que falta>]`. O item adicionado com marcador pendente MUST gerar aviso de atenção no campo, apontando o item. A publicação e a criação do agente MUST ser recusadas enquanto houver marcador `[preencher: …]` em qualquer resposta de texto, lista ou base, dizendo quais campos e itens; salvar rascunho MUST seguir permitido.

#### Scenario: Rascunho com marcador
- **WHEN** a IA propõe o item "Política de troca" e a expectativa não informa o prazo
- **THEN** o texto traz "[preencher: prazo de troca em dias]" no lugar do prazo

#### Scenario: Publicar com marcador pendente
- **WHEN** o cliente tenta publicar com um item que ainda contém "[preencher: …]"
- **THEN** a publicação é recusada, a tela aponta o campo e o item, e o agente não muda

#### Scenario: Salvar rascunho com marcador
- **WHEN** o cliente salva o rascunho com o marcador pendente
- **THEN** o rascunho é salvo normalmente

#### Scenario: Marcador preenchido
- **WHEN** o cliente troca o marcador pelo prazo real e publica
- **THEN** o aviso some e a publicação segue

### Requirement: Cobrança e limites da cobertura
A análise de cobertura MUST custar o mesmo valor de um campo revisado e MUST usar a mesma escolha de chave da revisão: com a chave do cliente, nada é debitado; com a chave da CRMThink, o débito é feito depois de uma saída válida, aparece no extrato como "Revisão da função" e nunca é feito duas vezes para a mesma revisão. Antes de chamar a IA com a chave da CRMThink, o sistema MUST conferir o saldo; sem saldo, a análise não roda e a tela mostra que os créditos acabaram. Análise que falhou MUST NOT ser cobrada. O botão "Revisar com IA" MUST mostrar o custo somando a análise quando a expectativa estiver preenchida. A análise MUST seguir os limites por cliente e o limite global da chave da CRMThink da revisão por IA.

#### Scenario: Custo com expectativa
- **WHEN** o cliente sem chave própria preenche a expectativa e a revisão tem 4 campos a 2 créditos
- **THEN** o botão mostra 10 créditos (4 campos e a cobertura)

#### Scenario: Chave do cliente
- **WHEN** o cliente tem chave própria e pede a revisão com expectativa
- **THEN** nenhum crédito é debitado

#### Scenario: Sem saldo para a cobertura
- **WHEN** os créditos acabam depois da revisão dos campos
- **THEN** os campos mantêm o resultado e a cobertura mostra que os créditos acabaram, sem chamar a IA

#### Scenario: Cobertura repetida
- **WHEN** a análise de cobertura da mesma revisão chega duas vezes
- **THEN** só a primeira é feita e cobrada
