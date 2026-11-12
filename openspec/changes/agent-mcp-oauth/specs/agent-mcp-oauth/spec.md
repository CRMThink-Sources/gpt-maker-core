# Spec Delta

## Purpose

Permite conectar ao agente servidores MCP que exigem OAuth, conduzindo o usuário pela autorização no provedor e concluindo a conexão no GPTMaker, sem que o ThinkFlow guarde tokens do provedor e com isolamento por tenant.

## ADDED Requirements

### Requirement: Criação de conexão OAuth pendente
O usuário com permissão de gestão MUST poder criar uma conexão MCP com autenticação `OAUTH` informando nome, descrição, URL e transporte, sem cabeçalhos. As mesmas regras de URL da criação comum (https fora de desenvolvimento, sem endereço local ou privado) MUST valer. O sistema MUST criar a conexão no GPTMaker e, se esta exigir autorização, guardá-la como pendente de autorização e devolver a URL de autorização ao usuário. Se o GPTMaker informar que a conexão já está conectada, o sistema MUST tratá-la como concluída. A conexão pendente MUST NOT ser tratada como ativa pelo agente.

#### Scenario: Conexão OAuth criada
- **WHEN** o usuário envia nome, descrição, URL `https` e transporte com `authType` `OAUTH` e o GPTMaker devolve uma URL de autorização
- **THEN** a conexão aparece como "aguardando autorização" com a URL para autorizar, sem ferramentas listadas

#### Scenario: Cabeçalhos com OAuth
- **WHEN** o pedido traz `authType` `OAUTH` junto com cabeçalhos
- **THEN** o sistema recusa com erro de validação e não chama o GPTMaker

#### Scenario: Provedor já autorizado
- **WHEN** o GPTMaker responde que a conexão já está conectada
- **THEN** a conexão fica `connected` com as ferramentas listadas, sem passo de autorização

#### Scenario: URL insegura ou local
- **WHEN** a URL é `http` em produção, `localhost` ou IP de rede privada
- **THEN** o sistema recusa com erro de validação e não chama o GPTMaker

### Requirement: Conclusão da autorização
O sistema MUST permitir concluir uma conexão pendente com o retorno do provedor (`code` e `state`). O `state` informado MUST ser igual ao `state` da URL de autorização da conexão; caso contrário o sistema MUST recusar sem chamar o GPTMaker. Com `state` válido, o sistema MUST concluir a conexão no GPTMaker, guardar o identificador devolvido e, ao concluir, listar e ativar as ferramentas descobertas como na criação comum. O `code` MUST NOT ser registrado em log nem persistido. Concluir uma conexão que não está pendente MUST ser recusado.

#### Scenario: Autorização concluída
- **WHEN** o usuário autoriza no provedor e informa `code` e `state` correspondentes à conexão pendente
- **THEN** a conexão fica `connected`, com as ferramentas do servidor listadas

#### Scenario: State divergente
- **WHEN** o `state` informado não é o da conexão pendente
- **THEN** o sistema recusa, a conexão continua pendente e o GPTMaker não é chamado

#### Scenario: GPTMaker recusa o código
- **WHEN** o GPTMaker responde erro ao concluir (código expirado ou inválido)
- **THEN** a conexão continua pendente, o usuário vê o motivo resumido sem o código, e pode tentar autorizar de novo

#### Scenario: Conexão já concluída
- **WHEN** o usuário tenta concluir uma conexão que já está `connected`
- **THEN** o sistema recusa como estado inválido

#### Scenario: Conexão de outro tenant ou agente
- **WHEN** o usuário tenta concluir uma conexão que não pertence ao agente da URL ou ao tenant da sessão
- **THEN** o sistema responde 404

### Requirement: Cancelar ou refazer a autorização
O usuário com permissão de gestão MUST poder cancelar uma conexão pendente, removendo-a do GPTMaker e do ThinkFlow (404 do GPTMaker conta como removida). O usuário MUST poder obter de novo a URL de autorização de uma conexão pendente. Conexões `OAUTH` MUST NOT ser editáveis: para mudar dados o usuário remove e cria de novo.

#### Scenario: Cancelar pendente
- **WHEN** o usuário cancela uma conexão aguardando autorização
- **THEN** ela some da lista e não fica conexão órfã no GPTMaker

#### Scenario: Editar conexão OAuth
- **WHEN** o usuário tenta editar uma conexão `OAUTH`
- **THEN** o sistema recusa orientando a remover e criar de novo

### Requirement: Permissão e isolamento
Criar, concluir e cancelar MUST exigir a permissão de gestão; listar MUST exigir só leitura. Todas as operações MUST filtrar por tenant e agente, e recurso de outro tenant MUST responder 404.

#### Scenario: Sem permissão de gestão
- **WHEN** um usuário sem permissão de gestão tenta criar, concluir ou cancelar uma conexão OAuth
- **THEN** o sistema recusa como não autorizado

### Requirement: Conclusão quando o painel já concluiu
Se a conclusão com `code` falhar mas a conexão já responder no GPTMaker (por exemplo, o painel do GPTMaker consumiu o código antes), o sistema MUST tratá-la como concluída. O usuário MUST poder pedir "Atualizar status" de uma conexão pendente sem informar `code`, e o sistema MUST concluí-la se a conexão já responder, ou mantê-la pendente se não.

#### Scenario: Código já consumido pelo painel
- **WHEN** o usuário informa um `code` já usado, mas a conexão já está ativa no GPTMaker
- **THEN** a conexão fica `connected` com as ferramentas listadas

#### Scenario: Atualizar status ainda pendente
- **WHEN** o usuário pede "Atualizar status" e a conexão ainda não foi autorizada
- **THEN** a conexão continua aguardando autorização, sem erro
