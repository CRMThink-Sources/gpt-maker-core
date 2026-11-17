## Purpose

Torna a lista de treinamentos de um agente utilizável com muitos itens: carrega por páginas e deixa o cliente buscar e filtrar por tipo, estado e tags.

## ADDED Requirements

### Requirement: Listagem paginada
O sistema MUST devolver os treinamentos não removidos do agente por páginas, na ordem de criação (mais antigos primeiro, como hoje), com tamanho de página padrão de 20 e máximo de 100. A resposta MUST informar a página atual, o tamanho, o total de itens que atendem aos filtros e o total de páginas. Página além do fim MUST devolver lista vazia, sem erro. Tamanho de página ou número de página inválidos MUST ser recusados.

#### Scenario: Primeira página
- **WHEN** o agente tem 45 treinamentos e o usuário abre a lista sem informar página
- **THEN** a resposta traz os 20 primeiros, página 1, total 45 e 3 páginas

#### Scenario: Última página
- **WHEN** o usuário pede a página 3 com tamanho 20
- **THEN** a resposta traz os 5 últimos itens

#### Scenario: Página além do fim
- **WHEN** o usuário pede a página 9 de uma lista de 3 páginas
- **THEN** a resposta traz lista vazia com o total correto

#### Scenario: Tamanho inválido
- **WHEN** o usuário pede tamanho de página 500
- **THEN** o sistema recusa o pedido

### Requirement: Filtros da listagem
O sistema MUST permitir filtrar a listagem por: busca textual (no texto, no endereço e no nome do documento, sem diferenciar maiúsculas de minúsculas), tipo (um ou mais), estado (um ou mais, incluindo expirado e com falha) e tags (treinamento que tenha pelo menos uma das tags informadas). Filtros diferentes combinados MUST valer todos ao mesmo tempo. O total e a paginação MUST refletir os filtros. Sem filtro de estado, a lista MUST mostrar todos os estados, inclusive expirados.

#### Scenario: Busca por texto
- **WHEN** o usuário busca "garantia"
- **THEN** só aparecem treinamentos cujo texto, endereço ou nome de documento contenham "garantia"

#### Scenario: Filtro por tags
- **WHEN** o usuário filtra pelas tags "preços" e "horários"
- **THEN** aparecem os treinamentos que tenham "preços" ou "horários"

#### Scenario: Filtros combinados
- **WHEN** o usuário filtra por tipo site, estado expirado e a tag "promo"
- **THEN** aparecem só os sites expirados com a tag "promo", e o total conta só esses

#### Scenario: Nenhum resultado
- **WHEN** nenhum treinamento atende aos filtros
- **THEN** a tela informa que nada foi encontrado e oferece limpar os filtros

#### Scenario: Agente de outro tenant
- **WHEN** alguém lista os treinamentos de um agente de outro tenant
- **THEN** o sistema responde como se o agente não existisse

### Requirement: Tela de treinamentos com filtros e paginação
A tela de treinamentos do agente MUST mostrar a barra de busca, os filtros de tipo, estado e tags, o controle de páginas e o total de itens. Mudar um filtro MUST voltar à página 1. A página, os filtros e a busca MUST ficar no endereço da tela, para sobreviver a recarregar e permitir compartilhar o link. Cada item MUST mostrar suas tags e, quando houver, a expiração (data futura) ou o selo "Expirado". O uso do plano (treinamentos e armazenamento) MUST continuar mostrando o total do tenant, independente dos filtros.

#### Scenario: Mudar de filtro volta à primeira página
- **WHEN** o usuário está na página 3 e escolhe um filtro de tag
- **THEN** a tela mostra a página 1 do resultado filtrado

#### Scenario: Recarregar mantém o contexto
- **WHEN** o usuário recarrega a tela estando na página 2 com a busca "preços"
- **THEN** a tela volta na página 2 com a mesma busca

#### Scenario: Selo de expiração
- **WHEN** a lista traz um treinamento que expira em 3 dias e outro já expirado
- **THEN** o primeiro mostra a data de expiração e o segundo o selo "Expirado"
