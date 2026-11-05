# agent-knowledge-review Specification

## Purpose
Diz ao cliente se o preenchimento da função e a base de conhecimento do agente estão bons para atender: avisos por regras fixas para todos e uma leitura por IA com problemas e texto sugerido por item, pela chave Vibecode do cliente ou pela da CRMThink, cobrada em créditos.

## Requirements

### Requirement: Avisos por regras fixas
O sistema MUST gerar avisos sobre as respostas da função, sem IA, para todos os clientes. Cada aviso MUST indicar o campo e, quando houver, o item e o subcampo, além de um código, uma gravidade (`attention` ou `hint`) e uma mensagem em pt-BR simples. As regras MUST ser:
- **poucos itens** (`attention`): uma lista ou base com menos itens que o `review.recommendedItems` do campo, inclusive vazia;
- **texto curto** (`hint`): um texto ou subcampo com menos caracteres que o seu `review.minLength`;
- **exemplo copiado** (`attention`): um texto ou item igual ao `placeholder` do campo, ignorando maiúsculas e espaços;
- **itens repetidos** (`attention`): dois itens do mesmo campo iguais depois de normalizados (minúsculas, sem acentos, pontuação nem espaços repetidos);
- **perto do limite** (`hint`): um texto acima de 90% do limite de caracteres;
- **mesmo campo do SPA para dois valores** (`attention`): dois valores de um campo de processo inteligente ligados ao mesmo campo do portal;
- **opções do SPA ligadas pela metade** (`attention`): um valor com opções em que parte das opções está ligada a itens da lista e parte não.
Os avisos MUST NOT impedir salvar nem publicar. Um campo sem `review.recommendedItems` MUST NOT gerar aviso por estar vazio. Campos e opções ocultos (dependentes de opção não escolhida) MUST NOT gerar aviso.

#### Scenario: Base de problemas rasa
- **WHEN** o campo "Problemas comuns" tem `review.recommendedItems: 3` e o cliente preencheu 1 item
- **THEN** aparece o aviso `attention` "poucos itens" no campo, dizendo que o recomendado são 3

#### Scenario: FAQ opcional vazia
- **WHEN** o campo "Perguntas frequentes" não tem `review` e está vazio
- **THEN** nenhum aviso é gerado para esse campo

#### Scenario: Itens repetidos
- **WHEN** a base tem os problemas "Não consigo entrar" e "não consigo  entrar!"
- **THEN** aparece o aviso "itens repetidos" apontando os dois itens

#### Scenario: Mesmo campo do SPA para dois valores
- **WHEN** o cliente liga "Problema relatado" e "Origem" ao mesmo campo do SPA
- **THEN** aparece o aviso `attention` nos dois valores

#### Scenario: Aviso não bloqueia
- **WHEN** a função tem avisos `attention` e o cliente publica
- **THEN** a publicação segue normalmente

### Requirement: Chave de IA do cliente (Vibecode)
O cliente MUST poder informar, salvar, trocar e remover uma chave `vibe_api_…` do Vibecode do Bitrix24 para a revisão por IA. Ao salvar, o sistema MUST testar a chave no Vibecode e recusar a chave, dizendo o motivo, quando ela for inválida, não tiver o escopo `vibe:ai` ou não tiver acesso ao modelo usado pela revisão. A chave MUST ficar cifrada em repouso e MUST NOT voltar à tela nem às respostas da API depois de salva: a tela mostra só que há chave, os últimos 4 caracteres e quando foi testada. A tela de configuração MUST avisar que o texto da função e da base vai para o Vibecode, e orientar a criar a chave só com o escopo `vibe:ai`. A chave do cliente é opcional: sem ela, a revisão por IA usa a chave da CRMThink (requisito "Revisão com a chave da CRMThink").

#### Scenario: Chave válida
- **WHEN** o cliente salva uma chave com o escopo `vibe:ai` e acesso ao modelo da revisão
- **THEN** a chave é salva e a tela mostra "chave configurada, final 1a2b, testada agora"

#### Scenario: Chave sem o escopo de IA
- **WHEN** o Vibecode responde `scope_missing` ao teste
- **THEN** a chave não é salva e a tela diz que a chave precisa do escopo `vibe:ai`

#### Scenario: Chave não volta à tela
- **WHEN** o cliente abre de novo a configuração
- **THEN** o campo da chave vem vazio, com a indicação de que há chave salva e o final dela

#### Scenario: Remover a chave
- **WHEN** o cliente remove a chave salva
- **THEN** as próximas revisões usam a chave da CRMThink e passam a debitar créditos

### Requirement: Revisão com a chave da CRMThink
Sem chave do cliente, a revisão por IA MUST usar a chave Vibecode da CRMThink, em todos os planos, e debitar créditos do app: um valor fixo por campo revisado com sucesso, definido pela CRMThink. A chamada de contradições entre campos MUST NOT ser cobrada à parte. Campo que falhou ou não foi revisado MUST NOT ser cobrado. O mesmo campo de uma mesma revisão MUST NOT ser cobrado duas vezes, mesmo com nova tentativa. Antes de revisar cada campo, o sistema MUST conferir o saldo: sem saldo para o campo, o campo não é revisado e mostra que os créditos acabaram, com o caminho para adicionar créditos. O débito MUST aparecer no extrato de créditos como "Revisão da função", com o agente. Com a chave do cliente, a revisão MUST NOT debitar créditos. Com a chave do cliente salva e falhando, a revisão MUST NOT passar para a chave da CRMThink sozinha. Sem a chave da CRMThink configurada no sistema, quem não tem chave própria MUST ver o botão desativado, com o caminho para configurar a chave própria.

