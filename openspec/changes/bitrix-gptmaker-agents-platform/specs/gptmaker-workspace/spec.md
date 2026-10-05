## ADDED Requirements

### Requirement: Workspace partner único configurado
O sistema MUST operar com um único workspace GPTMaker para todos os tenants, cujo `workspaceId` é definido por configuração de ambiente, e MUST validar na inicialização que o workspace existe e é acessível com o token do partner.

#### Scenario: Inicialização com workspace válido
- **WHEN** o backend inicia com `workspaceId` e token válidos
- **THEN** o sistema confirma o workspace via `GET /workspace` e segue a inicialização normalmente

#### Scenario: Workspace inacessível
- **WHEN** o workspace configurado não é encontrado ou o token é recusado
- **THEN** o health check do backend fica `DOWN` para o componente GPTMaker e um alerta operacional é emitido

### Requirement: Registro e convenção de nomes dos agentes
O sistema MUST manter registro local de todo agente criado no workspace, com `tenantId`, `gptmakerAgentId` e data de criação, e MUST nomear o agente no GPTMaker com o mesmo nome dado pelo cliente, sem identificador do tenant (o GPTMaker usa o nome como identidade do agente na conversa). Antes de criar o agente no GPTMaker, o sistema MUST registrar localmente a criação em andamento (tenant e nome), completando-a com o `gptmakerAgentId` devolvido, para que um agente que fique órfão por falha na criação tenha o dono sugerido.

#### Scenario: Nome no GPTMaker
- **WHEN** um agente é criado ou renomeado
- **THEN** o nome enviado ao GPTMaker é o nome do agente, sem prefixo do tenant

#### Scenario: Órfão de criação interrompida
- **WHEN** a criação falha depois de o GPTMaker criar o agente e o desfazer também falha
- **THEN** o `workspace-sync` registra o órfão com o tenant da criação em andamento como sugestão de dono

#### Scenario: Agente antigo com prefixo
- **WHEN** um agente criado antes da mudança ainda tem o prefixo `[<tenantCode>]` no GPTMaker
- **THEN** o comando de migração o renomeia para o nome local, e um órfão com esse prefixo continua tendo o tenant sugerido pelo código

### Requirement: Sincronização e detecção de divergências
O sistema MUST executar periodicamente a comparação entre os agentes listados em `GET /workspace/agents` e o registro local, classificando agentes órfãos (existem no GPTMaker sem registro local), ausentes (registro local sem agente no GPTMaker) e com status divergente.

#### Scenario: Agente órfão
- **WHEN** a sincronização encontra agente no workspace sem registro local
- **THEN** o agente é listado como órfão no backoffice, onde um operador `ADMIN` pode removê-lo ou vinculá-lo a um tenant

#### Scenario: Agente ausente no GPTMaker
- **WHEN** um agente registrado localmente não existe mais no workspace
- **THEN** o agente fica `OUT_OF_SYNC`, o chatbot vinculado deixa de encaminhar mensagens e um alerta operacional é emitido

#### Scenario: Status divergente
- **WHEN** o status ativo/inativo no GPTMaker difere do local
- **THEN** o sistema reaplica no GPTMaker o status local (fonte da verdade) e registra a correção

### Requirement: Monitoramento do workspace
O sistema MUST consultar periodicamente `GET /workspace/{workspaceId}/credits` e alertar operadores quando o `status` do workspace for diferente de `ACTIVE`.

#### Scenario: Workspace com pagamento pendente
- **WHEN** o status retornado é `PAST_DUE` ou `CANCELED`
- **THEN** o sistema emite alerta crítico aos operadores e exibe o estado no painel do backoffice

### Requirement: Isolamento de recursos globais do workspace
O sistema MUST NOT expor aos tenants recursos globais do workspace (contatos, chats, canais, campos customizados, interações). Qualquer consulta a esses recursos MUST ser filtrada pelo `contextId`/agente pertencente ao tenant.

#### Scenario: Consulta de histórico de conversa
- **WHEN** um tenant consulta histórico de conversas
- **THEN** o sistema retorna apenas chats de agentes do próprio tenant

### Requirement: Limite de agentes por tenant
O sistema MUST limitar cada tenant a 5 agentes não removidos (ativos ou inativos), independente do plano, com valor configurável no backoffice. Agentes não são cobrados individualmente; o limite existe para proteger o workspace compartilhado.

#### Scenario: Limite atingido
- **WHEN** um tenant com 5 agentes não removidos tenta criar outro
- **THEN** a criação é recusada com erro `TENANT_AGENT_LIMIT`

#### Scenario: Agente removido libera vaga
- **WHEN** um tenant com 5 agentes remove um deles
- **THEN** o tenant pode criar um novo agente
