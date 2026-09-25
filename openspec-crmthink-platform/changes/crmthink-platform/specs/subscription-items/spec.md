## ADDED Requirements

### Requirement: Espelho de itens de assinatura
O sistema MUST expor `POST /v1/subscriptions/{id}/items` (`externalRef`, `title`, `metadata` opcional), `PATCH /v1/subscriptions/{id}/items/{itemId}` (`status`, `title`, `metadata`) e `DELETE /v1/subscriptions/{id}/items/{itemId}`, mantendo os itens no SPA 1146 vinculados à assinatura (`parentId1142`), idempotentes por (`subscriptionId`, `externalRef`), com remoção lógica (data e autor da remoção).

#### Scenario: Criar item não cobrável
- **WHEN** a aplicação GPTMaker cria um item com `externalRef` do agente
- **THEN** o item é criado no SPA 1146 como `active` e nenhuma cobrança é alterada

#### Scenario: Criação repetida
- **WHEN** a mesma aplicação cria novamente um item com o mesmo `externalRef` na mesma assinatura
- **THEN** o sistema retorna o item existente sem duplicar

#### Scenario: Remover item
- **WHEN** a aplicação remove um item
- **THEN** o item fica `cancelled` com data de remoção preenchida no SPA

### Requirement: Itens cobráveis e não cobráveis
Cada item MUST ter a flag `billable`. Itens `billable = false` MUST NOT alterar a assinatura Stripe. Itens `billable = true` MUST sincronizar a quantidade do item de assinatura Stripe com o número de itens ativos cobráveis, respeitando faixas de preço.

#### Scenario: Item cobrável adicionado
- **WHEN** a aplicação cria um item `billable = true` numa assinatura `stripe`
- **THEN** a quantidade do item correspondente na assinatura Stripe é atualizada

#### Scenario: Divergência de quantidade
- **WHEN** a quantidade no Stripe diverge do número de itens cobráveis ativos no SPA
- **THEN** a varredura registra a divergência e reaplica a quantidade do SPA

### Requirement: Alterações humanas em itens
O sistema MUST refletir criação, alteração e remoção manual de itens no SPA 1146 como eventos para a aplicação dona do item.

#### Scenario: Suporte cancela item no CRM
- **WHEN** alguém muda o status de um item para `cancelled` no SPA
- **THEN** o sistema atualiza a quantidade Stripe se o item for cobrável