#### Scenario: Revisão cobrada por campo
- **WHEN** o cliente sem chave própria revisa 4 campos, o valor é 2 créditos por campo e 1 campo falha
- **THEN** são debitados 6 créditos, e o extrato mostra "Revisão da função" com o agente

#### Scenario: Créditos acabam no meio
- **WHEN** o saldo cobre só 2 dos 4 campos
- **THEN** 2 campos são revisados e cobrados, e os outros 2 mostram que os créditos acabaram

#### Scenario: Nova tentativa não cobra de novo
- **WHEN** o backend repete a chamada de um campo por sobrecarga do Vibecode
- **THEN** o campo é cobrado uma vez só

#### Scenario: Chave do cliente não cobra
- **WHEN** o cliente tem chave própria salva e revisa 4 campos
- **THEN** nenhum crédito é debitado

#### Scenario: Chave do cliente falhando
- **WHEN** a chave do cliente responde `insufficient_balance`
- **THEN** o campo mostra que a conta do Vibecode do cliente ficou sem saldo, e a revisão não usa a chave da CRMThink

### Requirement: Uso compartilhado da chave da CRMThink
O sistema MUST limitar o uso da chave da CRMThink no total, entre todos os clientes, abaixo do limite por minuto do Vibecode, além do limite por cliente. No limite total, o campo MUST esperar um pouco e, se continuar no limite, mostrar "muitas revisões agora, tente em instantes", sem cobrar.

#### Scenario: Pico de revisões
- **WHEN** vários clientes revisam ao mesmo tempo e o limite total é atingido
- **THEN** os campos excedentes mostram "muitas revisões agora, tente em instantes" e não são cobrados

### Requirement: Revisão por IA
O cliente MUST poder pedir "Revisar com IA" na tela da função, sobre as respostas que estão na tela (salvas ou não). A revisão MUST ler cada campo de texto, lista ou base preenchido usando o rótulo, a ajuda e o `review.rubric` do campo no template, e devolver, por item, os problemas encontrados (cada um com um texto curto) e, quando couber, um texto sugerido. A revisão MUST também apontar contradições entre itens e entre respostas de campos diferentes, nomeando os campos envolvidos. O resultado MUST aparecer por campo à medida que fica pronto. A revisão MUST usar só o modelo fixo configurado no sistema, com a chave do cliente quando houver e a da CRMThink quando não houver. A revisão MUST NOT salvar nem publicar nada.

#### Scenario: Problema e sugestão num item
- **WHEN** a solução de um problema diz só "reinicie" e o roteiro do campo pede passos numerados
- **THEN** o item mostra o problema "solução sem passos que o cliente consiga seguir" e um texto sugerido em passos

#### Scenario: Contradição entre campos
- **WHEN** a política diz "trocas em até 7 dias" e uma resposta da FAQ diz "trocas em até 30 dias"
- **THEN** a revisão aponta a contradição citando os dois campos

#### Scenario: Resultado por partes
- **WHEN** a função tem 4 campos revisáveis preenchidos
- **THEN** cada campo mostra o resultado assim que fica pronto, sem esperar os outros

### Requirement: Aplicar texto sugerido
Cada texto sugerido MUST ter o botão "Aplicar", que troca o texto do item ou do subcampo no formulário, sem salvar nem publicar. A sugestão MUST passar pelas mesmas regras de validação do campo (limite de caracteres e obrigatórios). Uma sugestão que não passe MUST NOT ter o botão "Aplicar". Depois de aplicar, os avisos por regras fixas MUST ser recalculados.

#### Scenario: Aplicar sugestão
- **WHEN** o cliente clica em "Aplicar" na sugestão de um item
- **THEN** o texto do item no formulário passa a ser o sugerido, e o formulário fica com alterações não salvas

#### Scenario: Sugestão acima do limite
- **WHEN** a sugestão tem 900 caracteres e o subcampo aceita 850
- **THEN** a sugestão aparece só como leitura, sem o botão "Aplicar"

### Requirement: Falhas da revisão por IA
Uma falha num campo MUST NOT impedir o resultado dos outros campos. Cada falha MUST virar uma mensagem em pt-BR simples, no campo ou na revisão:
- chave do cliente inválida ou sem o escopo `vibe:ai`: pedir para revisar a chave na configuração;
- saldo ou cota esgotados na conta Vibecode do cliente: dizer que a conta do Vibecode ficou sem saldo ou cota;
- falha da chave da CRMThink (inválida, sem saldo ou cota): dizer que a revisão por IA está fora do ar e pode ser tentada mais tarde, sem expor detalhes da conta da CRMThink;
- modelo indisponível: dizer que a revisão por IA está fora do ar e pode ser tentada mais tarde;
- resposta da IA fora do formato esperado, mesmo depois de uma nova tentativa: dizer que aquele campo não pôde ser revisado.
Sobrecarga e tempo esgotado no Vibecode MUST ser tentados de novo automaticamente antes de virar mensagem.

#### Scenario: Saldo esgotado no meio da revisão
- **WHEN** o Vibecode responde `insufficient_balance` no terceiro campo
- **THEN** os campos já revisados mantêm o resultado e os restantes mostram que a conta do Vibecode ficou sem saldo

#### Scenario: Resposta fora do formato
- **WHEN** a IA devolve um texto que não segue o formato, duas vezes seguidas, para um campo
- **THEN** esse campo mostra que não pôde ser revisado e os demais seguem
