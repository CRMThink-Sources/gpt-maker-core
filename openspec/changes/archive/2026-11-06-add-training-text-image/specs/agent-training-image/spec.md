# Spec Delta

## Purpose

Permite anexar uma imagem a treinamentos de texto do agente, tanto nos criados manualmente quanto nos gerados pelos itens da base de conhecimento da função, para que o agente use a imagem junto com o texto ao responder.

## ADDED Requirements

### Requirement: Enviar imagem para treinamento
O sistema MUST permitir a quem gerencia agentes enviar uma imagem de um agente do próprio tenant, nos formatos PNG, JPEG ou WebP, com até 5 MB. O tipo MUST ser conferido pelo conteúdo do arquivo, não só pelo nome ou pelo tipo informado. O envio MUST devolver um identificador da imagem para ser ligado a um treinamento de texto. Quem apenas consulta MUST NOT poder enviar.

#### Scenario: Envio válido
- **WHEN** o administrador envia um PNG de 800 KB para um agente do tenant
- **THEN** o sistema guarda a imagem, devolve o identificador e mostra a miniatura no formulário

#### Scenario: Formato não aceito
- **WHEN** o administrador envia um PDF, ou um arquivo `.png` cujo conteúdo é outro tipo
- **THEN** o sistema recusa e informa que só PNG, JPEG e WebP são aceitos

#### Scenario: Imagem grande demais
- **WHEN** o administrador envia uma imagem de 8 MB
- **THEN** o sistema recusa e informa o limite de 5 MB

#### Scenario: Agente de outro tenant
- **WHEN** alguém envia imagem para um agente de outro tenant
- **THEN** o sistema responde como se o agente não existisse

#### Scenario: Perfil somente consulta
- **WHEN** um usuário sem permissão de gerenciar tenta enviar uma imagem
- **THEN** o sistema recusa o envio

### Requirement: Treinamento de texto manual com imagem
O sistema MUST permitir criar, na tela de Treinamentos do agente, um treinamento de texto (até 1.028 caracteres) com uma imagem opcional já enviada, **inclusive em agentes que têm função configurada**, respeitando o limite de treinamentos do plano. Um treinamento manual MUST poder ser removido a qualquer momento. A lista MUST distinguir os textos gerados pela função dos manuais. O GPTMaker MUST receber o texto e a imagem juntos. Um treinamento de texto manual MUST poder ter a imagem trocada ou removida na edição, com ou sem alterar o texto. O treinamento criado pela função do agente MUST NOT ser editado por esse caminho.

#### Scenario: Texto com imagem
- **WHEN** o administrador adiciona um treinamento de texto "Tabela de preços de 2026" com uma imagem enviada
- **THEN** o treinamento é criado no GPTMaker com o texto e a imagem e aparece na lista com a miniatura

#### Scenario: Texto sem imagem
- **WHEN** o administrador adiciona um treinamento de texto sem imagem
- **THEN** o treinamento é criado só com o texto, como antes

#### Scenario: Trocar a imagem
- **WHEN** o administrador edita um treinamento de texto manual e escolhe outra imagem, sem mudar o texto
- **THEN** o GPTMaker é atualizado com a nova imagem e a anterior é apagada do armazenamento

#### Scenario: Remover a imagem
- **WHEN** o administrador remove a imagem de um treinamento de texto manual
- **THEN** o treinamento passa a ter só o texto e a imagem é apagada do armazenamento

#### Scenario: Imagem de outro agente
- **WHEN** o corpo da criação cita a imagem de outro agente ou de outro tenant
- **THEN** o sistema recusa, informando que a imagem não foi encontrada

#### Scenario: Treinamento da função
- **WHEN** o administrador tenta editar ou remover pela tela de Treinamentos um texto gerado pela função
- **THEN** o sistema recusa e orienta a editar pelo formulário da função

#### Scenario: Manual depois do formulário
- **WHEN** o agente já tem a base montada pelo formulário da função e o administrador adiciona um texto manual
- **THEN** o texto manual é criado e aparece na lista como "manual", junto com os da função

#### Scenario: Publicar a função com textos manuais
- **WHEN** o administrador publica de novo a função de um agente que tem textos manuais, inclusive um com o mesmo texto de um item da base
- **THEN** os textos manuais não são alterados, adotados nem removidos pela publicação

#### Scenario: Limite de treinamentos
- **WHEN** o tenant já está no limite de treinamentos do plano e tenta adicionar um texto manual
- **THEN** o sistema recusa e informa o limite

