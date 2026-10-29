# Spec Delta

## ADDED Requirements

### Requirement: Orientações das respostas editáveis no backoffice
As respostas de sucesso da identificação do cliente e da ferramenta `negocios_do_cliente` MUST trazer uma orientação ao agente. Essa orientação é composta pelo texto próprio da resposta seguido do texto de escopo dos dados. A resposta de cliente não identificado MUST trazer a mensagem de cliente não identificado.

Os quatro textos são: cliente identificado, negócios do cliente, escopo dos dados e cliente não identificado. Cada um MUST ser global, o mesmo para todos os tenants, e MUST ter um texto padrão definido pelo produto.

Pelo backoffice, um operador ADMIN MUST poder editar cada texto (de 1 a 1000 caracteres, sem espaços nas pontas) e restaurar o padrão. Um operador SUPPORT MUST poder consultar os textos sem editar. Texto nunca editado, ou restaurado, MUST usar o padrão.

Uma edição MUST valer para as chamadas feitas a partir de 1 minuto depois de salva, sem deploy nem reconfiguração no GPTMaker. Toda edição e toda restauração MUST ser registrada na auditoria do backoffice, com operador, texto anterior e texto novo.

Se as edições não puderem ser lidas, a ferramenta MUST responder com o texto padrão, sem falhar a chamada.

#### Scenario: Texto editado chega ao agente
- **WHEN** um ADMIN muda o texto de negócios do cliente para "Responda só com estes negócios." e salva
- **THEN** a partir de 1 minuto, a orientação de `negocios_do_cliente` passa a ser esse texto seguido do texto de escopo dos dados

#### Scenario: Texto nunca editado
- **WHEN** ninguém editou o texto de cliente não identificado
- **THEN** a resposta de cliente não identificado traz a mensagem padrão do produto

#### Scenario: Restaurar padrão
- **WHEN** um ADMIN restaura o padrão do texto de escopo dos dados
- **THEN** as orientações voltam a usar o escopo padrão, e a auditoria registra a restauração com o texto que foi descartado

#### Scenario: Operador sem permissão de edição
- **WHEN** um operador SUPPORT tenta salvar um texto
- **THEN** o sistema recusa a alteração e o texto em uso não muda

#### Scenario: Texto inválido
- **WHEN** um ADMIN tenta salvar um texto vazio ou com mais de 1000 caracteres
- **THEN** o sistema recusa com a explicação do limite e o texto em uso não muda

#### Scenario: Falha ao ler as edições
- **WHEN** o banco ou o cache não respondem ao montar a resposta da ferramenta
- **THEN** a resposta usa os textos padrão e a chamada não falha por causa disso
