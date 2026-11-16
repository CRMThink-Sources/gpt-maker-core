# Spec Delta

## Purpose

Permite ao cliente levar os treinamentos manuais de um agente para um arquivo e trazê-los de volta em outro agente (ou no mesmo), para duplicar, migrar ou guardar cópia da base sem recriar item a item.

## ADDED Requirements

### Requirement: Exportar treinamentos do agente
O sistema MUST permitir a qualquer usuário do tenant com acesso ao agente baixar um arquivo JSON com os treinamentos manuais dele, na ordem de criação. O arquivo MUST trazer a versão do formato e, para cada treinamento, o tipo e o conteúdo (texto; ou endereço, subpáginas e intervalo de re-treinamento do site; ou endereço do vídeo). O arquivo MUST NOT trazer identificadores internos, tokens, endereços de armazenamento nem dados de outro agente ou tenant. Treinamentos gerados pela função do agente, de documento e removidos MUST NOT ser exportados. Agente de outro tenant MUST responder como se não existisse.

#### Scenario: Exportação com treinamentos de vários tipos
- **WHEN** o usuário clica em Exportar num agente com 2 textos, 1 site e 1 vídeo manuais
- **THEN** o navegador baixa um arquivo JSON com os 4 itens, na ordem de criação, e a versão do formato

#### Scenario: Itens que ficam fora
- **WHEN** o agente tem textos gerados pela função, um documento e um treinamento removido, além de 1 texto manual
- **THEN** o arquivo contém só o texto manual

#### Scenario: Agente sem treinamentos manuais
- **WHEN** o usuário exporta um agente sem treinamentos manuais
- **THEN** a API responde com a lista vazia, a tela informa que não há nada a exportar e nenhum arquivo é baixado

#### Scenario: Agente de outro tenant
- **WHEN** alguém pede a exportação de um agente de outro tenant
- **THEN** o sistema responde como se o agente não existisse

#### Scenario: Imagem do texto
- **WHEN** um texto manual tem imagem anexada e é exportado
- **THEN** o item sai com o texto e o endereço público da imagem, e a tela avisa que o arquivo guarda o link da imagem, não o arquivo dela

#### Scenario: Link da imagem no arquivo
- **WHEN** o usuário guarda ou compartilha o arquivo exportado
- **THEN** a tela avisa que quem tiver o arquivo consegue abrir as imagens enquanto elas existirem no agente de origem

### Requirement: Importar treinamentos para o agente
O sistema MUST permitir a quem gerencia agentes enviar um arquivo exportado para criar os treinamentos nele no agente escolhido do próprio tenant. Cada item MUST ser criado como treinamento manual, pelas mesmas regras da criação pela tela (limite de tamanho do texto, endereços http/https, envio ao GPTMaker, política de mídia da função). A importação MUST NOT alterar, substituir nem remover treinamentos existentes. Quem apenas consulta MUST NOT poder importar. O sistema MUST aceitar no máximo 100 itens por arquivo.

#### Scenario: Importação completa
- **WHEN** o administrador importa um arquivo com 3 itens válidos e o plano comporta todos
- **THEN** os 3 treinamentos são criados no agente, aparecem na lista como manuais e o resultado informa 3 criados

#### Scenario: Treinamentos existentes preservados
- **WHEN** o agente já tem treinamentos e o administrador importa um arquivo
- **THEN** os treinamentos anteriores continuam como estavam e os importados são somados a eles

#### Scenario: Perfil somente consulta
- **WHEN** um usuário sem permissão de gerenciar tenta importar
- **THEN** o sistema recusa a importação

#### Scenario: Agente de outro tenant
- **WHEN** alguém importa para um agente de outro tenant
- **THEN** o sistema responde como se o agente não existisse

#### Scenario: Arquivo com mais de 100 itens
- **WHEN** o administrador envia um arquivo com 101 itens
- **THEN** o sistema recusa o arquivo inteiro, informa o limite e não cria nenhum treinamento

### Requirement: Validação do arquivo importado
O sistema MUST recusar o arquivo inteiro, sem criar nada, quando ele não for JSON válido, não tiver a estrutura do formato ou trouxer uma versão de formato desconhecida. Quando só alguns itens forem inválidos (texto vazio ou acima de 1.028 caracteres, endereço que não seja http/https, tipo desconhecido), o sistema MUST criar os válidos e informar, para cada inválido, a posição e o motivo. O arquivo MUST NOT poder criar treinamento gerado pela função nem de documento, nem ligar uma imagem por identificador interno: a única forma de trazer imagem é o endereço público dela, tratado no requisito de imagens.

#### Scenario: Arquivo que não é JSON
- **WHEN** o administrador envia um arquivo de texto qualquer
- **THEN** o sistema recusa, informa que o arquivo não é uma exportação válida e não cria nada

#### Scenario: Versão desconhecida
- **WHEN** o arquivo declara uma versão de formato que o sistema não conhece
- **THEN** o sistema recusa o arquivo inteiro e informa que a versão não é suportada

#### Scenario: Itens inválidos misturados com válidos
- **WHEN** o arquivo tem 5 itens, sendo o 2º com texto vazio e o 4º com endereço `ftp://`
- **THEN** os outros 3 são criados e o resultado lista o item 2 e o item 4 como recusados, cada um com o motivo

#### Scenario: Tentativa de marcar como da função
- **WHEN** um item do arquivo traz o campo de treinamento gerado pela função ou um tipo de documento
- **THEN** o item não é criado como da função nem como documento: é recusado e o resultado informa o motivo

