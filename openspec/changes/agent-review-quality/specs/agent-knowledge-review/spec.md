## MODIFIED Requirements

### Requirement: Revisão por IA
O cliente MUST poder pedir "Revisar com IA" na tela da função, sobre as respostas que estão na tela (salvas ou não). A revisão MUST ler cada campo de texto, lista ou base preenchido usando o rótulo, a ajuda, o `review.rubric` e os `review.examples` do campo no template, e devolver, por item, os problemas encontrados (cada um com um texto curto, uma categoria e uma gravidade) e, quando couber, um texto sugerido. A revisão MUST também apontar contradições entre itens e entre respostas de campos diferentes, nomeando os campos envolvidos. O resultado MUST aparecer por campo à medida que fica pronto. A revisão MUST usar só o modelo fixo configurado no sistema, com a chave do cliente quando houver e a da CRMThink quando não houver. A revisão MUST NOT salvar nem publicar nada.

#### Scenario: Problema e sugestão num item
- **WHEN** a solução de um problema diz só "reinicie" e o roteiro do campo pede passos numerados
- **THEN** o item mostra o problema "solução sem passos que o cliente consiga seguir" e um texto sugerido em passos

#### Scenario: Contradição entre campos
- **WHEN** a política diz "trocas em até 7 dias" e uma resposta da FAQ diz "trocas em até 30 dias"
- **THEN** a revisão aponta a contradição citando os dois campos

#### Scenario: Resultado por partes
- **WHEN** a função tem 4 campos revisáveis preenchidos
- **THEN** cada campo mostra o resultado assim que fica pronto, sem esperar os outros

#### Scenario: Exemplos do template orientam a revisão
- **WHEN** o campo tem `review.examples` com um exemplo bom e um ruim
- **THEN** a revisão usa os dois como referência do que é um bom preenchimento, sem copiá-los para o item do cliente

## ADDED Requirements

### Requirement: Contexto de papel na revisão
A revisão por IA MUST informar à IA, em cada campo, como aquele tipo de campo é usado pelo agente: o texto de comportamento orienta o agente, cada item de base é consultado quando o cliente final faz uma pergunta parecida com o título, e a resposta de um item MUST bastar sozinha. A revisão MUST considerar problema, além de clareza e completude, o item que o agente não conseguiria usar assim, como título que não casa com perguntas reais, resposta que depende de outro item, política sem prazo ou condição e resposta longa demais para uma conversa. O contexto de papel MUST NOT permitir à IA inventar dado do negócio: a sugestão continua proibida de afirmar prazo, valor ou política que o cliente não escreveu.

#### Scenario: Título que não casa com a pergunta do cliente final
- **WHEN** um item de base tem o título "Procedimento 4B" e a resposta explica como pedir segunda via de boleto
- **THEN** o item mostra um problema de título que o agente não associaria à pergunta do cliente final, com um título sugerido

#### Scenario: Resposta que depende de outro item
- **WHEN** a resposta de um item diz "veja o item anterior"
- **THEN** o item mostra o problema de resposta que não se sustenta sozinha

#### Scenario: Sugestão sem dado inventado
- **WHEN** a política não informa o prazo de troca
- **THEN** a sugestão mantém o texto do cliente e o problema aponta que falta o prazo, sem a IA escolher um número

### Requirement: Contexto da função na revisão
A revisão de cada campo MUST levar à IA o que a função faz e, quando preenchida, a expectativa do cliente sobre o agente, além dos títulos dos itens dos outros campos de base. Com isso a revisão MUST apontar item repetido ou sobreposto a outro campo, informando o campo e o item. A revisão MUST NOT enviar o conteúdo completo de outros campos nessa chamada, só os títulos. O tamanho do contexto MUST ter um teto, e acima dele os títulos mais longos MUST ser cortados e nunca o texto do campo revisado.

#### Scenario: Item repetido em outro campo
- **WHEN** "Prazo de troca" existe como título nos campos "Políticas" e "Perguntas frequentes"
- **THEN** a revisão de "Perguntas frequentes" aponta o item como repetido em "Políticas"

#### Scenario: Função sem expectativa
- **WHEN** o cliente não preencheu "o que você espera do agente"
- **THEN** a revisão segue com o que a função faz, sem a expectativa

### Requirement: Categoria e gravidade dos problemas
Cada problema devolvido pela revisão por IA MUST ter uma categoria entre: `ambiguous` (ambíguo), `incomplete` (incompleto), `contradiction` (contraditório), `too_long` (longo demais), `missing_term` (sem prazo ou condição), `off_topic` (fora do assunto), `duplicate` (repetido) e `other` (outro), e uma gravidade entre `blocks` (atrapalha o agente) e `polish` (melhoria). A saída da IA com categoria ou gravidade desconhecida MUST ser normalizada para `other` e `polish`, sem descartar o problema. A tela MUST mostrar a categoria em pt-BR simples em cada problema, MUST listar os problemas `blocks` antes dos `polish` e, quando um item tiver mais de 3 problemas, MUST deixar os `polish` recolhidos com a opção de abrir. Itens com problema `blocks` MUST ser contados à parte no resumo da revisão.

#### Scenario: Ordem por gravidade
- **WHEN** um item tem um problema `polish` e um `blocks`
- **THEN** a tela mostra o `blocks` primeiro, cada um com a sua categoria

#### Scenario: Muitos problemas leves
- **WHEN** um item tem 5 problemas `polish` e 1 `blocks`
- **THEN** a tela mostra o `blocks` e uma opção "ver mais 5 sugestões de melhoria" com os `polish` recolhidos

#### Scenario: Categoria desconhecida
- **WHEN** a IA devolve a categoria "tom_de_voz"
- **THEN** o problema aparece como "outro", e a revisão do campo não falha

#### Scenario: Resumo com o que atrapalha
- **WHEN** a revisão termina com 2 itens com problema `blocks` e 5 só com `polish`
- **THEN** o resumo diz que 2 itens atrapalham o agente e 5 têm melhorias
