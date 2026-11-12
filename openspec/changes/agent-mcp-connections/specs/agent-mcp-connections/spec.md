# Spec Delta

## Purpose

Permite que o cliente conecte servidores MCP próprios ao agente do GPTMaker pelo painel do ThinkFlow, escolha quais ferramentas o agente pode usar e acompanhe a saúde de cada conexão, com credenciais protegidas e isolamento por tenant.

## ADDED Requirements

### Requirement: Listagem das conexões MCP do agente
O sistema MUST listar as conexões MCP do agente do tenant da sessão, cada uma com nome, descrição, URL, transporte, tipo de autenticação, estado (`connected`, `error`) e, em caso de erro, um motivo resumido. A lista MUST incluir só as conexões criadas por este recurso: a conexão MCP interna do CRM MUST NOT aparecer. Valores de cabeçalho MUST NOT ser devolvidos; só os nomes dos cabeçalhos.

#### Scenario: Agente com conexões
- **WHEN** o usuário abre "Conexões MCP" de um agente com duas conexões cadastradas
- **THEN** vê as duas com nome, URL, transporte e estado, e nenhum valor de cabeçalho

#### Scenario: Conexão do CRM fora da lista
- **WHEN** o agente tem o CRM ativo (conexão MCP interna)
- **THEN** a lista não mostra a conexão do CRM

#### Scenario: Agente de outro tenant
- **WHEN** o usuário pede as conexões de um agente que pertence a outro tenant
- **THEN** o sistema responde 404

### Requirement: Criação de conexão MCP
O usuário com permissão de gestão MUST poder adicionar uma conexão informando nome, descrição, URL, transporte (`SSE` ou `STREAMABLEHTTP`) e autenticação (`NO_OAUTH` ou `HEADERS`, com cabeçalhos nome/valor). A URL MUST ser `https` (exceto em ambiente de desenvolvimento) e MUST NOT apontar para endereço local ou privado. O sistema MUST criar a conexão no agente do GPTMaker, guardar o identificador devolvido, cifrar os valores dos cabeçalhos e, ao concluir, ativar as ferramentas descobertas que o usuário não tenha deixado desativadas. Falha no GPTMaker MUST NOT deixar conexão parcial: nada fica salvo como ativo e o usuário vê o motivo.

#### Scenario: Conexão criada
- **WHEN** o usuário envia nome, descrição, URL `https`, transporte e cabeçalho de autenticação válidos e o GPTMaker aceita
- **THEN** a conexão aparece como `connected`, com as ferramentas do servidor listadas, e o valor do cabeçalho fica cifrado no banco

#### Scenario: URL insegura ou local
- **WHEN** a URL é `http` em produção, `localhost` ou um IP de rede privada
- **THEN** o sistema recusa com erro de validação e não chama o GPTMaker

#### Scenario: GPTMaker recusa a conexão
- **WHEN** o GPTMaker responde erro ou `connected: false` ao criar
- **THEN** nenhuma conexão fica salva como ativa, o GPTMaker não mantém conexão órfã e o usuário recebe o motivo resumido, sem segredos

#### Scenario: Sem permissão de gestão
- **WHEN** um usuário sem permissão de gestão tenta criar uma conexão
- **THEN** o sistema recusa como não autorizado

#### Scenario: Autenticação OAuth
- **WHEN** o pedido traz `authType` `OAUTH`
- **THEN** o sistema recusa como não suportado nesta versão

### Requirement: Ferramentas da conexão
O sistema MUST listar as ferramentas descobertas de uma conexão (nome, descrição, ativa ou não) e permitir ativar e desativar cada uma. O sistema MUST permitir sincronizar as ferramentas, relendo-as do servidor MCP, e refletir mudanças de nome, descrição ou esquema. Ferramentas novas após sincronizar MUST ficar inativas até o usuário ativá-las.

#### Scenario: Desativar ferramenta
- **WHEN** o usuário desativa uma ferramenta de uma conexão
- **THEN** a ferramenta fica inativa no GPTMaker e a lista a mostra como inativa

#### Scenario: Sincronização traz ferramenta nova
- **WHEN** o servidor MCP ganhou uma ferramenta e o usuário sincroniza
- **THEN** a nova ferramenta aparece na lista como inativa

#### Scenario: Conexão de outro agente
- **WHEN** o usuário pede as ferramentas de uma conexão que não pertence ao agente da URL ou ao tenant da sessão
- **THEN** o sistema responde 404

### Requirement: Edição de conexão
O usuário com permissão de gestão MUST poder alterar nome, descrição, URL, transporte e cabeçalhos de uma conexão. Como o GPTMaker não oferece atualização, o sistema MUST criar a nova conexão antes de remover a antiga, e MUST manter a antiga em funcionamento se a criação falhar. Cabeçalhos não reenviados MUST manter o valor atual. As ferramentas já desativadas MUST permanecer desativadas quando o nome continuar existindo na nova conexão.

#### Scenario: Edição bem-sucedida
- **WHEN** o usuário troca a URL de uma conexão e o GPTMaker aceita a nova
- **THEN** a conexão antiga é removida, a lista mostra a nova URL e as ferramentas desativadas antes continuam desativadas

#### Scenario: Falha ao recriar
- **WHEN** o GPTMaker recusa a nova conexão durante a edição
- **THEN** a conexão antiga continua ativa e inalterada e o usuário vê o motivo

#### Scenario: Cabeçalho mantido
- **WHEN** o usuário edita só o nome e não reenvia o valor do cabeçalho de autenticação
- **THEN** a conexão recriada usa o valor de cabeçalho anterior

### Requirement: Remoção de conexão
O usuário com permissão de gestão MUST poder remover uma conexão; o sistema MUST removê-la do GPTMaker e do banco. Se a conexão já não existir no GPTMaker, a remoção MUST ser concluída localmente. Ao remover o agente, os registros locais das conexões MCP MUST ser apagados (o GPTMaker as descarta junto com o agente).

#### Scenario: Remoção
- **WHEN** o usuário remove uma conexão
- **THEN** ela deixa de existir no GPTMaker e some da lista

#### Scenario: Já removida no GPTMaker
- **WHEN** o GPTMaker responde que a conexão não existe
- **THEN** o registro local é apagado e a remoção conclui com sucesso

#### Scenario: Remoção do agente
- **WHEN** o agente é removido
- **THEN** os registros das conexões MCP dele deixam de existir e as credenciais cifradas são apagadas

### Requirement: Proteção de credenciais e isolamento
Valores de cabeçalho MUST ser cifrados em repouso e MUST NOT aparecer em respostas da API, logs, métricas ou mensagens de erro. Toda operação MUST filtrar pelo tenant da sessão e conferir que o agente e a conexão pertencem a ele.

#### Scenario: Segredo fora dos logs
- **WHEN** uma criação falha no GPTMaker
- **THEN** o log e o erro devolvido não contêm o valor de nenhum cabeçalho

#### Scenario: Conexão de outro tenant
- **WHEN** o usuário tenta editar ou remover uma conexão de outro tenant
- **THEN** o sistema responde 404 e nada muda