### Requirement: Imagem nos itens da base de conhecimento
O sistema MUST permitir anexar uma imagem opcional a cada item da base de conhecimento no formulário da função do agente. Ao publicar, o treinamento de texto gerado para o item MUST levar a imagem. Mudar apenas a imagem de um item MUST atualizar o treinamento desse item na próxima publicação, e remover a imagem do item MUST remover a imagem do treinamento. Itens sem imagem MUST se comportar como hoje.

#### Scenario: Publicar item com imagem
- **WHEN** o administrador anexa uma imagem a um item da base e publica a função
- **THEN** o treinamento do item é criado no GPTMaker com o texto do item e a imagem

#### Scenario: Só a imagem mudou
- **WHEN** o administrador troca a imagem de um item e mantém o texto, e publica
- **THEN** só o treinamento daquele item é atualizado e o plano da publicação mostra essa alteração

#### Scenario: Remover imagem do item
- **WHEN** o administrador remove a imagem de um item já publicado e publica de novo
- **THEN** o treinamento do item fica sem imagem e o arquivo antigo é apagado

#### Scenario: Item removido
- **WHEN** o administrador remove um item com imagem e publica
- **THEN** o treinamento e a imagem do item são removidos

### Requirement: Envio da imagem ao GPTMaker e reenvio
O sistema MUST enviar a imagem ao GPTMaker por uma URL pública **estável** da própria aplicação, que o GPTMaker guarda e busca (`GET` e `HEAD`), sem expor o armazenamento: o endereço contém um identificador aleatório e impossível de adivinhar, serve a imagem para exibição e MUST deixar de responder quando a imagem é apagada. O reenvio de um treinamento com falha MUST usar a mesma imagem guardada. Falha no GPTMaker ao criar ou editar com imagem MUST deixar o treinamento e o arquivo no estado anterior, sem arquivos órfãos: se o GPTMaker pode ter criado o treinamento antes de falhar (erro do provedor, tempo esgotado ou rede), o sistema MUST remover do GPTMaker o treinamento que casa exatamente com o conteúdo enviado e ainda não tem registro local.

#### Scenario: URL estável e privada
- **WHEN** um treinamento de texto com imagem é enviado ao GPTMaker
- **THEN** a imagem vai como o endereço público da aplicação com identificador aleatório, o GPTMaker consegue buscá-la por `GET` e `HEAD` e o armazenamento continua privado

#### Scenario: Imagem apagada
- **WHEN** a imagem é removida do treinamento e o endereço antigo é aberto
- **THEN** a aplicação responde que a imagem não foi encontrada

#### Scenario: Reenvio após falha
- **WHEN** um treinamento de texto com imagem falha no GPTMaker e o administrador pede para reenviar
- **THEN** o sistema reenvia o mesmo texto e a mesma imagem

#### Scenario: GPTMaker recusa
- **WHEN** o GPTMaker recusa a criação de um treinamento com imagem
- **THEN** o treinamento não é criado, o administrador vê o erro e a imagem enviada continua disponível para nova tentativa

#### Scenario: GPTMaker cria e depois falha
- **WHEN** o GPTMaker cria o treinamento mas responde com erro ao processar a imagem
- **THEN** o administrador vê o erro, nada fica registrado localmente e o treinamento que ficou no GPTMaker é removido de lá, sem tocar em treinamentos que já têm registro local ou que têm outro texto

### Requirement: Remoção e limpeza das imagens
O sistema MUST apagar a imagem do armazenamento quando o treinamento é removido ou quando a imagem é trocada ou removida. Imagens enviadas e não ligadas a nenhum treinamento por mais de 24 horas MUST ser apagadas automaticamente. Apagar o arquivo MUST NOT falhar a operação do usuário: a falha é registrada e a limpeza é repetida depois.

#### Scenario: Remover o treinamento
- **WHEN** o administrador remove um treinamento de texto com imagem
- **THEN** o treinamento é removido do GPTMaker e a imagem é apagada do armazenamento

#### Scenario: Envio abandonado
- **WHEN** o administrador envia uma imagem e fecha o formulário sem salvar
- **THEN** depois de 24 horas a imagem é apagada automaticamente

### Requirement: Cota de armazenamento do plano
O tamanho das imagens ligadas a treinamentos MUST contar na cota de armazenamento do plano do tenant, junto com os documentos. Um envio que ultrapassaria a cota MUST ser recusado, informando o limite; plano sem limite MUST aceitar. Imagens ainda não ligadas MUST contar enquanto existirem.

#### Scenario: Cota estourada
- **WHEN** o tenant já usa quase toda a cota e envia uma imagem que a ultrapassa
- **THEN** o sistema recusa o envio e informa quanto o plano permite

#### Scenario: Liberar espaço
- **WHEN** o administrador remove um treinamento com imagem de 2 MB
- **THEN** o uso de armazenamento do tenant diminui em 2 MB