### Requirement: Imagens dos textos importados
Quando um item de texto trouxer o endereço de uma imagem, o sistema MUST copiar a imagem para o agente de destino como imagem nova e ligá-la ao treinamento criado; a imagem de origem MUST NOT ser alterada nem compartilhada com o destino. O sistema MUST aceitar apenas endereços do próprio serviço (mesmo host e caminho das imagens de treinamento) e MUST NOT acessar nenhum outro endereço citado no arquivo. A cópia MUST seguir as regras do envio de imagem: PNG, JPEG ou WebP conferido pelo conteúdo, até 5 MB e dentro da cota de documentos e imagens do plano. Quando a imagem não puder ser copiada (apagada, endereço de outro ambiente ou de outro serviço, formato inválido, cota estourada), o sistema MUST criar o texto sem imagem e informar o aviso no resultado daquele item.

#### Scenario: Texto com imagem copiada
- **WHEN** o administrador importa um texto cuja imagem ainda existe no agente de origem
- **THEN** o treinamento é criado no GPTMaker com o texto e uma cópia da imagem, e a imagem original continua como estava

#### Scenario: Apagar o treinamento de origem depois
- **WHEN** o administrador apaga o treinamento original depois da importação
- **THEN** a imagem do treinamento importado continua disponível

#### Scenario: Imagem apagada na origem
- **WHEN** a imagem do item foi apagada antes da importação
- **THEN** o texto é criado sem imagem e o resultado mostra o aviso de imagem não importada

#### Scenario: Endereço que não é do serviço
- **WHEN** o item traz como imagem um endereço de outro site, ou de outro ambiente do serviço
- **THEN** o sistema não acessa o endereço, cria o texto sem imagem e informa o aviso

#### Scenario: Cota do plano sem espaço para a imagem
- **WHEN** a cópia da imagem passaria da cota de documentos e imagens do plano
- **THEN** o texto é criado sem imagem e o resultado informa que faltou espaço

### Requirement: Limites do plano na importação
A importação MUST respeitar o limite de treinamentos do plano do tenant somando todos os agentes. Quando o arquivo tiver mais itens válidos do que o espaço restante, o sistema MUST criar os primeiros, na ordem do arquivo, até o limite e informar os demais como recusados por limite do plano. A importação MUST NOT ultrapassar o limite nem com importações simultâneas no mesmo tenant.

#### Scenario: Cabe só parte
- **WHEN** o plano permite mais 2 treinamentos e o arquivo tem 5 itens válidos
- **THEN** os 2 primeiros são criados e os 3 restantes aparecem como recusados por limite do plano

#### Scenario: Plano sem limite
- **WHEN** o plano do tenant não tem limite de treinamentos
- **THEN** todos os itens válidos do arquivo são criados

#### Scenario: Importações ao mesmo tempo
- **WHEN** duas importações do mesmo tenant rodam ao mesmo tempo e juntas passariam do limite
- **THEN** o total de treinamentos do tenant não ultrapassa o limite do plano

### Requirement: Política de mídia e falhas do GPTMaker
A importação MUST respeitar a regra da função do agente para site e vídeo: quando o agente não está no modo que aceita esses tipos, os itens de site e vídeo MUST ser recusados com o mesmo motivo da criação pela tela, e os textos MUST seguir normalmente. Quando o GPTMaker recusar ou falhar num item, o sistema MUST informar esse item como falho, sem deixar registro local órfão, e MUST continuar com os demais, exceto quando o GPTMaker ficar indisponível em 3 itens seguidos: nesse caso os itens válidos restantes MUST ser informados como falhos, sem novas chamadas, para a importação não se arrastar. A importação MUST NOT debitar créditos.

#### Scenario: Site e vídeo em agente sem modo avançado
- **WHEN** o administrador importa 2 textos, 1 site e 1 vídeo num agente cuja função não aceita site e vídeo
- **THEN** os 2 textos são criados e o site e o vídeo aparecem como recusados com o motivo da política de mídia

#### Scenario: GPTMaker falha num item
- **WHEN** o GPTMaker recusa o 2º de 3 itens
- **THEN** o 1º e o 3º são criados, o 2º aparece como falho no resultado e não fica treinamento local para ele

#### Scenario: GPTMaker fora do ar
- **WHEN** o GPTMaker não responde para 3 itens seguidos de um arquivo com 10 itens válidos
- **THEN** os 7 restantes aparecem como falhos sem novas chamadas ao GPTMaker e nenhum fica registrado localmente

### Requirement: Resultado da importação
O sistema MUST devolver, ao final, o resumo com a quantidade de itens criados, recusados e falhos, a lista dos não criados com posição no arquivo, tipo e motivo, e a lista dos criados com aviso (imagem não importada) com posição e motivo. A tela MUST mostrar esse resultado ao usuário e atualizar a lista de treinamentos. Os treinamentos criados MUST seguir o fluxo normal de status (processando até o GPTMaker confirmar).

#### Scenario: Resultado misto
- **WHEN** a importação cria 3 itens, recusa 1 por texto inválido e 1 por limite do plano
- **THEN** a tela mostra 3 criados e 2 não criados, cada um com posição e motivo, e a lista já mostra os novos treinamentos

#### Scenario: Reimportar o mesmo arquivo
- **WHEN** o administrador importa duas vezes o mesmo arquivo
- **THEN** os itens são criados de novo na segunda vez (a importação não detecta duplicados) e a tela avisa antes de enviar que a importação soma aos existentes
