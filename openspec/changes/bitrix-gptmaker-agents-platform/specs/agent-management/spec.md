## ADDED Requirements

### Requirement: Criação de agente
O sistema MUST permitir que o tenant crie um agente informando nome, avatar, comportamento, tipo (`SUPPORT`, `SALE`, `PERSONAL`), tom de comunicação (`FORMAL`, `NORMAL`, `RELAXED`), dados da empresa (`jobName`, `jobSite`, `jobDescription`) e modelo de IA (entre os permitidos pelo plano, padrão do catálogo se omitido), criando o agente correspondente no workspace partner do GPTMaker e persistindo o vínculo `tenantId` ↔ `gptmakerAgentId`. Comportamento (até 3000 caracteres) e descrição da empresa (`jobDescription`, até 500 caracteres) MUST ser obrigatórios na criação e na edição.

#### Scenario: Criação com sucesso
- **WHEN** um administrador do tenant envia o formulário válido de novo agente e o tenant está abaixo do limite de agentes
- **THEN** o sistema registra a criação em andamento, cria o agente no GPTMaker com o nome dado pelo cliente, aplica o modelo via `prefferModel` nas settings, persiste o registro local com status `ACTIVE`, configura os webhooks do agente apontando para o backend e retorna o agente criado

#### Scenario: Textos obrigatórios ausentes ou longos
- **WHEN** o formulário omite o comportamento ou a descrição da empresa, ou excede 3000 e 500 caracteres respectivamente
- **THEN** o sistema recusa com erro de validação sem chamar o GPTMaker

#### Scenario: Modelo não permitido
- **WHEN** o formulário informa modelo inativo ou não permitido pelo plano
- **THEN** o sistema recusa com erro `MODEL_NOT_ALLOWED` sem chamar o GPTMaker

#### Scenario: Limite de agentes atingido
- **WHEN** o tenant já possui 5 agentes não removidos (ativos ou inativos)
- **THEN** o sistema recusa a criação com erro de negócio `TENANT_AGENT_LIMIT` sem chamar o GPTMaker

#### Scenario: Falha no GPTMaker
- **WHEN** o GPTMaker retorna erro ou não responde na criação
- **THEN** o sistema não persiste agente ativo, registra o erro com identificador de rastreio e retorna mensagem de falha recuperável ao usuário

### Requirement: Isolamento de agentes por tenant
O sistema MUST garantir que um tenant só visualize e altere agentes vinculados ao seu `tenantId`, mesmo com todos os agentes residindo no mesmo workspace GPTMaker.

#### Scenario: Acesso a agente de outro tenant
- **WHEN** um usuário requisita um agente cujo `tenantId` difere do da sua sessão
- **THEN** o sistema responde 404 sem revelar a existência do agente

### Requirement: Edição de configurações do agente
O sistema MUST permitir editar dados do agente e suas configurações (settings) e refletir as alterações no GPTMaker via `PUT /agents/{id}` e `PUT /agents/{id}/settings`.

#### Scenario: Edição refletida no GPTMaker
- **WHEN** o administrador salva alterações no agente
- **THEN** o sistema atualiza o GPTMaker e, após sucesso, atualiza o registro local e invalida o cache do agente

#### Scenario: Conflito de sincronização
- **WHEN** a atualização no GPTMaker falha
- **THEN** o registro local permanece com a versão anterior e o usuário recebe erro indicando que nada foi alterado

### Requirement: Inativação e reativação de agente
O sistema MUST permitir inativar e reativar agentes, chamando `PUT /agents/{id}/inactive` e `PUT /agents/{id}/active` no GPTMaker. Agentes inativos MUST NOT responder mensagens nem consumir créditos.

#### Scenario: Inativar agente
- **WHEN** o administrador inativa um agente ativo
- **THEN** o agente fica `INACTIVE` no GPTMaker e localmente, e mensagens recebidas pelo chatbot vinculado deixam de ser encaminhadas ao GPTMaker

#### Scenario: Reativar agente respeitando plano
- **WHEN** o administrador reativa um agente e o plano ainda comporta mais um agente ativo
- **THEN** o agente volta a `ACTIVE` no GPTMaker e localmente

### Requirement: Remoção de agente
O sistema MUST permitir remover um agente, chamando `DELETE /agents/{id}` no GPTMaker, mantendo registro local em soft delete para preservar histórico de consumo.

#### Scenario: Remover agente
- **WHEN** o administrador confirma a remoção do agente
- **THEN** o agente é removido no GPTMaker, o registro local fica `DELETED` e o chatbot vinculado deixa de encaminhar mensagens

### Requirement: Inativação automática por falta de saldo ou plano expirado
O sistema MUST inativar automaticamente os agentes do tenant quando a assinatura expirar ou for cancelada, e reativar os que estavam ativos quando a assinatura for regularizada.

#### Scenario: Assinatura expirada
- **WHEN** a assinatura do tenant expira sem renovação
- **THEN** todos os agentes ativos do tenant são inativados com motivo `SUBSCRIPTION_EXPIRED`

#### Scenario: Assinatura regularizada
- **WHEN** a assinatura é renovada
- **THEN** os agentes inativados com motivo `SUBSCRIPTION_EXPIRED` voltam a `ACTIVE`
