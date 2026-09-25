## ADDED Requirements

### Requirement: Leitura de produtos e planos dos SPAs
O sistema MUST ler produtos do SPA 1134 e planos do SPA 1138 (somente leitura), com cache invalidado por eventos do SPA, e expor `GET /v1/plans` retornando os planos ativos dos produtos da aplicação autenticada com id, produto, nome, valor, intervalo, tipo (`subscription` ou `one_time`) e indicação de trial.

#### Scenario: Listar planos
- **WHEN** a aplicação `crmthink.gptmaker` chama `GET /v1/plans`
- **THEN** o sistema retorna apenas os planos ativos vinculados aos produtos do GPTMaker, incluindo os pacotes do produto "Créditos GPTMaker" com tipo `one_time`

#### Scenario: Plano alterado no CRM
- **WHEN** um plano é alterado no SPA 1138
- **THEN** o cache do plano é invalidado e a próxima leitura reflete a alteração

### Requirement: Planos de assinatura e avulsos
O sistema MUST derivar o tipo do plano do modelo de cobrança do produto (`ufCrm87BillingModel`): planos de produtos de compra única são `one_time` (ex.: pacotes de créditos, um plano por pacote) e dispensam intervalo; os demais são `subscription` e exigem intervalo mensal, trimestral, semestral ou anual. Cada tipo MUST ser aceito apenas no fluxo correspondente.

#### Scenario: Pacote como plano de produto avulso
- **WHEN** o produto "Créditos GPTMaker" tem modelo de cobrança "compra única" e o plano "Pacote 1000" com preço Stripe de pagamento único
- **THEN** o plano é retornado como `one_time` e só pode ser usado com `intent = purchase`

#### Scenario: Plano de assinatura sem intervalo
- **WHEN** um plano de produto de assinatura não tem intervalo preenchido
- **THEN** o plano não é retornado e o problema é registrado para correção no CRM

#### Scenario: Plano avulso em checkout de assinatura
- **WHEN** a aplicação pede checkout `subscribe` com um plano `one_time`
- **THEN** o sistema recusa com erro `PLAN_TYPE_MISMATCH`

### Requirement: Preço por ambiente
O sistema MUST resolver o preço Stripe do plano pelo ambiente da chave Stripe: campo de preço de produção para chaves `sk_live_`/`rk_live_` e campo de homologação nos demais casos, suportando preços com faixas (graduated/volume).

#### Scenario: Plano sem preço no ambiente
- **WHEN** um plano não possui preço preenchido para o ambiente atual
- **THEN** o sistema não o oferece para checkout e registra alerta de configuração
