## MODIFIED Requirements

### Requirement: Exportar treinamentos do agente
O sistema MUST permitir a qualquer usuário do tenant com acesso ao agente baixar um arquivo JSON com os treinamentos manuais dele, na ordem de criação. O arquivo MUST trazer a versão do formato e, para cada treinamento, o tipo, o conteúdo (texto; ou endereço, subpáginas e intervalo de re-treinamento do site; ou endereço do vídeo) e as tags, quando houver. O arquivo MUST NOT trazer a data de expiração, identificadores internos, tokens, endereços de armazenamento nem dados de outro agente ou tenant. Treinamentos gerados pela função do agente, de documento, expirados e removidos MUST NOT ser exportados. Agente de outro tenant MUST responder como se não existisse.

#### Scenario: Exportação com treinamentos de vários tipos
- **WHEN** o usuário clica em Exportar num agente com 2 textos, 1 site e 1 vídeo manuais
- **THEN** o navegador baixa um arquivo JSON com os 4 itens, na ordem de criação, e a versão do formato

#### Scenario: Itens que ficam fora
- **WHEN** o agente tem textos gerados pela função, um documento, um treinamento expirado e um removido, além de 1 texto manual ativo
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

#### Scenario: Tags no arquivo
- **WHEN** um treinamento com as tags "preços" e "2026" e uma expiração futura é exportado
- **THEN** o item sai com as tags "preços" e "2026" e sem nenhuma data de expiração

### Requirement: Validação do arquivo importado
O sistema MUST recusar o arquivo inteiro, sem criar nada, quando ele não for JSON válido, não tiver a estrutura do formato ou trouxer uma versão de formato desconhecida. Quando só alguns itens forem inválidos (texto vazio ou acima de 1.028 caracteres, endereço que não seja http/https, tipo desconhecido, tags acima do limite de quantidade ou de tamanho), o sistema MUST criar os válidos e informar, para cada inválido, a posição e o motivo. Tags MUST ser normalizadas pelas mesmas regras da criação pela tela, e arquivos antigos, sem tags, MUST continuar sendo aceitos. O arquivo MUST NOT poder criar treinamento gerado pela função nem de documento, nem ligar uma imagem por identificador interno, nem definir expiração: a única forma de trazer imagem é o endereço público dela, tratado no requisito de imagens.

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

#### Scenario: Importar com tags
- **WHEN** o arquivo traz um texto com as tags "Preços" e "preços"
- **THEN** o treinamento é criado com a única tag "preços"

#### Scenario: Arquivo antigo sem tags
- **WHEN** o administrador importa um arquivo exportado antes desta mudança
- **THEN** os itens são criados normalmente, sem tags

#### Scenario: Tentativa de definir expiração
- **WHEN** um item do arquivo traz um campo de expiração
- **THEN** o item é recusado e o resultado informa o motivo
