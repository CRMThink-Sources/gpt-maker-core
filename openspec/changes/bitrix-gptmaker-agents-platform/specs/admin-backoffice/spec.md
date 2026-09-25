## ADDED Requirements

### Requirement: Acesso restrito ao backoffice
O sistema MUST disponibilizar backoffice interno acessível apenas a operadores da empresa, com autenticação própria (fora do Bitrix) e perfis `ADMIN` e `SUPPORT`.

#### Scenario: Operador sem perfil ADMIN
- **WHEN** um operador `SUPPORT` tenta alterar plano ou conceder créditos
- **THEN** o sistema responde 403

### Requirement: Gestão de direitos dos planos
O sistema MUST permitir a operadores `ADMIN` cadastrar e editar, para cada plano do SPA de Planos (lido via `crmthink-platform`), os direitos do GPTMaker: créditos por ciclo, modelos permitidos, limites de treinamento e, para pacotes, a quantidade de créditos. Preço, intervalo e preço no Stripe MUST ser mantidos no SPA, não no backoffice. Alterações de direitos MUST NOT afetar assinaturas vigentes até o próximo ciclo.

#### Scenario: Editar plano com assinantes
- **WHEN** um plano com assinaturas ativas é editado
- **THEN** as novas condições valem para assinantes a partir do próximo ciclo

### Requirement: Gestão de tenants
O sistema MUST permitir listar tenants com status, plano, saldo e agentes, suspender/reativar tenant e conceder créditos avulsos com justificativa obrigatória. Troca de plano MUST ocorrer pelo `crmthink-platform` (modalidade `stripe`) ou pelo SPA (modalidade `manual`).

#### Scenario: Conceder créditos
- **WHEN** um `ADMIN` concede créditos informando quantidade e justificativa
- **THEN** o sistema lança `TOPUP` na carteira `EXTRA` (expira ao fim do ciclo corrente, junto com o plano) com autor e justificativa

#### Scenario: Suspender tenant
- **WHEN** um `ADMIN` suspende um tenant
- **THEN** os agentes do tenant são inativados e mensagens deixam de ser encaminhadas ao GPTMaker

### Requirement: Telas de catálogo de modelos e workspace
O backoffice MUST oferecer telas para o catálogo de modelos (`ai-model-catalog`) e para o workspace GPTMaker (`gptmaker-workspace`): status e créditos do workspace, agentes órfãos e agentes `OUT_OF_SYNC`, com ações de remover ou vincular órfãos.

#### Scenario: Vincular agente órfão
- **WHEN** um `ADMIN` vincula um agente órfão a um tenant
- **THEN** o agente passa a constar no registro local do tenant e é renomeado com o prefixo do tenant no GPTMaker

### Requirement: Visão de assinaturas
O backoffice MUST exibir, por tenant, a projeção local da assinatura (modalidade, status, período, plano, carência), os últimos eventos recebidos do `crmthink-platform` e o link para o item no SPA de Assinaturas. Criação e alteração de assinaturas manuais MUST ser feitas no SPA, não no backoffice.

#### Scenario: Consultar assinatura
- **WHEN** um operador abre o detalhe de um tenant
- **THEN** o sistema mostra a assinatura atual, os eventos recebidos e o link para o SPA

### Requirement: Auditoria de ações
O sistema MUST registrar trilha de auditoria de todas as ações do backoffice (autor, data, ação, antes/depois).

#### Scenario: Consultar auditoria
- **WHEN** um `ADMIN` consulta a auditoria de um tenant
- **THEN** o sistema lista as ações realizadas sobre aquele tenant em ordem cronológica
