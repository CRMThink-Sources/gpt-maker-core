## Purpose

Tradução do formulário das funções do agente para `pt-BR`, `en` e `es`, para que a criação e a edição do agente apareçam inteiras no idioma da interface, sem alterar o texto que o agente recebe no GPTMaker.

## ADDED Requirements

### Requirement: Traduções no template e nos blocos
Todo template de função e todo bloco compartilhado SHALL poder guardar traduções para `en` e `es` dos textos que o cliente lê: nome e descrição da função; rótulo, ajuda e placeholder dos campos; rótulo das opções; rótulo dos subcampos da base de conhecimento; rótulo e ajuda dos valores de SPA; e perguntas do assistente de IA. As traduções SHALL ser versionadas junto do conteúdo publicado, e o português SHALL continuar sendo o texto-base.

#### Scenario: Publicar com traduções
- **WHEN** um operador publica um template com traduções em `en` e `es`
- **THEN** a nova versão guarda o texto-base e as traduções, e as versões anteriores permanecem como estavam

#### Scenario: Tradução de campo inexistente
- **WHEN** o rascunho traz tradução para um campo, opção ou subcampo que não existe no template
- **THEN** o backoffice aponta o problema e a publicação é recusada

### Requirement: Formulário no idioma da interface
Ao listar as funções e ao abrir o formulário (criação e edição do agente), a API do app SHALL devolver os textos no idioma ativo da interface, enviado pelo app em cada requisição. Para qualquer texto sem tradução, e para idioma não suportado ou ausente, SHALL valer o português. Identificadores, valores das opções, limites e respostas salvas SHALL NOT mudar com o idioma.

#### Scenario: Interface em inglês
- **WHEN** o usuário abre a criação de agente com a interface em `en`
- **THEN** nomes, descrições, rótulos, ajudas e opções das funções aparecem em inglês

#### Scenario: Texto sem tradução
- **WHEN** um campo não tem tradução em `es` e a interface está em `es`
- **THEN** o campo aparece em português e o restante do formulário aparece em espanhol

#### Scenario: Trocar de idioma
- **WHEN** o usuário troca o idioma da interface com o formulário aberto
- **THEN** o formulário passa a mostrar o novo idioma sem perder as respostas já digitadas

#### Scenario: Respostas independentes do idioma
- **WHEN** um agente é configurado com a interface em `en` e depois aberto em `pt-BR`
- **THEN** as respostas são as mesmas e a publicação compila o mesmo comportamento

### Requirement: Texto do agente não depende do idioma da interface
O comportamento compilado, os trechos das opções, os treinamentos e as intenções enviados ao GPTMaker SHALL ser gerados a partir do texto-base em português, qualquer que seja o idioma da interface.

#### Scenario: Publicar com a interface em espanhol
- **WHEN** o usuário publica a função com a interface em `es`
- **THEN** o conteúdo enviado ao GPTMaker é o mesmo que seria enviado com a interface em `pt-BR`

### Requirement: Edição das traduções no backoffice
O editor de função e de bloco SHALL ter uma área de traduções por idioma, mostrando o texto em português ao lado do campo a traduzir e indicando quantos textos faltam em cada idioma. Texto sem tradução SHALL NOT impedir salvar nem publicar.

#### Scenario: Tradução incompleta
- **WHEN** o operador publica um template com textos sem tradução em `es`
- **THEN** a publicação é aceita e o editor segue mostrando quantos textos faltam em `es`

### Requirement: Funções do seed traduzidas
As funções entregues com o app (SDR, Suporte, Agendamento e Pós-venda) e os blocos compartilhados SHALL ter todos os textos lidos pelo cliente traduzidos para `en` e `es`.

#### Scenario: Instalação nova em inglês
- **WHEN** um portal novo abre a criação de agente com a interface em `en`
- **THEN** as quatro funções aparecem sem nenhum texto em português
