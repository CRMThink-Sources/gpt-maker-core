## ADDED Requirements

### Requirement: Avisos da revisão no formulário da função
O formulário da função MUST mostrar os avisos por regras fixas (spec `agent-knowledge-review`) no próprio campo, item ou subcampo, atualizados enquanto o cliente preenche. Um resumo no topo MUST mostrar a quantidade de avisos por gravidade e levar ao campo de cada um. Por campo, o formulário MUST mostrar no máximo 3 avisos, `attention` antes de `hint`, com "ver mais" para o resto.

#### Scenario: Aviso aparece ao digitar
- **WHEN** o cliente digita no campo um texto igual ao exemplo do campo
- **THEN** o aviso "exemplo copiado" aparece no campo, sem precisar salvar

#### Scenario: Muitos avisos num campo
- **WHEN** um campo tem 5 avisos
- **THEN** aparecem os 3 mais graves e "ver mais 2"

### Requirement: Confirmação ao publicar com avisos
Ao publicar uma função com avisos `attention`, o app MUST mostrar um resumo "N pontos de atenção", com o link para cada um e as escolhas "Revisar" e "Publicar mesmo assim". Com só avisos `hint` ou nenhum aviso, a publicação MUST seguir sem essa confirmação.

#### Scenario: Publicar com pontos de atenção
- **WHEN** a função tem 2 avisos `attention` e o cliente clica em "Publicar"
- **THEN** o app mostra "2 pontos de atenção" e só publica se o cliente escolher "Publicar mesmo assim"

#### Scenario: Publicar sem pontos de atenção
- **WHEN** a função tem só avisos `hint`
- **THEN** a publicação segue sem confirmação extra

### Requirement: Revisão por IA na tela da função
A tela da função MUST ter o botão "Revisar com IA". Sem chave própria do cliente, o botão MUST mostrar o custo em créditos (valor por campo × campos revisáveis preenchidos) e, ao lado, que o texto vai para o Vibecode; clicar inicia a revisão sem confirmação extra. Com chave própria, o botão MUST indicar que a revisão não usa créditos. O custo MUST ser recalculado quando o cliente preenche ou esvazia um campo revisável. Durante a revisão, cada campo MUST mostrar que está sendo revisado e depois o resultado (problemas, sugestões com "Aplicar" e falhas), junto dos avisos por regras fixas. O resultado da revisão MUST NOT ser guardado: sair da tela o descarta. Editar um campo depois da revisão MUST marcar o resultado daquele campo como desatualizado.

#### Scenario: Custo no botão
- **WHEN** o cliente não tem chave própria, o valor é 2 créditos por campo e há 5 campos revisáveis preenchidos
- **THEN** o botão mostra "Revisar com IA · 10 créditos"

#### Scenario: Chave própria no botão
- **WHEN** o cliente tem chave própria salva
- **THEN** o botão mostra "Revisar com IA" com a indicação "sem uso de créditos"

#### Scenario: Revisão em andamento
- **WHEN** o cliente clica em "Revisar com IA"
- **THEN** cada campo revisável mostra "revisando…" até o resultado dele chegar

#### Scenario: Campo editado depois da revisão
- **WHEN** o cliente altera um item já revisado
- **THEN** o resultado daquele campo aparece como desatualizado, com a opção de revisar o campo de novo
